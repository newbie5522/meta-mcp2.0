// @ts-nocheck
/**
 * src/server/routes/data-center-refresh.routes.ts
 * ================================================
 * 修复 P0-004：Data Center 刷新必须联动下游汇总表
 *
 * 数据流：
 * DataCenterStoreDaily (源表)
 *   ↓ 刷新后必须触发 ↓
 * StoreSummaryDaily (汇总表1)
 *   ↓ 必须触发 ↓
 * RoasSummaryDaily (汇总表2 - 关键指标)
 *   ↓ 必须触发 ↓
 * DashboardSummaryDaily (最终展示表)
 */

import { Router, Request, Response } from "express";
import { SyncCenter } from "../services/sync-center.service.js";
import { refreshStoreDataCenterLedger } from "../services/datacenter-store-ledger.service.js";
import { refreshMetaDataCenterLedger } from "../services/datacenter-meta-ledger.service.js";
import dayjs from "dayjs";

const router = Router();

// ============ 店铺 Data Center 刷新 ============
/**
 * POST /api/sync/data-center/refresh-store
 * 刷新店铺订单数据并联动下游汇总表
 */
router.post(
  "/data-center/refresh-store",
  async (req: Request, res: Response) => {
    const { storeId, startDate, endDate } = req.body;

    // 参数校验
    if (!storeId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "MISSING_PARAMS",
        message: "storeId, startDate, endDate are required"
      });
    }

    const storeIdNum = Number(storeId);

    if (!Number.isFinite(storeIdNum)) {
      return res.status(400).json({
        success: false,
        error: "INVALID_STORE_ID",
        message: "storeId must be a valid number"
      });
    }

    try {
      const chainId = `dc-refresh-store-${Date.now()}`;

      console.log(
        `[DataCenterRefresh] Starting store refresh: store=${storeId}, range=[${startDate}, ${endDate}]`
      );

      // Step 1：刷新 DataCenterStoreDaily（源表）
      const storeResult = await refreshStoreDataCenterLedger({
        storeId: storeIdNum,
        startDate,
        endDate
      });

      const recordCount = storeResult.snapshots?.length || 0;
      const diffDays =
        dayjs(endDate).diff(dayjs(startDate), "day") + 1;

      console.log(
        `[DataCenterRefresh] Store ledger refreshed: ${recordCount} records`
      );

      // ✅ Step 2：联动更新 StoreSummaryDaily
      const storeSummaryTaskId = await SyncCenter.rebuildStoreSummary(
        chainId,
        "datacenter_refresh",
        null,
        diffDays
      );

      console.log(
        `[DataCenterRefresh] StoreSummary rebuild triggered: ${storeSummaryTaskId}`
      );

      // ✅ Step 3：ROAS 依赖店铺数据，必须重建
      const roasTaskId = await SyncCenter.rebuildRoasSummary(
        chainId,
        "datacenter_refresh",
        storeSummaryTaskId,
        diffDays
      );

      console.log(
        `[DataCenterRefresh] RoasSummary rebuild triggered: ${roasTaskId}`
      );

      // ✅ Step 4：最后重建看板汇总
      const dashboardTaskId = await SyncCenter.rebuildDashboardSummary(
        chainId,
        "datacenter_refresh",
        roasTaskId,
        diffDays
      );

      console.log(
        `[DataCenterRefresh] DashboardSummary rebuild triggered: ${dashboardTaskId}`
      );

      const orderCount =
        storeResult.snapshots?.reduce(
          (s: number, r: any) => s + Number(r.orderCount || 0),
          0
        ) || 0;

      const grossSales = Number(
        (
          storeResult.snapshots?.reduce(
            (s: number, r: any) => s + Number(r.grossSales || 0),
            0
          ) || 0
        ).toFixed(2)
      );

      return res.json({
        success: true,
        source: "DataCenterStoreDaily",
        storeId,
        dateRange: { startDate, endDate },
        snapshotsCount: recordCount,
        orderCount,
        grossSales,
        // ✅ 返回下游任务信息
        downstreamTasks: {
          storeSummaryTaskId,
          roasTaskId,
          dashboardTaskId
        },
        message: "Store data center refreshed and downstream tables updated"
      });
    } catch (error: any) {
      console.error(
        "[DataCenterRefresh] Store refresh error:",
        error
      );
      return res.status(500).json({
        success: false,
        error: "REFRESH_STORE_FAILED",
        message: error?.message || String(error)
      });
    }
  }
);

// ============ Meta Data Center 刷新 ============
/**
 * POST /api/sync/data-center/refresh-meta
 * 刷新 Meta 广告数据并联动下游汇总表
 */
router.post(
  "/data-center/refresh-meta",
  async (req: Request, res: Response) => {
    const { storeId, startDate, endDate, includeUnmapped = true } = req.body;

    // 参数校验
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "MISSING_DATE_RANGE",
        message: "startDate and endDate are required"
      });
    }

    try {
      const chainId = `dc-refresh-meta-${Date.now()}`;

      console.log(
        `[DataCenterRefresh] Starting Meta refresh: range=[${startDate}, ${endDate}]`
      );

      // Step 1：刷新 DataCenterMetaAccountDaily（源表）
      const metaResult = await refreshMetaDataCenterLedger({
        storeId: storeId ? Number(storeId) : null,
        startDate,
        endDate,
        includeUnmapped:
          includeUnmapped === true || includeUnmapped === "true"
      });

      const recordCount = metaResult.snapshots?.length || 0;
      const diffDays =
        dayjs(endDate).diff(dayjs(startDate), "day") + 1;

      console.log(
        `[DataCenterRefresh] Meta ledger refreshed: ${recordCount} records`
      );

      // ✅ Step 2：联动更新 MetaSummaryDaily
      const metaSummaryTaskId = await SyncCenter.rebuildMetaSummary(
        chainId,
        "datacenter_refresh",
        null,
        diffDays
      );

      console.log(
        `[DataCenterRefresh] MetaSummary rebuild triggered: ${metaSummaryTaskId}`
      );

      // ✅ Step 3：ROAS 依赖 Meta 数据（广告费用），必须重建
      const roasTaskId = await SyncCenter.rebuildRoasSummary(
        chainId,
        "datacenter_refresh",
        metaSummaryTaskId,
        diffDays
      );

      console.log(
        `[DataCenterRefresh] RoasSummary rebuild triggered: ${roasTaskId}`
      );

      // ✅ Step 4：最后重建看板汇总
      const dashboardTaskId = await SyncCenter.rebuildDashboardSummary(
        chainId,
        "datacenter_refresh",
        roasTaskId,
        diffDays
      );

      console.log(
        `[DataCenterRefresh] DashboardSummary rebuild triggered: ${dashboardTaskId}`
      );

      return res.json({
        success: true,
        source: "DataCenterMetaAccountDaily",
        dateRange: { startDate, endDate },
        snapshotsCount: recordCount,
        // ✅ 返回下游任务信息
        downstreamTasks: {
          metaSummaryTaskId,
          roasTaskId,
          dashboardTaskId
        },
        message: "Meta data center refreshed and downstream tables updated"
      });
    } catch (error: any) {
      console.error("[DataCenterRefresh] Meta refresh error:", error);
      return res.status(500).json({
        success: false,
        error: "REFRESH_META_FAILED",
        message: error?.message || String(error)
      });
    }
  }
);

export default router;
