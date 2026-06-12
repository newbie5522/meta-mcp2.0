// @ts-nocheck
import axios from "axios";
import prisma from "../../db/index.js";
import dayjs from "dayjs";
import { getMetaToken, normalizeMetaAccountId, getNumericAccountId } from "../utils.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchEdges(path: string, params: Record<string, any>, token: string, maxPages = 10) {
  const url = `https://graph.facebook.com/v19.0${path}`;
  const rows = [];
  let after: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const res = await axios.get(url, {
      params: { ...params, access_token: token, after }
    });
    const data = res.data?.data || [];
    rows.push(...data);
    after = res.data?.paging?.cursors?.after;
    if (!after || !res.data?.paging?.next) break;
  }
  return rows;
}

export async function syncMetaInsightsForActiveAccounts(days: number = 90) {
  console.log(`[Meta Insights Sync] Starting scheduled multi-level insights sync for the last ${days} days.`);
  const token = await getMetaToken();
  if (!token) {
    console.error("[Meta Insights Sync] No Meta token configured.");
    return;
  }

  // 1. Fetch active accounts configured in our system (active or mapped to a store)
  const activeAccounts = await prisma.adAccount.findMany({
    where: {
      OR: [
        { recentActivity90d: true },
        { storeId: { not: null } }
      ]
    },
    include: { store: true }
  });

  const validAccounts = activeAccounts;
  console.log(`[Meta Insights Sync] Found ${validAccounts.length} active or mapped accounts to sync.`);

  const untilDate = dayjs().startOf('day').add(1, 'day'); // today + 1
  const sinceDate = dayjs().subtract(days, 'day').startOf('day');

  // We loop over 4 levels for each account to get full hierarchy metrics
  const levels = ["account", "campaign", "adset", "ad"];

  for (const acc of validAccounts) {
    const actId = normalizeMetaAccountId(acc.fb_account_id);
    const numericAccountId = getNumericAccountId(acc.fb_account_id);
    console.log(`[Meta Insights Sync] Syncing multi-level insights for ${actId} ...`);

    for (const currentLevel of levels) {
      console.log(`[Meta Insights Sync]   -> Syncing level "${currentLevel}" for ${actId} ...`);

      // Determine fields to request based on level to prevent API issues
      const baseFields = [
        "account_id", "account_name", "date_start", "spend",
        "impressions", "reach", "clicks", "cpc", "cpm", "ctr",
        "actions", "action_values", "purchase_roas"
      ];

      if (currentLevel === "campaign" || currentLevel === "adset" || currentLevel === "ad") {
        baseFields.push("campaign_id", "campaign_name");
      }
      if (currentLevel === "adset" || currentLevel === "ad") {
        baseFields.push("adset_id", "adset_name");
      }
      if (currentLevel === "ad") {
        baseFields.push("ad_id", "ad_name");
      }

      const fields = baseFields.join(",");

      try {
        const insightRows = await fetchEdges(`/act_${numericAccountId}/insights`, {
          level: currentLevel,
          time_increment: 1,
          time_range: JSON.stringify({
            since: sinceDate.format('YYYY-MM-DD'),
            until: untilDate.format('YYYY-MM-DD'),
          }),
          fields,
          limit: 1000
        }, token, 10);

        let successCount = 0;
        for (const row of insightRows) {
          const dateStr = row.date_start; // "YYYY-MM-DD"
          if (!dateStr) continue;

          const spend = parseFloat(row.spend || 0);
          const impressions = parseInt(row.impressions || 0, 10);
          const reach = parseInt(row.reach || 0, 10);
          const clicks = parseInt(row.clicks || 0, 10);
          const cpc = parseFloat(row.cpc || 0);
          const cpm = parseFloat(row.cpm || 0);
          const ctr = parseFloat(row.ctr || 0);

          let purchases = 0;
          let purchaseValue = 0;
          let addToCart = 0;
          let initiateCheckout = 0;
          let roas = 0;

          if (Array.isArray(row.actions)) {
            purchases = parseInt(row.actions.find(a => a.action_type === 'purchase')?.value || 0, 10);
            addToCart = parseInt(row.actions.find(a => a.action_type === 'add_to_cart')?.value || 0, 10);
            initiateCheckout = parseInt(row.actions.find(a => a.action_type === 'initiate_checkout')?.value || 0, 10);
          }
          if (Array.isArray(row.action_values)) {
            purchaseValue = parseFloat(row.action_values.find(a => a.action_type === 'purchase')?.value || 0);
          }
          if (Array.isArray(row.purchase_roas)) {
            roas = parseFloat(row.purchase_roas.find(a => a.action_type === 'purchase')?.value || 0);
          }
          
          const atcRate = clicks > 0 ? (addToCart / clicks) * 100 : 0;
          const checkoutRate = addToCart > 0 ? (initiateCheckout / addToCart) * 100 : 0;
          const cpp = purchases > 0 ? spend / purchases : 0;

          const campaignIdValue = row.campaign_id || "";
          const adsetIdValue = row.adset_id || "";
          const adIdValue = row.ad_id || "";

          // Set name dynamically depending on level to maximize information display
          let entityName = row.account_name || acc.fb_account_name || actId;
          if (currentLevel === "campaign") {
            entityName = row.campaign_name || "Campaign";
          } else if (currentLevel === "adset") {
            entityName = row.adset_name || "Ad Set";
          } else if (currentLevel === "ad") {
            entityName = row.ad_name || "Ad";
          }

          await prisma.adInsight.upsert({
            where: {
              accountId_level_campaignId_adsetId_adId_date: {
                accountId: actId,
                level: currentLevel,
                campaignId: campaignIdValue,
                adsetId: adsetIdValue,
                adId: adIdValue,
                date: dateStr
              }
            },
            update: {
              accountName: entityName,
              reach, impressions, clicks, spend,
              addToCart, initiateCheckout, purchases, purchaseValue,
              cpc, ctr, atcRate, checkoutRate, cpp, roas
            },
            create: {
              accountId: actId,
              level: currentLevel,
              campaignId: campaignIdValue,
              adsetId: adsetIdValue,
              adId: adIdValue,
              date: dateStr,
              accountName: entityName,
              reach, impressions, clicks, spend,
              addToCart, initiateCheckout, purchases, purchaseValue,
              cpc, ctr, atcRate, checkoutRate, cpp, roas
            }
          });
          successCount++;
        }
        console.log(`[Meta Insights Sync] Saved ${successCount} row(s) for level "${currentLevel}" for ${actId}.`);

      } catch (err: any) {
        console.error(`[Meta Insights Sync] Failed for ${actId} at level "${currentLevel}":`, err.response?.data?.error || err.message);
      }
    }

    await delay(1000); // polite rate limiting between accounts
  }
}
