import { Router } from "express";
import prisma from "../../db/index.js";
import { normalizeMetaAccountId } from "../utils.js";

const router = Router();

function getRequiredAccountId(mapping: any): string | null {
  if (!mapping || mapping.accountId == null) return null;
  const accountId = String(mapping.accountId).trim();
  return accountId ? normalizeMetaAccountId(accountId) : null;
}

function getStoreName(mapping: any): string | null {
  if (!mapping || mapping.store == null) return null;
  const storeName = String(mapping.store).trim();
  return storeName || null;
}

function isUnmappedStoreName(storeName: string | null): boolean {
  return !storeName || storeName === "未分配" || storeName === "Unknown";
}

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
    if (mappings.length === 0) {
      return res.status(400).json({
        success: false,
        error: "NO_VALID_MAPPINGS",
        details: "未包含任何有效的广告账户映射"
      });
    }

    const normalizedMappings = [];
    for (const mapping of mappings) {
      const cleanAccId = getRequiredAccountId(mapping);
      if (!cleanAccId) {
        return res.status(400).json({
          success: false,
          error: "INVALID_ACCOUNT_ID",
          details: "accountId is required and cannot be empty",
        });
      }

      const adAccount = await prisma.adAccount.findUnique({
        where: { fb_account_id: cleanAccId }
      });
      if (!adAccount) {
        return res.status(404).json({
          success: false,
          error: "ACCOUNT_NOT_FOUND",
          accountId: cleanAccId,
        });
      }

      normalizedMappings.push({
        raw: mapping,
        accountId: cleanAccId,
        adAccount,
        storeName: getStoreName(mapping),
      });
    }

    // 1. Validate target stores exist - Strictly DO NOT automatically create store!
    const storeNamesToCheck = Array.from(new Set(
      normalizedMappings
        .map((m) => m.storeName)
        .filter((name): name is string => !isUnmappedStoreName(name))
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
      normalizedMappings.map(async (mapping) => {
        const cleanAccId = mapping.accountId;
        const rawMapping = mapping.raw;
        const storeName = mapping.storeName;
        let targetStoreId: number | null = null;
        if (!isUnmappedStoreName(storeName)) {
          const store = await prisma.store.findFirst({
            where: { name: storeName }
          });
          if (store) {
            targetStoreId = store.id;
          }
        }

        if (!targetStoreId) {
          await prisma.accountMapping.updateMany({
            where: { fbAccountId: cleanAccId },
            data: {
              storeId: null,
              fbPageId: rawMapping.fbPageId ? String(rawMapping.fbPageId) : null,
              project: (rawMapping.project && String(rawMapping.project).trim() !== "未分配") ? String(rawMapping.project).trim() : null,
              owner: (rawMapping.owner && String(rawMapping.owner).trim() !== "未分配") ? String(rawMapping.owner).trim() : null,
            },
          });

          // Also set corresponding AdAccount's storeId to null instead of deleting it!
          await prisma.adAccount.update({
            where: { fb_account_id: cleanAccId },
            data: { storeId: null }
          });
          return { success: true, accountId: cleanAccId, action: 'unmapped' };
        }

        if (targetStoreId) {
          const upMap = await prisma.accountMapping.upsert({
            where: { fbAccountId: cleanAccId },
            update: {
              storeId: targetStoreId,
              fbPageId: rawMapping.fbPageId ? String(rawMapping.fbPageId) : null,
              project: (rawMapping.project && String(rawMapping.project).trim() !== "未分配") ? String(rawMapping.project).trim() : null,
              owner: (rawMapping.owner && String(rawMapping.owner).trim() !== "未分配") ? String(rawMapping.owner).trim() : null,
              updatedAt: new Date(),
            },
            create: {
              storeId: targetStoreId,
              fbAccountId: cleanAccId,
              fbPageId: rawMapping.fbPageId ? String(rawMapping.fbPageId) : null,
              project: (rawMapping.project && String(rawMapping.project).trim() !== "未分配") ? String(rawMapping.project).trim() : null,
              owner: (rawMapping.owner && String(rawMapping.owner).trim() !== "未分配") ? String(rawMapping.owner).trim() : null,
            },
          });

          const finalName = rawMapping.accountName ? String(rawMapping.accountName).trim() : mapping.adAccount.fb_account_name;

          await prisma.adAccount.update({
            where: { fb_account_id: cleanAccId },
            data: {
              storeId: targetStoreId,
              fb_account_name: finalName,
            },
          });

          return upMap;
        } else {
          return null;
        }
      })
    );
    res.json({ success: true, count: results.filter(Boolean).length });

  } catch (err: any) {
    console.error("Batch save mappings error:", err);
    res
      .status(500)
      .json({ error: "Failed to save mappings to DB", details: err.message });
  }
});

export default router;
