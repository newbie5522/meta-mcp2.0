import { Router } from "express";
import {
  completeMetaOAuth,
  createMetaAuthUrl,
  disconnectMetaOAuth,
  getMetaConnection,
  publicConnection,
  verifyMetaState,
} from "../services/meta-oauth.service.js";

const router = Router();

router.get("/status", async (_req, res) => {
  try { res.json(publicConnection(await getMetaConnection())); }
  catch (error: any) { res.status(500).json({ connected: false, error: error.message }); }
});

router.get("/start", (_req, res) => {
  try { res.redirect(createMetaAuthUrl()); }
  catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get("/callback", async (req, res) => {
  const appUrl = (process.env.APP_URL || "/").replace(/\/$/, "");
  try {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    if (!code || !state) throw new Error(String(req.query.error_description || "MISSING_OAUTH_CALLBACK_DATA"));
    verifyMetaState(state);
    await completeMetaOAuth(code);
    res.redirect(`${appUrl}/?tab=pages-management&oauth=success`);
  } catch (error: any) {
    res.redirect(`${appUrl}/?tab=pages-management&oauth=error&message=${encodeURIComponent(error.message)}`);
  }
});

router.post("/disconnect", async (_req, res) => {
  await disconnectMetaOAuth();
  res.json({ success: true });
});

export default router;
