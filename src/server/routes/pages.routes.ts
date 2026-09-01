import { Router } from "express";
import { getMetaConnection, pageGraph, publicConnection } from "../services/meta-oauth.service.js";

const router = Router();
const fail = (res: any, error: any) => res.status(error.message === "PAGE_NOT_AUTHORIZED" ? 403 : 500).json({ success: false, error: error.message });

router.get("/", async (_req, res) => {
  try { res.json(publicConnection(await getMetaConnection())); } catch (error) { fail(res, error); }
});

router.get("/:pageId/posts", async (req, res) => {
  try {
    const fields = "id,message,created_time,permalink_url,full_picture,status_type";
    const data = await pageGraph<any>(req.params.pageId, `${req.params.pageId}/posts?fields=${encodeURIComponent(fields)}&limit=25`);
    res.json({ success: true, ...data });
  } catch (error) { fail(res, error); }
});

router.post("/:pageId/posts", async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();
    const link = String(req.body.link || "").trim();
    const imageUrl = String(req.body.imageUrl || "").trim();
    if (!message && !link && !imageUrl) return res.status(400).json({ success: false, error: "POST_CONTENT_REQUIRED" });
    const form = new URLSearchParams();
    if (message) form.set("message", message);
    if (link) form.set("link", link);
    let path = `${req.params.pageId}/feed`;
    if (imageUrl) { path = `${req.params.pageId}/photos`; form.set("url", imageUrl); form.set("published", "true"); }
    const data = await pageGraph<any>(req.params.pageId, path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    res.json({ success: true, ...data });
  } catch (error) { fail(res, error); }
});

router.delete("/:pageId/posts/:postId", async (req, res) => {
  try {
    const data = await pageGraph<any>(req.params.pageId, req.params.postId, { method: "DELETE" });
    res.json({ success: true, ...data });
  } catch (error) { fail(res, error); }
});

export default router;
