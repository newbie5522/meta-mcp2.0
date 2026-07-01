// @ts-nocheck
import axios from "axios";
import prisma from "../../db/index.js";
import { getMetaToken, normalizeMetaAccountId, getNumericAccountId } from "../utils.js";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function num(v: any): number {
  const n = Number.parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function int(v: any): number {
  const n = Number.parseInt(String(v ?? "0"), 10);
  return Number.isFinite(n) ? n : 0;
}

function actionValue(rows: any[] | undefined, names: string[]) {
  if (!Array.isArray(rows)) return 0;
  const found = rows.find(a => names.includes(a.action_type));
  return found ? num(found.value) : 0;
}

async function fetchAccountInfo(accountId: string, token: string) {
  const clean = getNumericAccountId(accountId);

  const res = await axios.get(`https://graph.facebook.com/v19.0/act_${clean}`, {
    params: {
      fields: "account_id,name,timezone_name,currency,account_status",
      access_token: token
    },
    timeout: 10000
  });

  return res.data;
}

async function fetchAccountInsights(accountId: string, token: string, startDate: string, endDate: string) {
  const clean = getNumericAccountId(accountId);

  const res = await axios.get(`https://graph.facebook.com/v19.0/act_${clean}/insights`, {
    params: {
      level: "account",
      time_increment: 1,
      time_range: JSON.stringify({
        since: startDate,
        until: endDate
      }),
      fields: [
        "account_id",
        "account_name",
        "date_start",
        "date_stop",
        "spend",
        "reach",
        "impressions",
        "clicks",
        "cpc",
        "cpm",
        "ctr",
        "actions",
        "action_values",
        "purchase_roas"
      ].join(","),
      limit: 1000,
      access_token: token
    },
    timeout: 20000
  });

  return res.data?.data || [];
}

async function resolveAccounts(params: {
  storeId?: number | null;
  accountIds?: string[];
  includeUnmapped?: boolean;
}) {
  if (Array.isArray(params.accountIds) && params.accountIds.length > 0) {
    return prisma.adAccount.findMany({
      where: {
        fb_account_id: {
          in: params.accountIds.map(normalizeMetaAccountId)
        }
      },
      include: { store: true }
    });
  }

  if (params.storeId) {
    const mappings = await prisma.accountMapping.findMany({
      where: { storeId: Number(params.storeId) }
    });

    const mappingIdsCanonical = mappings.map(m => normalizeMetaAccountId(m.fbAccountId));
    const mappingIdsNumeric = mappingIdsCanonical.map(id => getNumericAccountId(id));

    let accounts = await prisma.adAccount.findMany({
      where: {
        recentActivity90d: true,
        OR: [
          { fb_account_id: { in: mappingIdsCanonical } },
          { fb_account_id: { in: mappingIdsNumeric } },
          { storeId: Number(params.storeId) }
        ]
      },
      include: { store: true },
      orderBy: { updatedAt: "desc" }
    });

    if (params.includeUnmapped) {
      const unmapped = await prisma.adAccount.findMany({
        where: {
          storeId: null,
          recentActivity90d: true
        },
        include: { store: true },
        orderBy: { updatedAt: "desc" },
        take: 20
      });
      accounts = [...accounts, ...unmapped];
    }

    const seen = new Set();
    return accounts.filter(a => {
      const id = normalizeMetaAccountId(a.fb_account_id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  return prisma.adAccount.findMany({
    where: {
      recentActivity90d: true
    },
    include: { store: true },
    orderBy: { updatedAt: "desc" },
    take: 50
  });
}

export async function refreshMetaDataCenterLedger(params: {
  startDate: string;
  endDate: string;
  storeId?: number | null;
  accountIds?: string[];
  includeUnmapped?: boolean;
}) {
  const token = await getMetaToken();
  if (!token) throw new Error("META_TOKEN_MISSING");

  const accounts = await resolveAccounts(params);

  let recordsFetched = 0;
  let recordsSaved = 0;
  let recordsUpdated = 0;
  const failedAccounts: any[] = [];

  // Audit missing mapping accounts
  if (params.storeId) {
    const mappings = await prisma.accountMapping.findMany({
      where: { storeId: Number(params.storeId) }
    });
    const mappingIdsCanonical = mappings.map(m => normalizeMetaAccountId(m.fbAccountId));
    const foundIds = new Set(accounts.map(a => normalizeMetaAccountId(a.fb_account_id)));
    const missingMappedAccounts = mappingIdsCanonical.filter(id => !foundIds.has(id));

    for (const missingId of missingMappedAccounts) {
      const mappingObj = mappings.find(m => normalizeMetaAccountId(m.fbAccountId) === missingId);
      failedAccounts.push({
        accountId: missingId,
        message: `Account mapping exists but no corresponding AdAccount record is found in local metadata. Mapping name: ${mappingObj?.name || 'Unknown'}.`,
        code: "LOCAL_METADATA_MISSING",
        isMissingInventory: true
      });
    }
  }

  const batchSize = 5;

  for (let i = 0; i < accounts.length; i += batchSize) {
    const batch = accounts.slice(i, i + batchSize);

    await Promise.all(batch.map(async (acc) => {
      const actId = normalizeMetaAccountId(acc.fb_account_id);

      try {
        const info = await fetchAccountInfo(actId, token);
        const metaTimezone = info.timezone_name || acc.timezone || null;
        const currency = info.currency || acc.currency || "USD";

        if (metaTimezone && metaTimezone !== acc.timezone) {
          await prisma.adAccount.update({
            where: { fb_account_id: actId },
            data: {
              timezone: metaTimezone,
              currency
            }
          });
        }

        const rows = await fetchAccountInsights(actId, token, params.startDate, params.endDate);
        recordsFetched += rows.length;

        for (const row of rows) {
          const date = row.date_start;
          if (!date) continue;

          const spend = num(row.spend);
          const impressions = int(row.impressions);
          const reach = int(row.reach);
          const clicks = int(row.clicks);
          const ctr = row.ctr !== undefined ? num(row.ctr) : impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(4)) : 0;
          const cpc = row.cpc !== undefined ? num(row.cpc) : clicks > 0 ? Number((spend / clicks).toFixed(4)) : 0;
          const cpm = row.cpm !== undefined ? num(row.cpm) : impressions > 0 ? Number(((spend / impressions) * 1000).toFixed(4)) : 0;

          const purchases = int(actionValue(row.actions, ["purchase", "offsite_conversion.fb_pixel_purchase"]));
          const purchaseValue = num(actionValue(row.action_values, ["purchase", "offsite_conversion.fb_pixel_purchase"]));

          const roasFromApi = Array.isArray(row.purchase_roas)
            ? num(row.purchase_roas.find((r: any) => r.action_type === "purchase" || r.action_type === "offsite_conversion.fb_pixel_purchase")?.value)
            : 0;

          const roas = roasFromApi || (spend > 0 ? Number((purchaseValue / spend).toFixed(4)) : 0);

          const existing = await prisma.dataCenterMetaAccountDaily.findUnique({
            where: {
              accountId_date: {
                accountId: actId,
                date
              }
            }
          });

          await prisma.dataCenterMetaAccountDaily.upsert({
            where: {
              accountId_date: {
                accountId: actId,
                date
              }
            },
            update: {
              accountName: row.account_name || info.name || acc.fb_account_name,
              storeId: acc.storeId || null,
              storeName: acc.store?.name || null,
              timezone: metaTimezone,
              currency,
              spend,
              impressions,
              reach,
              clicks,
              ctr,
              cpc,
              cpm,
              purchases,
              purchaseValue,
              roas,
              rawPayloadJson: JSON.stringify(row),
              diagnosticsJson: JSON.stringify({
                dateSource: "Meta API date_start",
                timezoneRule: "Meta account timezone owns date_start",
                metaTimezone
              }),
              apiFetchedAt: new Date()
            },
            create: {
              accountId: actId,
              accountName: row.account_name || info.name || acc.fb_account_name,
              storeId: acc.storeId || null,
              storeName: acc.store?.name || null,
              date,
              timezone: metaTimezone,
              currency,
              spend,
              impressions,
              reach,
              clicks,
              ctr,
              cpc,
              cpm,
              purchases,
              purchaseValue,
              roas,
              rawPayloadJson: JSON.stringify(row),
              diagnosticsJson: JSON.stringify({
                dateSource: "Meta API date_start",
                timezoneRule: "Meta account timezone owns date_start",
                metaTimezone
              }),
              apiFetchedAt: new Date()
            }
          });

          if (existing) recordsUpdated++;
          else recordsSaved++;
        }
      } catch (err: any) {
        failedAccounts.push({
          accountId: actId,
          message: err?.response?.data?.error?.message || err.message || String(err),
          code: err?.response?.data?.error?.code,
          fbtraceId: err?.response?.data?.error?.fbtrace_id
        });
      }
    }));

    if (i + batchSize < accounts.length) {
      await sleep(1500);
    }
  }

  return {
    accountsSynced: accounts.length - failedAccounts.length,
    recordsFetched,
    recordsSaved,
    recordsUpdated,
    failedAccounts
  };
}
