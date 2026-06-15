// @ts-nocheck
import axios from "axios";
import prisma from "../../db/index.js";
import { normalizeMetaAccountId } from "../utils.js";

export async function ensureAdAccounts(token: string) {
  try {
    let allAccounts: any[] = [];
    const fields = "name,account_id,account_status,currency,timezone_name";
    let nextUrl: string | null = `https://graph.facebook.com/v19.0/me/adaccounts?fields=${fields}&limit=100&access_token=${token}`;
    
    // Read config settings, fallback to defaults
    const activeLastDaysRaw = await prisma.setting.findUnique({ where: { key: 'META_AD_ACCOUNTS_ACTIVE_LAST_DAYS' } });
    const activeLastDays = activeLastDaysRaw?.value ? (parseInt(activeLastDaysRaw.value) || 90) : 90;
    
    const syncLimitRaw = await prisma.setting.findUnique({ where: { key: 'META_AD_ACCOUNTS_SYNC_LIMIT' } });
    const syncLimit = syncLimitRaw?.value ? (parseInt(syncLimitRaw.value) || 500) : 500;

    console.log(`[Ensure AdAccounts] Fetching with syncLimit=${syncLimit}, activeLastDays=${activeLastDays}`);
    let fetchedMetaAccountsCount = 0;
    while (nextUrl && fetchedMetaAccountsCount < syncLimit) {
      const response = await axios.get(nextUrl);
      if (response.data && response.data.data) {
        allAccounts = allAccounts.concat(response.data.data);
        fetchedMetaAccountsCount += response.data.data.length;
      }
      nextUrl = response.data.paging?.next || null;
    }

    if (allAccounts.length > syncLimit) {
      allAccounts = allAccounts.slice(0, syncLimit);
    }

    const untilDate = new Date();
    const sinceDate = new Date(untilDate);
    sinceDate.setUTCDate(untilDate.getUTCDate() - activeLastDays + 1);
    const range = {
      since: sinceDate.toISOString().slice(0, 10),
      until: untilDate.toISOString().slice(0, 10),
    };

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
            const parseNum = (v: any) => typeof v === 'number' ? v : (parseFloat(v) || 0);
            let purchases = 0;
            let purchaseValue = 0;
            if (row) {
              if (Array.isArray(row.actions)) {
                const pAction = row.actions.find((a: any) => a.action_type === 'purchase');
                if (pAction) purchases = parseNum(pAction.value);
              }
              if (Array.isArray(row.action_values)) {
                const pvAction = row.action_values.find((a: any) => a.action_type === 'purchase');
                if (pvAction) purchaseValue = parseNum(pvAction.value);
              }
            }
            if (row && (
              parseNum(row.spend) > 0 || 
              parseNum(row.impressions) > 0 || 
              parseNum(row.clicks) > 0 ||
              purchases > 0 ||
              purchaseValue > 0
            )) {
              isRecent90d = true;
            }
          } catch (err: any) {
            console.warn(`[Ensure AdAccounts] Warning checking delivery for ${metaAccountId}:`, err.response?.data?.error?.message || err.message);
            const errMsg = String(err.response?.data?.error?.message || err.message).toLowerCase();
            const errCode = err.response?.data?.error?.code;
            const errSubcode = err.response?.data?.error?.error_subcode;
            if (errCode === 17 || errCode === 32 || errCode === 613 || errSubcode === 2446079 || 
                errMsg.includes("rate limit") || errMsg.includes("too many calls")) {
              isRateLimited = true;
              console.warn(`[Ensure AdAccounts Rate Limit Detected] Rate limit is exceeded. Enabling fallback for active status checks of remaining accounts.`);
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

    const defaultStore = await prisma.store.findFirst();
    let successCount = 0;
    const checkedAt = new Date();

    for (const acc of activeAccountsSync) {
      const statusStr = acc.status != null ? String(acc.status) : null;
      let targetStoreId: number | null = null;
      let lastRecentActivity = false;
      
      const existingAdAccount = await prisma.adAccount.findUnique({
        where: { fb_account_id: acc.id }
      });
      if (existingAdAccount) {
        lastRecentActivity = existingAdAccount.recentActivity90d;
      }

      const mapping = await prisma.accountMapping.findFirst({
        where: { fbAccountId: acc.id }
      });

      if (mapping) {
        targetStoreId = mapping.storeId; // can be null or a storeId
      } else if (existingAdAccount) {
        targetStoreId = existingAdAccount.storeId; // keep current if exists
      } else {
        targetStoreId = null; // explicitly unmapped
      }

      const finalIsActive = acc.rateLimitSkipped ? lastRecentActivity : acc.isActive;

      await prisma.adAccount.upsert({
        where: { fb_account_id: acc.id },
        update: { 
          fb_account_name: acc.name, 
          fb_access_token: token,
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
          fb_access_token: token,
          currency: acc.currency,
          timezone: acc.timezone,
          status: statusStr,
          activityStatus: acc.status === 1 ? 1 : 2, 
          recentActivity90d: finalIsActive,
          lastActivityCheckedAt: checkedAt,
          storeId: targetStoreId
        }
      }).catch((e) => { console.error(e) });
      successCount++;
    }
    console.log(`[Ensure AdAccounts] Successfully upserted ${successCount} mapped ad accounts.`);
  } catch (error: any) {
    console.error(`[Ensure AdAccounts] Failed API call:`, error.response?.data || error.message);
  }
}

export async function syncMetaHierarchy(token: string, options: any = {}) {
  // Purposely cleared to remove the complex hierarchy logic.
  // Replaced by meta insights sync script.
  console.log("syncMetaHierarchy is deprecated. Using new meta-insights sync.");
}
