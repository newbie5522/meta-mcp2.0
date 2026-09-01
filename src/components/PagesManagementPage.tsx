import React, { useEffect, useState } from "react";
import axios from "axios";
import { ExternalLink, FileText, Link as LinkIcon, RefreshCw, Send, Unplug } from "lucide-react";

type Page = { id: string; name: string; category?: string; tasks: string[] };
type Status = {
  connected: boolean;
  user?: { id: string; name: string; email?: string };
  scopes?: string[];
  missingScopes?: string[];
  requiredScopes?: string[];
  pages?: Page[];
  connectedAt?: string;
};
type Post = { id: string; message?: string; created_time?: string; permalink_url?: string; full_picture?: string };

export function PagesManagementPage() {
  const [status, setStatus] = useState<Status>({ connected: false });
  const [pageId, setPageId] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const loadStatus = async () => {
    const { data } = await axios.get<Status>("/api/meta-oauth/status");
    setStatus(data);
    const first = data.pages?.[0]?.id || "";
    setPageId((current) => current || first);
  };
  const loadPosts = async (target = pageId) => {
    if (!target) return setPosts([]);
    const { data } = await axios.get(`/api/pages/${target}/posts`);
    setPosts(data.data || []);
  };

  useEffect(() => { loadStatus().catch((e) => setNotice(e.response?.data?.error || e.message)); }, []);
  useEffect(() => { loadPosts().catch((e) => setNotice(e.response?.data?.error || e.message)); }, [pageId]);

  const publish = async () => {
    if (!pageId || (!message.trim() && !link.trim() && !imageUrl.trim())) return;
    setLoading(true); setNotice("");
    try {
      await axios.post(`/api/pages/${pageId}/posts`, { message, link, imageUrl });
      setMessage(""); setLink(""); setImageUrl(""); setNotice("帖子发布成功");
      await loadPosts();
    } catch (e: any) { setNotice(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  };

  if (!status.connected) return (
    <section className="max-w-4xl space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">公共主页管理</h1><p className="text-slate-500 mt-1">通过 Meta OAuth 连接企业广告账户与公共主页。</p></div>
      <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
        <h2 className="text-lg font-semibold">尚未连接 Meta</h2>
        <p className="text-sm text-slate-500 mt-2">授权成功后，现有广告分析继续使用同一企业连接，主页令牌不会显示在页面中。</p>
        <a href="/api/meta-oauth/start" className="inline-flex mt-6 px-5 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700">连接 Facebook 企业资产</a>
        {notice && <p className="mt-4 text-sm text-red-600">{notice}</p>}
      </div>
    </section>
  );

  const selectedPage = status.pages?.find((p) => p.id === pageId);
  return (
    <section className="max-w-6xl space-y-6">
      <div className="flex items-start justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900">公共主页管理</h1><p className="text-slate-500 mt-1">已连接：{status.user?.name}</p></div>
        <div className="flex gap-2">
          <a href="/api/meta-oauth/start" className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg bg-white text-sm"><RefreshCw className="w-4 h-4" />重新授权</a>
          <button onClick={async () => { await axios.post("/api/meta-oauth/disconnect"); setStatus({ connected: false }); }} className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg bg-white text-sm text-red-600"><Unplug className="w-4 h-4" />断开</button>
        </div>
      </div>

      {!!status.missingScopes?.length && <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">缺少权限：{status.missingScopes.join(", ")}。请点击“重新授权”。</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <aside className="bg-white border rounded-2xl p-4 shadow-sm h-fit">
          <h2 className="font-semibold px-2 mb-3">可管理主页</h2>
          <div className="space-y-1">{status.pages?.map((page) => <button key={page.id} onClick={() => setPageId(page.id)} className={`w-full text-left p-3 rounded-xl ${pageId === page.id ? "bg-blue-50 text-blue-700" : "hover:bg-slate-50"}`}><div className="font-medium">{page.name}</div><div className="text-xs opacity-70 mt-1">{page.id}</div></button>)}</div>
        </aside>

        <div className="space-y-6">
          <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
            <div><h2 className="font-semibold text-lg">发布到 {selectedPage?.name}</h2><p className="text-xs text-slate-500 mt-1">提交后会立即发布，请先检查主页、文案、链接和图片。</p></div>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={10000} placeholder="帖子文案" className="w-full border rounded-xl p-3 outline-none focus:ring-2 focus:ring-blue-200" />
            <div className="relative"><LinkIcon className="absolute left-3 top-3 w-4 h-4 text-slate-400" /><input value={link} onChange={(e) => setLink(e.target.value)} placeholder="商品链接（可选）" className="w-full border rounded-xl py-2.5 pl-10 pr-3" /></div>
            <div className="relative"><FileText className="absolute left-3 top-3 w-4 h-4 text-slate-400" /><input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="公开图片 URL（可选，填写后发布为图片帖）" className="w-full border rounded-xl py-2.5 pl-10 pr-3" /></div>
            <div className="flex items-center justify-between"><span className={`text-sm ${notice.includes("成功") ? "text-emerald-600" : "text-red-600"}`}>{notice}</span><button disabled={loading || !pageId} onClick={publish} className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg disabled:opacity-50"><Send className="w-4 h-4" />{loading ? "发布中..." : "立即发布"}</button></div>
          </div>

          <div className="bg-white border rounded-2xl p-6 shadow-sm">
            <div className="flex justify-between mb-4"><h2 className="font-semibold text-lg">近期帖子</h2><button onClick={() => loadPosts()} className="text-sm text-blue-600">刷新</button></div>
            <div className="divide-y">{posts.map((post) => <article key={post.id} className="py-4 first:pt-0"><div className="flex gap-4">{post.full_picture && <img src={post.full_picture} className="w-20 h-20 rounded-lg object-cover" />}<div className="min-w-0 flex-1"><p className="text-sm whitespace-pre-wrap line-clamp-4">{post.message || "（无文字）"}</p><div className="flex gap-3 mt-2 text-xs text-slate-500"><span>{post.created_time ? new Date(post.created_time).toLocaleString() : ""}</span>{post.permalink_url && <a href={post.permalink_url} target="_blank" rel="noreferrer" className="text-blue-600 inline-flex gap-1">查看帖子<ExternalLink className="w-3 h-3" /></a>}</div></div></div></article>)}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
