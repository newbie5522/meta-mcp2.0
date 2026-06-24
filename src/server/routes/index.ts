// @ts-nocheck
import { Router } from "express";
import authRoutes from "./auth.routes.js";
import usersRoutes from "./users.routes.js";
import storesRoutes from "./stores.routes.js";
import intelligenceRoutes from "./intelligence.routes.js";
import accountsRoutes from "./accounts.routes.js";
import syncRoutes from "./sync.routes.js";
import settingsRoutes from "./settings.routes.js";
import mappingsRoutes from "./mappings.routes.js";
import monitoringRoutes from "./monitoring.routes.js";
import aiAnalysisRoutes from "./ai-analysis.routes.js";
import diagnosticsRoutes from "./diagnostics.routes.js";
import aiRoutes from "./ai.routes.js";

import dashboardRoutes from "./dashboard.routes.js";
import dataCenterRoutes from "./data-center.routes.js";
import systemRoutes from "./system.routes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/data-center", dataCenterRoutes);
router.use("/system", systemRoutes);
router.use("/users", usersRoutes);
router.use("/stores", storesRoutes);
router.use("/intelligence", intelligenceRoutes);
router.use("/ai-analysis", aiAnalysisRoutes);
router.use("/diagnostics", diagnosticsRoutes);
router.use("/ai", aiRoutes);
router.use("/accounts", accountsRoutes);
router.use("/", syncRoutes);
router.use("/settings", settingsRoutes);
router.use("/mappings", mappingsRoutes);
router.use("/monitoring", monitoringRoutes);

export default router;
