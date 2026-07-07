// @ts-nocheck
import axios from "axios";
import prisma from "../../db/index.js";
import { getMetaToken, normalizeMetaAccountId, getNumericAccountId } from "../utils.js";
import { canonicalActId } from "./meta-ledger.service.js";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function num(v: any): number {
  const n = Number.parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

function int(v: any): number {
  const n = Number.parseInt(String(v ?? "0"), 10);
  return Number.isFinite(n) ? n : 0;
}

function extractActionValue(rows: any[] | undefined, names: string[]): number {
  if (!Array.isArray(rows)) return 0;
  const found = rows.find(a => names.includes(a.action_type));
  return found ? num(found.value) : 0;
}

async function fetchMetaAccountTimezone(accountId: string, token: string) {
  const clean = getNumericAccountId(accountId);
  const res = await axios.get(`https://graph.facebook.com/v19.0/act_${clean}`, {
    params: {
      fields: "account_id,name,timezone_name,currency,account_status",
      access_token: token
    },
    timeout: 15000
  });
  return res.data;
}

async function fetchAccountSpendRealtime(params: {
  accountId: string;
  token: string;
  startDate: string;
  endDate: string;
}) {
  const clean = getNumericAccountId(params.accountId);

  const res = await axios.get(`https://graph.facebook.com/v19.0/act_${clean}/insights`, {
    params: {
      level: "account",
      time_increment: 1,
      time_range: JSON.stringify({
        since: params.startDate,
        until: params.endDate
      }),
      fields: [
        "account_id",
        "account_name",
        "date_start",
        "date_stop",
        "spend",
        "impressions",
        "reach",
        "clicks",
        "cpc",
        "cpm",
        "ctr",
        "actions",
        "action_values",
        "purchase_roas"
      ].join(","),
      limit: 1000,
      access_token: params.token
    },
    timeout: 20000
  });

  return res.data?.data || [];
}

async function resolveRealtimeAccounts(options: {
  accountIds?: string[];
  storeId?: number | null;
  includeUnmapped?: boolean;
}) {
  if (Array.isArray(options.accountIds) && options.accountIds.length > 0) {
    return prisma.adAccount.findMany({
      where: {
        fb_account_id: {
          in: options.accountIds.map(normalizeMetaAccountId)
        }
      },
      include: { store: true }
    });
  }

  if (options.storeId) {
    const mapped = await prisma.accountMapping.findMany({
      where: { storeId: Number(options.storeId) }
    });
    const mappedIds = mapped.map(m => normalizeMetaAccountId(m.fbAccountId));

    const direct = await prisma.adAccount.findMany({
      where: { storeId: Number(options.storeId) },
      include: { store: true }
    });

    const directIds = direct.map(a => normalizeMetaAccountId(a.fb_account_id));
    const ids = Array.from(new Set([...mappedIds, ...directIds]));

    let accounts = await prisma.adAccount.findMany({
      where: {
        fb_account_id: { in: ids }
      },
      include: { store: true }
    });

    if (options.includeUnmapped) {
      const unmappedRecent = await prisma.adAccount.findMany({
        where: {
          storeId: null,
          recentActivity90d: true
        },
        include: { store: true },
        take: 20
      });

      accounts = [...accounts, ...unmappedRecent];
    }

    const seen = new Set<string>();
    return accounts.filter(a => {
      const id = normalizeMetaAccountId(a.fb_account_id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  return prisma.adAccount.findMany({
    where: {
      OR: [
        { storeId: { not: null } },
        { recentActivity90d: true }
      ]
    },
    include: { store: true },
    take: 50
  });
}

export async function syncMetaAccountSpendRealtime(options: {
  startDate: string;
  endDate: string;
  accountIds?: string[];
  storeId?: number | null;
  includeUnmapped?: boolean;
  triggeredBy?: string;
}) {
  const token = await getMetaToken();
  if (!token) throw new Error("META_TOKEN_MISSING");

  const accounts = await resolveRealtimeAccounts(options);

  const targetAccountIds = accounts.map(a => canonicalActId(a.fb_account_id));

  const batchSize = 5;
  let recordsFetched = 0;
  let recordsSaved = 0;
  let recordsUpdated = 0;
  const failedAccounts: any[] = [];
  const accountTimezones: any[] = [];

  for (let i = 0; i < accounts.length; i += batchSize) {
    const batch = accounts.slice(i, i + batchSize);

    await Promise.all(batch.map(async (acc) => {
      const actId = canonicalActId(acc.fb_account_id);

      try {
        let metaAccount: any = null;
        try {
          metaAccount = await fetchMetaAccountTimezone(actId, token);
          const metaTimezone = metaAccount?.timezone_name || null;
          const dbTimezone = acc.timezone || null;

          if (metaTimezone && metaTimezone !== dbTimezone) {
            await prisma.adAccount.update({
              where: { fb_account_id: actId },
              data: {
                timezone: metaTimezone,
                currency: metaAccount.currency || acc.currency || "USD",
                status: String(metaAccount.account_status ?? acc.status ?? "1")
              }
            });
          }

          accountTimezones.push({
            accountId: actId,
            accountName: acc.fb_account_name || metaAccount?.name || null,
            dbTimezone,
            metaTimezone,
            timezoneMatched: !metaTimezone || metaTimezone === dbTimezone
          });
        } catch (tzErr: any) {
          accountTimezones.push({
            accountId: actId,
            accountName: acc.fb_account_name || null,
            dbTimezone: acc.timezone || null,
            metaTimezone: null,
            timezoneMatched: false,
            error: tzErr?.response?.data?.error?.message || tzErr.message
          });
        }

        const rows = await fetchAccountSpendRealtime({
          accountId: actId,
          token,
          startDate: options.startDate,
          endDate: options.endDate
        });

        if (!rows.length) {
          failedAccounts.push({
            accountId: actId,
            accountName: acc.fb_account_name || metaAccount?.name || null,
            reason: "NO_NEW_DATA_FROM_META_API",
            startDate: options.startDate,
            endDate: options.endDate
          });
          return;
        }

        recordsFetched += rows.length;

        for (const row of rows) {
          const dateStr = row.date_start;
          if (!dateStr) continue;

          const spend = num(row.spend);
          const impressions = int(row.impressions);
          const reach = int(row.reach);
          const clicks = int(row.clicks);
          const ctr = row.ctr !== undefined ? num(row.ctr) : impressions > 0 ? (clicks / impressions) * 100 : 0;
          const cpc = row.cpc !== undefined ? num(row.cpc) : clicks > 0 ? spend / clicks : 0;
          const cpm = row.cpm !== undefined ? num(row.cpm) : impressions > 0 ? (spend / impressions) * 1000 : 0;

          const purchases = int(extractActionValue(row.actions, ["purchase", "offsite_conversion.fb_pixel_purchase"]));
          const purchaseValue = num(extractActionValue(row.action_values, ["purchase", "offsite_conversion.fb_pixel_purchase"]));

          const roasFromApi = Array.isArray(row.purchase_roas)
            ? num(row.purchase_roas.find((r: any) => r.action_type === "purchase" || r.action_type === "offsite_conversion.fb_pixel_purchase")?.value)
            : 0;

          const roas = roasFromApi || (spend > 0 ? purchaseValue / spend : 0);

          const dataObj = {
            date: dateStr,
            level: "account",
            account_id: actId,
            campaign_id: "",
            adset_id: "",
            ad_id: "",
            creative_id: "",
            entity_id: actId,
            spend,
            impressions,
            clicks,
            ctr,
            cpc,
            cpm,
            purchases,
            purchase_value: purchaseValue,
            roas,
            currency: metaAccount?.currency || acc.currency || "USD",
            synced_at: new Date(),
            raw_payload: JSON.stringify({
              ...row,
              meta_sync_mode: "realtime_account_level",
              dateSource: "Meta API date_start",
              timezoneRule: "no server timezone conversion",
              metaTimezone: metaAccount?.timezone_name || null
            })
          };

          const existing = await prisma.factMetaPerformance.findUnique({
            where: {
              date_level_account_id_entity_id: {
                date: dateStr,
                level: "account",
                account_id: actId,
                entity_id: actId
              }
            }
          });

          await prisma.factMetaPerformance.upsert({
            where: {
              date_level_account_id_entity_id: {
                date: dateStr,
                level: "account",
                account_id: actId,
                entity_id: actId
              }
            },
            update: dataObj,
            create: dataObj
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
    recordsFetched,
    recordsSaved,
    recordsUpdated,
    accountsSynced: accounts.length - failedAccounts.length,
    targetAccountsCount: accounts.length,
    failedAccounts,
    diagnostics: {
      status:
        recordsFetched === 0 && failedAccounts.length > 0
          ? "NO_NEW_DATA_OR_FAILED"
          : failedAccounts.length > 0
            ? "PARTIAL_SUCCESS"
            : "SUCCESS",
      mode: "meta_realtime_account_level",
      dateSource: "Meta API date_start",
      timezoneRule: "Meta API owns ad account date_start; no server timezone conversion",
      startDate: options.startDate,
      endDate: options.endDate,
      batchSize,
      accountTimezones,
      canonicalAccountIds: targetAccountIds
    }
  };
}
