import { Router } from "express";
import prisma from "../../db/index.js";
import axios from "axios";
import { getMetaToken, normalizeMetaAccountId } from "../utils.js";
import dayjs from "dayjs";
import {
  getCanonicalAdHierarchy,
  mapCanonicalHierarchyToAccountDetails,
  type CanonicalAdHierarchyLevel
} from "../services/ad-hierarchy.service.js";

const router = Router();

function isDemoDataEnabled(): boolean {
  return process.env.ENABLE_DEMO_DATA === "true";
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function daysRange(days: number): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(until.getUTCDate() - days + 1);
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}

export function normalizeDetailsLevel(level: unknown): CanonicalAdHierarchyLevel | null {
  if (level === "campaigns" || level === "campaign") return "campaign";
  if (level === "adsets" || level === "adset") return "adset";
  if (level === "ads" || level === "ad") return "ad";
  return null;
}

export function parseSingleHierarchyFilter(value: unknown) {
  if (Array.isArray(value)) {
    return { error: "MULTI_PARENT_FILTER_UNSUPPORTED" as const };
  }
  if (value === undefined || value === null) return { value: undefined };
  const str = String(value).trim();
  if (!str || str === "all") return { value: undefined };
  if (str.includes(",")) {
    return { error: "MULTI_PARENT_FILTER_UNSUPPORTED" as const };
  }
  return { value: str };
}

// Endpoint dedicated to testing Meta Token validity and retrieving diagnostics
router.get("/test-token", async (req, res) => {
  let token: string | null = null;
  try {
    token = await getMetaToken();
  } catch (e) {}

  if (!token) {
    return res.status(400).json({ 
      success: false, 
      error: "Meta Token 未配置。",
      identityStatus: "unknown",
      apiAccessStatus: "unknown"
    });
  }

  if (token.includes("...")) {
    return res.status(400).json({
      success: false,
      error: "Token 包含省略号掩码",
      identityStatus: "invalid",
      apiAccessStatus: "unknown",
      details: {
        message: "当前检测到的 Token 包含 '...' 省略号，表示它是脱敏掩码而非完整有效的令牌。请使用'修改'并粘贴完整的 Access Token 后重试。"
      }
    });
  }

  const logsData = {
    type: "META_TOKEN_TEST",
    startedAt: new Date()
  };

  let identityStatus: 'valid' | 'invalid' | 'unknown' = 'unknown';
  let apiAccessStatus: 'usable' | 'rate_limited' | 'permission_missing' | 'blocked' | 'unknown' = 'unknown';
  let apiError: any = null;

  try {
    // 1. Verify User Info via /me
    const meRes = await axios.get("https://graph.facebook.com/v19.0/me", {
      params: { fields: "id,name", access_token: token }
    });
    const info = meRes.data;
    identityStatus = "valid";

    // 2. Fetch Granted Permissions
    let permissions: string[] = [];
    try {
      const permRes = await axios.get("https://graph.facebook.com/v19.0/me/permissions", {
        params: { access_token: token }
      });
      if (permRes.data && Array.isArray(permRes.data.data)) {
        permissions = permRes.data.data
          .filter((p: any) => p.status === "granted")
          .map((p: any) => p.permission);
      }
    } catch (permErr: any) {
      console.warn("Failed to fetch permissions during token test:", permErr.message);
      const fbError = permErr.response?.data?.error || {};
      apiError = {
        code: fbError.code || permErr.code || 500,
        type: fbError.type || "UnknownError",
        message: fbError.message || permErr.message,
        error_subcode: fbError.error_subcode,
        fbtrace_id: fbError.fbtrace_id
      };
    }

    const hasAdsRead = permissions.includes("ads_read");
    const hasBusinessManagement = permissions.includes("business_management");

    // 3. Count available accounts / API access validation
    let accountsCount = 0;
    try {
      const adAccsRes = await axios.get("https://graph.facebook.com/v19.0/me/adaccounts", {
        params: { fields: "id", limit: 50, access_token: token }
      });
      if (adAccsRes.data && Array.isArray(adAccsRes.data.data)) {
        accountsCount = adAccsRes.data.data.length;
      }
      apiAccessStatus = "usable";
    } catch (adErr: any) {
      console.warn("Failed to fetch ad accounts count during ad-account API test:", adErr.message);
      const fbError = adErr.response?.data?.error || {};
      apiError = {
        code: fbError.code || adErr.code || 500,
        type: fbError.type || "UnknownError",
        message: fbError.message || adErr.message,
        error_subcode: fbError.error_subcode,
        fbtrace_id: fbError.fbtrace_id
      };

      const errorMessage = apiError.message || "";
      const code = apiError.code;
      const subcode = apiError.error_subcode;

      if (subcode === 2446079 || code === 80004 || errorMessage.toLowerCase().includes("too many calls") || errorMessage.toLowerCase().includes("rate limit")) {
        apiAccessStatus = "rate_limited";
      } else if (errorMessage.toLowerCase().includes("permission") || errorMessage.toLowerCase().includes("access token") || code === 200) {
        apiAccessStatus = "permission_missing";
      } else {
        apiAccessStatus = "blocked";
      }
    }

    await prisma.syncLog.create({
      data: {
        type: logsData.type,
        status: apiAccessStatus === "usable" ? "SUCCESS" : "WARNING",
        metadata: JSON.stringify({
          name: info.name,
          id: info.id,
          permissions,
          accountsCount,
          identityStatus,
          apiAccessStatus,
          apiError
        })
      }
    }).catch(() => {});

    return res.json({
      success: true,
      identityStatus,
      apiAccessStatus,
      name: info.name,
      id: info.id,
      permissions,
      hasAdsRead,
      hasBusinessManagement,
      accountsCount,
      apiError
    });

  } catch (err: any) {
    identityStatus = "invalid";
    apiAccessStatus = "blocked";

    const fbError = err.response?.data?.error || {};
    const formattedError = {
      code: fbError.code || err.code || 500,
      type: fbError.type || "UnknownError",
      message: fbError.message || err.message,
      error_subcode: fbError.error_subcode,
      fbtrace_id: fbError.fbtrace_id
    };

    const errorMessage = fbError.message || "";
    if (formattedError.error_subcode === 2446079 || formattedError.code === 80004 || errorMessage.toLowerCase().includes("too many calls")) {
      apiAccessStatus = "rate_limited";
    }

    await prisma.syncLog.create({
      data: {
        type: logsData.type,
        status: "FAILED",
        error: formattedError.message,
        metadata: JSON.stringify(formattedError)
      }
    }).catch(() => {});

    return res.status(400).json({
      success: false,
      identityStatus,
      apiAccessStatus,
      error: formattedError.message,
      details: {
        error: formattedError
      }
    });
  }
});

// Endpoint dedicated to retrieving already synced accounts directly from database
router.get("/db-list", async (req, res) => {
  try {
    let accounts = await prisma.adAccount.findMany({
      orderBy: {
        fb_account_name: 'asc'
      }
    });

    const results = accounts.map((acc: any) => ({
      id: acc.fb_account_id,
      name: acc.fb_account_name || "",
      status: acc.recentActivity90d ? 'active' : 'inactive',
      fbStatus: acc.status ? parseInt(acc.status) : 2,
      currency: acc.currency || "USD",
      timezone: acc.timezone || "UTC"
    }));

    return res.json(results);
  } catch (err: any) {
    console.error("Error reading db-list:", err);
    return res.status(500).json({ error: "Failed to read accounts from local database: " + err.message });
  }
});

// Endpoint dedicated to fetching and syncing the active accounts from Meta quickly
router.get("/active-list", async (req, res) => {
  let token: string | null = null;
  try {
    token = await getMetaToken();
  } catch (e) {}

  if (!token) {
    return res.status(401).json({ error: "Meta Token 未配置。" });
  }

  if (token.includes("...")) {
    return res.status(400).json({
      error: "当前 Token 为脱敏掩码，无效。请重新绑定输入完整 Token。"
    });
  }

  try {
    let allAccounts: any[] = [];
    const fields = "name,account_id,account_status,currency,timezone_name";
    let nextUrl: string | null = `https://graph.facebook.com/v19.0/me/adaccounts?fields=${fields}&limit=100&access_token=${token}`;
    
    // Read config settings, fallback to defaults
    const activeLastDaysRaw = await prisma.setting.findUnique({ where: { key: 'META_AD_ACCOUNTS_ACTIVE_LAST_DAYS' } });
    const activeLastDays = activeLastDaysRaw?.value ? (parseInt(activeLastDaysRaw.value) || 90) : 90;
    
    const syncLimitRaw = await prisma.setting.findUnique({ where: { key: 'META_AD_ACCOUNTS_SYNC_LIMIT' } });
    const syncLimit = (syncLimitRaw?.value && parseInt(syncLimitRaw.value, 10)) ? parseInt(syncLimitRaw.value, 10) : 10000000;

    let fetchedMetaAccountsCount = 0;
    try {
      while (nextUrl && fetchedMetaAccountsCount < syncLimit) {
        const response = await axios.get(nextUrl);
        if (response.data && response.data.data) {
          allAccounts = allAccounts.concat(response.data.data);
          fetchedMetaAccountsCount += response.data.data.length;
        }
        nextUrl = response.data.paging?.next || null;
      }
    } catch (apiErr: any) {
      const fbError = apiErr.response?.data?.error || {};
      const formattedError = {
        code: fbError.code || apiErr.code || 500,
        type: fbError.type || "UnknownError",
        message: fbError.message || apiErr.message,
        error_subcode: fbError.error_subcode,
        fbtrace_id: fbError.fbtrace_id
      };
      
      await prisma.syncLog.create({
        data: {
          type: "META_ACCOUNTS_SYNC",
          status: "FAILED",
          error: formattedError.message,
          metadata: JSON.stringify(formattedError)
        }
      }).catch(() => {});

      console.warn(`[Meta Accounts Sync Option] Direct live fetch failed: ${formattedError.message}.`);

const statusCode =
  formattedError.code === 80004 || formattedError.error_subcode === 2446079
    ? 429
    : 502;

return res.status(statusCode).json({
  success: false,
  error: "META_ACCOUNTS_LIVE_FETCH_FAILED",
  message: "无法从 Meta 实时接口同步最新广告账户列表。请检查 Token 权限、频率限制或稍后重试。",
  apiAccessStatus: statusCode === 429 ? "rate_limited" : "blocked",
  apiError: formattedError
});
    }

    if (allAccounts.length > syncLimit) {
      allAccounts = allAccounts.slice(0, syncLimit);
    }

    const range = daysRange(activeLastDays);

    // Concurrency limiter to avoid Facebook API limits
    const activeAccountsSync: any[] = [];
    const concurrentLimit = 5;
    let isRateLimited = false;
    
    for (let i = 0; i < allAccounts.length; i += concurrentLimit) {
      const chunk = allAccounts.slice(i, i + concurrentLimit);
      const results = await Promise.all(chunk.map(async (apiAcc) => {
        const metaAccountId = normalizeMetaAccountId(apiAcc.id || apiAcc.account_id);
        const status = apiAcc.account_status;
        const apiCurrency = apiAcc.currency;
        const apiTimezone = apiAcc.timezone_name;
        
        let isRecent90d = false;
        if (status === 1 && !isRateLimited) {
          try {
            const insightsRes = await axios.get(
              `https://graph.facebook.com/v19.0/${metaAccountId}/insights`,
              {
                params: {
                  fields: "spend,impressions,clicks,actions,action_values",
                  level: "account",
                  time_range: JSON.stringify(range),
                  limit: 1,
                  access_token: token,
                },
              }
            );
            const row = insightsRes.data?.data?.[0];
            let purchases = 0;
            let purchaseValue = 0;
            if (row) {
              if (Array.isArray(row.actions)) {
                const pAction = row.actions.find((a: any) => a.action_type === 'purchase');
                if (pAction) purchases = numberValue(pAction.value);
              }
              if (Array.isArray(row.action_values)) {
                const pvAction = row.action_values.find((a: any) => a.action_type === 'purchase');
                if (pvAction) purchaseValue = numberValue(pvAction.value);
              }
            }
            if (row && (
              numberValue(row.spend) > 0 || 
              numberValue(row.impressions) > 0 || 
              numberValue(row.clicks) > 0 ||
              purchases > 0 ||
              purchaseValue > 0
            )) {
              isRecent90d = true;
            }
          } catch (err: any) {
            console.warn(`Warning checking recent delivery for ${metaAccountId}:`, err.response?.data?.error?.message || err.message);
            const errMsg = String(err.response?.data?.error?.message || err.message).toLowerCase();
            const errCode = err.response?.data?.error?.code;
            const errSubcode = err.response?.data?.error?.error_subcode;
            if (errCode === 17 || errCode === 32 || errCode === 613 || errSubcode === 2446079 || 
                errMsg.includes("rate limit") || errMsg.includes("too many calls")) {
              isRateLimited = true;
              console.warn(`[Meta Rate Limit Detected] Rate limit is exceeded. Enabling fallback for active status checks of remaining accounts.`);
            }
          }
        }
  
        return {
          id: metaAccountId,
          name: apiAcc.name,
          currency: apiCurrency,
          timezone: apiTimezone,
          status: status,
          isActive: isRecent90d,
          rateLimitSkipped: isRateLimited
        };
      }));
      activeAccountsSync.push(...results);
    }

    // Deduplicate activeAccountsSync by id
    const seenIds = new Set<string>();
    const uniqueAccountsSync = activeAccountsSync.filter(acc => {
      if (!acc.id) return false;
      if (seenIds.has(acc.id)) return false;
      seenIds.add(acc.id);
      return true;
    });

    // Bulk update database with findings
    const checkedAt = new Date();
    for (const acc of uniqueAccountsSync) {
      const statusStr = acc.status != null ? String(acc.status) : null;
      
      let targetStoreId: number | null = null;
      let lastRecentActivity = false;
      const existingAcc = await prisma.adAccount.findUnique({
        where: { fb_account_id: acc.id },
        select: { storeId: true, recentActivity90d: true }
      });
      if (existingAcc) {
        targetStoreId = existingAcc.storeId;
        lastRecentActivity = existingAcc.recentActivity90d;
      } else {
        const mapping = await prisma.accountMapping.findFirst({
          where: { fbAccountId: acc.id }
        });
        if (mapping && mapping.storeId != null) {
          targetStoreId = mapping.storeId;
        } else {
          targetStoreId = null; // Default to unmapped (null) instead of polluting the default store!
        }
      }

      const finalIsActive = acc.rateLimitSkipped ? lastRecentActivity : acc.isActive;

      await prisma.adAccount.upsert({
        where: { fb_account_id: acc.id },
        update: { 
          fb_account_name: acc.name, 
          currency: acc.currency,
          timezone: acc.timezone,
          status: statusStr,
          activityStatus: acc.status === 1 ? 1 : 2, 
          recentActivity90d: finalIsActive,
          lastActivityCheckedAt: checkedAt,
          storeId: targetStoreId
        },
        create: { 
          fb_account_id: acc.id, 
          fb_account_name: acc.name, 
          currency: acc.currency,
          timezone: acc.timezone,
          status: statusStr,
          activityStatus: acc.status === 1 ? 1 : 2, 
          recentActivity90d: finalIsActive,
          lastActivityCheckedAt: checkedAt,
          storeId: targetStoreId
        }
      }).catch((e) => {
        console.error(`[Meta Sync DB Upsert Error for ${acc.id}]:`, e);
      });
    }

    // Save general sync completion time setting
    await prisma.setting.upsert({
      where: { key: 'meta_accounts_last_synced_at' },
      update: { value: checkedAt.toISOString() },
      create: { key: 'meta_accounts_last_synced_at', value: checkedAt.toISOString() }
    }).catch((se) => {
      console.error("[Meta Sync DB Settings Update Error]:", se);
    });

    // Let's log successful sync
    await prisma.syncLog.create({
      data: {
        type: "META_ACCOUNTS_SYNC",
        status: "SUCCESS",
        recordsFetched: allAccounts.length,
        recordsSaved: uniqueAccountsSync.length,
        metadata: JSON.stringify({
          totalFetched: allAccounts.length,
          active90d: uniqueAccountsSync.filter(a => a.isActive).length
        })
      }
    }).catch(() => {});

    // Return ALL accounts. We do NOT filter by recentActivity90d=true anymore!
    const results = activeAccountsSync.map(a => ({
      id: a.id,
      name: a.name,
      status: a.isActive ? 'active' : 'inactive',
      fbStatus: a.status,
      currency: a.currency,
      timezone: a.timezone
    })).sort((a, b) => a.name.localeCompare(b.name));

    return res.json(results);
  } catch (err: any) {
    console.error("Error fetching accounts list:", err.message);
    const errorMsg = err.response?.data?.error?.message || err.message;
    await prisma.syncLog.create({
      data: {
        type: "META_ACCOUNTS_SYNC",
        status: "FAILED",
        error: errorMsg
      }
    }).catch(() => {});
    return res.status(500).json({ error: errorMsg });
  }
});

// Original GET / to return all accounts from DB for standard UI dropdown operations
router.get("", async (req, res) => {
  try {
    let accounts = await prisma.adAccount.findMany();

    if (!isDemoDataEnabled()) {
      const activeStores = await prisma.store.findMany({
        where: {
          NOT: [
            { mode: "sandbox" },
            { name: { in: ["Shopline Fashion Store", "Shopify Electronics Hub", "Shoplazza Home Decor"] } },
            { domain: { in: ["fashion.shoplineapp.com", "electronics.myshopify.com", "decor.shoplazza.com"] } }
          ]
        }
      });
      const activeStoreIds = new Set<number>(activeStores.map(s => s.id));
      accounts = accounts.filter(acc => typeof acc.storeId !== "number" || activeStoreIds.has(acc.storeId));
    }

    const parsedResults = accounts.map((acc: any) => ({
      id: acc.fb_account_id,
      account_id: acc.fb_account_id.replace('act_', ''),
      name: acc.fb_account_name,
      account_status: acc.status === "1" ? 1 : 2,
      activity_status: acc.recentActivity90d ? 'active' : 'empty',
      is_bound: acc.storeId ? true : false,
      recentActivity90d: acc.recentActivity90d
    }));

    return res.json(parsedResults);
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to read accounts from DB." });
  }
});

export function createAccountDetailsHandler(deps = {
  getCanonicalAdHierarchy,
  mapCanonicalHierarchyToAccountDetails
}) {
  return async (req: any, res: any) => {
    const { accountId } = req.params;
    const { level = "campaigns", startDate, endDate, includeZeroSpend } = req.query;

    try {
      const dateStart = startDate ? String(startDate) : dayjs().subtract(30, 'day').format('YYYY-MM-DD');
      const dateEnd = endDate ? String(endDate) : dayjs().format('YYYY-MM-DD');
      const canonicalLevel = normalizeDetailsLevel(level);

      if (!canonicalLevel) {
        return res.status(400).json({
          error: "UNKNOWN_HIERARCHY_LEVEL",
          level
        });
      }
      const campaignFilter = parseSingleHierarchyFilter(req.query.campaignId);
      const adsetFilter = parseSingleHierarchyFilter(req.query.adsetId);
      const adFilter = parseSingleHierarchyFilter(req.query.adId);
      if (campaignFilter.error || adsetFilter.error || adFilter.error) {
        return res.status(400).json({
          error: "MULTI_PARENT_FILTER_UNSUPPORTED"
        });
      }

      const isAll = accountId === "all_active" || accountId === "all";
      const canonicalHierarchy = await deps.getCanonicalAdHierarchy({
        level: canonicalLevel,
        accountId: isAll ? "all" : normalizeMetaAccountId(accountId),
        scope: isAll ? "all_accounts" : "current_account",
        startDate: dateStart,
        endDate: dateEnd,
        campaignId: campaignFilter.value,
        adsetId: adsetFilter.value,
        adId: adFilter.value,
        includeZeroSpend: includeZeroSpend === "true" || includeZeroSpend === true
      });

      return res.json({
        data: deps.mapCanonicalHierarchyToAccountDetails(canonicalLevel, canonicalHierarchy.data),
        coverage: canonicalHierarchy.coverage,
        sourceCoverage: canonicalHierarchy.sourceCoverage,
        dataHealth: canonicalHierarchy.dataHealth,
        dateRange: canonicalHierarchy.dateRange,
        appliedFilters: canonicalHierarchy.appliedFilters
      });
    } catch (error: any) {
      console.error("Failed to load details for account:", accountId, error.message);
      return res.status(500).json({ error: "Failed to fetch account level details", details: error.message });
    }
  };
}

router.get("/:accountId/details", createAccountDetailsHandler());

router.get("/:accountId/audience-insights", async (req, res) => {
  const { accountId } = req.params;
  const { startDate, endDate, breakdown = "gender_age" } = req.query;

  try {
    const cleanAccountId = normalizeMetaAccountId(accountId);
    const dateStart = startDate ? String(startDate) : dayjs().subtract(30, 'day').format('YYYY-MM-DD');
    const dateEnd = endDate ? String(endDate) : dayjs().format('YYYY-MM-DD');

    const mappedDimType = breakdown === "gender_age" ? "gender" : String(breakdown || "country");

    const whereClause: any = {
      date: { gte: dateStart, lte: dateEnd },
      dimension_type: mappedDimType,
      account_id: cleanAccountId
    };

    const dbRows = await prisma.factAudienceBreakdown.findMany({
      where: whereClause
    });

    const groups: Record<string, any> = {};
    for (const r of dbRows) {
      const val = r.dimension_value || "unknown";
      if (!groups[val]) {
        groups[val] = {
          dimensionType: r.dimension_type,
          dimensionValue: val,
          spend: 0,
          impressions: 0,
          clicks: 0,
          purchases: 0,
          purchaseValue: 0
        };
      }
      groups[val].spend += r.spend || 0;
      groups[val].impressions += r.impressions || 0;
      groups[val].clicks += r.clicks || 0;
      groups[val].purchases += r.purchases || 0;
      groups[val].purchaseValue += r.purchase_value || 0;
    }

    const rows = Object.values(groups).map(g => {
      const ctr = g.impressions > 0 ? (g.clicks / g.impressions) : 0;
      const cpc = g.clicks > 0 ? (g.spend / g.clicks) : 0;
      return {
        ...g,
        ctr,
        cpc
      };
    });

    return res.json({
      rows,
      dataSourceExplain: {
        primarySource: "FactAudienceBreakdown",
        legacyUsed: false
      }
    });
  } catch (err: any) {
    console.error("Audience breakdown error:", err);
    return res.status(500).json({ error: "Failed to load audience breakdowns", details: err.message });
  }
});

router.get("/:accountId/hierarchy", async (req, res) => {
  const { accountId } = req.params;
  try {
    const normAccountId = normalizeMetaAccountId(accountId);
    
    const campaigns = await prisma.campaign.findMany({
      where: { accountId: normAccountId }
    });

    const campaignIds = campaigns.map(c => c.id);

    const adSets = await prisma.adSet.findMany({
      where: { campaignId: { in: campaignIds } }
    });

    const ads = await prisma.ad.findMany({
      where: { accountId: normAccountId }
    });

    return res.json({
      success: true,
      campaigns: campaigns.map(c => ({ id: c.id, name: c.name, status: c.status || "UNKNOWN" })),
      adSets: adSets.map(s => ({ id: s.id, campaignId: s.campaignId, name: s.name, status: "UNKNOWN" })),
      ads: ads.map(a => ({ id: a.id, adsetId: a.adsetId, campaignId: a.campaignId, name: a.name, status: "UNKNOWN" }))
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch hierarchy", details: error.message });
  }
});

router.get("/list", async (req, res) => {
  try {
    const accounts = await prisma.adAccount.findMany();
    
    const uniqueMap = accounts.map((acc: any) => ({
      accountId: acc.fb_account_id,
      accountName: acc.fb_account_name,
      recentActivity90d: acc.recentActivity90d
    }));
    
    res.json(uniqueMap);
  } catch (err: any) {
    res.status(500).json({
      error: "Failed to fetch unique accounts from DB",
      details: err.message,
      code: err.code,
    });
  }
});

export default router;
