import { Router } from "express";
import prisma from "../../db/index.js";
import { normalizeMetaAccountId } from "../utils.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const mappings = await prisma.accountMapping.findMany({
      include: { store: true }
    });

    const monitoringData = await prisma.metaAccountMonitoring.findMany({
      select: { accountId: true, accountName: true },
    });
    
    const adAccountData = await prisma.adAccount.findMany({
      select: { fb_account_id: true, fb_account_name: true },
    });

    const nameMap = new Map();
    for (const d of monitoringData) {
      if (d.accountName) nameMap.set(normalizeMetaAccountId(d.accountId), d.accountName);
    }
    for (const d of adAccountData) {
      if (d.fb_account_name) {
        nameMap.set(normalizeMetaAccountId(d.fb_account_id), d.fb_account_name);
      }
    }

    // Map them back to standard act_xxx format
    const mapped = mappings.map(m => {
      const normId = normalizeMetaAccountId(m.fbAccountId);
      return {
        accountId: normId,
        accountName: nameMap.get(normId) || normId,
        fbPageId: m.fbPageId,
        store: m.store ? m.store.name : "未分配",
        project: m.project || "未分配",
        owner: m.owner || "未分配"
      };
    });
    res.json(mapped);
  } catch (err: any) {
    console.error("Fetch mappings error:", err);
    res.status(500).json({
      error: "Failed to fetch mappings from DB",
      details: err.message,
      code: err.code,
    });
  }
});

router.post("/batch", async (req, res) => {
  const { mappings } = req.body;
  if (!Array.isArray(mappings)) {
    return res.status(400).json({ error: "Mappings array is required" });
  }

  try {
    // Filter out invalid mappings before updating DB
    const validMappings = mappings.filter((m: any) => m && m.accountId != null);

    // 1. Validate target stores exist - Strictly DO NOT automatically create store!
    const storeNamesToCheck = Array.from(new Set(
      validMappings
        .map((m: any) => m.store ? String(m.store).trim() : null)
        .filter((name): name is string => !!name && name !== "未分配" && name !== "Unknown")
    ));

    for (const name of storeNamesToCheck) {
      const storeExists = await prisma.store.findFirst({
        where: { name: name }
      });
      if (!storeExists) {
        return res.status(400).json({
          error: "STORE_NOT_FOUND",
          details: `店铺 '${name}' 不存在，请先在店铺管理中创建该店铺配置。`
        });
      }
    }

    const results = await Promise.all(
      validMappings.map(async (mapping: any) => {
        const cleanAccId = normalizeMetaAccountId(mapping.accountId);

        const storeName = mapping.store ? String(mapping.store).trim() : null;
        let targetStoreId: number | null = null;
        if (storeName && storeName !== "未分配" && storeName !== "Unknown") {
          const store = await prisma.store.findFirst({
            where: { name: storeName }
          });
          if (store) {
            targetStoreId = store.id;
          }
        }

        if (!targetStoreId) {
          // If no mapped store, update to storeId = null
          const upMap = await prisma.accountMapping.upsert({
            where: { fbAccountId: cleanAccId },
            update: {
              storeId: null,
              fbPageId: mapping.fbPageId ? String(mapping.fbPageId) : null,
              project: (mapping.project && String(mapping.project).trim() !== "未分配") ? String(mapping.project).trim() : null,
              owner: (mapping.owner && String(mapping.owner).trim() !== "未分配") ? String(mapping.owner).trim() : null,
            },
            create: {
              storeId: null,
              fbAccountId: cleanAccId,
              fbPageId: mapping.fbPageId ? String(mapping.fbPageId) : null,
              project: (mapping.project && String(mapping.project).trim() !== "未分配") ? String(mapping.project).trim() : null,
              owner: (mapping.owner && String(mapping.owner).trim() !== "未分配") ? String(mapping.owner).trim() : null,
            }
          });

          // Also set corresponding AdAccount's storeId to null instead of deleting it!
          try {
            await prisma.adAccount.updateMany({
              where: { fb_account_id: cleanAccId },
              data: { storeId: null }
            });
          } catch (e) {
            console.warn(`[Mappings Route] Failed to clear storeId relation on AdAccount ${cleanAccId}:`, e);
          }
          return { success: true, accountId: cleanAccId, action: 'unmapped' };
        }

        if (targetStoreId) {
          const upMap = await prisma.accountMapping.upsert({
            where: { fbAccountId: cleanAccId },
            update: {
              storeId: targetStoreId,
              fbPageId: mapping.fbPageId ? String(mapping.fbPageId) : null,
              project: (mapping.project && String(mapping.project).trim() !== "未分配") ? String(mapping.project).trim() : null,
              owner: (mapping.owner && String(mapping.owner).trim() !== "未分配") ? String(mapping.owner).trim() : null,
              updatedAt: new Date(),
            },
            create: {
              storeId: targetStoreId,
              fbAccountId: cleanAccId,
              fbPageId: mapping.fbPageId ? String(mapping.fbPageId) : null,
              project: (mapping.project && String(mapping.project).trim() !== "未分配") ? String(mapping.project).trim() : null,
              owner: (mapping.owner && String(mapping.owner).trim() !== "未分配") ? String(mapping.owner).trim() : null,
            },
          });

          // Sync with AdAccount: find corresponding Store and upsert/update store relation but protect existing fields
          const existingAdAccount = await prisma.adAccount.findUnique({
            where: { fb_account_id: cleanAccId }
          });

          const finalName = mapping.accountName ? String(mapping.accountName).trim() : (existingAdAccount?.fb_account_name || "Unknown");

          await prisma.adAccount.upsert({
            where: { fb_account_id: cleanAccId },
            update: {
              storeId: targetStoreId,
              fb_account_name: finalName,
            },
            create: {
              fb_account_id: cleanAccId,
              fb_account_name: finalName,
              storeId: targetStoreId,
            },
          });

          return upMap;
        } else {
          return null;
        }
      })
    );
    res.json({ success: true, count: results.filter(Boolean).length });

    // Trigger Sync Center integration to rebuild ROAS maps & dashboard summaries on mapping update non-blockingly
    void import("../services/sync-center.service.js")
      .then(({ SyncCenter }) => {
        void SyncCenter.triggerMappingChangeChain("mapping_change_api")
          .then(() => console.log("[Mappings Route] Rebuild mapping change chain background success"))
          .catch(syncErr => console.error("[Mappings Route] Failed to trigger mapping rebuild sync:", syncErr));
      })
      .catch(importErr => console.error("[Mappings Route] Failed to import sync center for map change:", importErr));

  } catch (err: any) {
    console.error("Batch save mappings error:", err);
    res
      .status(500)
      .json({ error: "Failed to save mappings to DB", details: err.message });
  }
});

export default router;