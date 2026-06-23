import { Router } from "express";
import { businessNow, businessTodayString, businessYesterdayString, APP_BUSINESS_TIMEZONE } from "../utils/business-time.js";

const router = Router();

router.get("/timezone", (req, res) => {
  res.json({
    businessTimezone: APP_BUSINESS_TIMEZONE,
    businessNow: businessNow().format("YYYY-MM-DD HH:mm:ss"),
    businessToday: businessTodayString(),
    businessYesterday: businessYesterdayString(),
    serverNowUtc: new Date().toISOString()
  });
});

export default router;
