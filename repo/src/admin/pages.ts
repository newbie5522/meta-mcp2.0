type AdminPage =
  | "dashboard"
  | "stores"
  | "ad-accounts"
  | "account-spend"
  | "account-analysis"
  | "mappings"
  | "sync-logs"
  | "store-report"
  | "country-report"
  | "product-report"
  | "ai-suggestions"
  | "ai-settings";

const navItems: Array<{ page: AdminPage; href: string; label: string }> = [
  { page: "dashboard", href: "/admin", label: "仪表盘" },
  { page: "stores", href: "/admin/stores", label: "店铺管理" },
  { page: "ad-accounts", href: "/admin/ad-accounts", label: "广告账户" },
  { page: "account-spend", href: "/admin/account-spend", label: "账户数据" },
  { page: "account-analysis", href: "/admin/account-analysis", label: "账户分析" },
  { page: "mappings", href: "/admin/mappings", label: "店铺账户映射" },
  { page: "sync-logs", href: "/admin/sync-logs", label: "同步日志" },
  { page: "store-report", href: "/admin/reports/store", label: "店铺分析" },
  { page: "country-report", href: "/admin/reports/countries", label: "国家分析" },
  { page: "product-report", href: "/admin/reports/products", label: "产品分析" },
  { page: "ai-suggestions", href: "/admin/ai-suggestions", label: "AI 建议" },
  { page: "ai-settings", href: "/admin/ai-settings", label: "AI 设置" },
];

function pageTitle(page: AdminPage): string {
  return navItems.find((item) => item.page === page)?.label ?? "仪表盘";
}

function nav(active: AdminPage): string {
  return navItems
    .map((item) => `<a class="${item.page === active ? "active" : ""}" href="${item.href}">${item.label}</a>`)
    .join("");
}

function styles(): string {
  return `<style>
    :root{color-scheme:light;--bg:#f4f6f8;--panel:#fff;--line:#d7dde5;--text:#17202e;--muted:#667085;--brand:#155eef;--danger:#b42318;--ok:#067647}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px}
    header{height:56px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 20px;position:sticky;top:0;z-index:2}
    header strong{font-size:15px}
    header form{margin:0}
    nav{width:220px;background:#101828;color:#e4e7ec;min-height:calc(100vh - 56px);position:fixed;top:56px;left:0;padding:12px}
    nav a{display:block;color:#cbd5e1;text-decoration:none;padding:10px 12px;border-radius:6px;margin-bottom:4px;font-weight:600}
    nav a.active,nav a:hover{background:#1d2939;color:#fff}
    main{margin-left:220px;padding:20px;max-width:1480px}
    h1{font-size:22px;margin:0 0 16px}
    h2{font-size:16px;margin:0 0 12px}
    h3{font-size:13px;margin:0 0 8px}
    section{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:16px}
    .toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .metric{background:#fff;border:1px solid var(--line);border-radius:8px;padding:14px}
    .metric span{display:block;color:var(--muted);font-size:12px;font-weight:700}
    .metric strong{display:block;font-size:24px;margin-top:6px;word-break:break-word}
    table{width:100%;border-collapse:collapse;background:#fff}
    th,td{border-bottom:1px solid #eef1f5;text-align:left;padding:9px 8px;vertical-align:top}
    th{font-size:12px;color:#475467;background:#f8fafc}
    tr:hover td{background:#fbfcfe}
    input,select,textarea{border:1px solid #c8d0db;border-radius:6px;padding:8px 9px;background:#fff;color:var(--text);font:inherit;min-height:36px}
    textarea{width:100%;min-height:150px;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}
    label{display:grid;gap:5px;font-size:12px;color:#475467;font-weight:700}
    .form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;align-items:end}
    button,.button-link{border:1px solid #b8c2d1;background:#fff;color:#17202e;border-radius:6px;padding:8px 11px;font-weight:700;cursor:pointer;min-height:36px;text-decoration:none;display:inline-flex;align-items:center}
    button.primary,.button-link.primary{background:var(--brand);border-color:var(--brand);color:#fff}
    button.danger{background:#fff;border-color:#fecdca;color:var(--danger)}
    button:disabled{opacity:.55;cursor:not-allowed}
    .status{min-height:20px;color:var(--muted);font-size:13px;margin-top:8px}
    .error{color:var(--danger)}
    .ok{color:var(--ok)}
    .row-actions{display:flex;gap:6px;flex-wrap:wrap}
    .split{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .report-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:12px}
    .table-scroll{overflow:auto}
    .advice{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    .advice ul{margin:0;padding-left:18px}
    .advice li{margin-bottom:5px}
    .pill{display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font-size:12px;font-weight:800;background:#eef2f6;color:#344054}
    .pill.pending{background:#fff7e6;color:#b54708}
    .pill.accepted{background:#eef4ff;color:#3538cd}
    .pill.done{background:#ecfdf3;color:#067647}
    .pill.rejected{background:#fef3f2;color:#b42318}
    .empty{color:var(--muted);padding:12px;border:1px dashed var(--line);border-radius:8px;background:#fbfcfe}
    .ai-launcher{position:fixed;right:22px;bottom:22px;z-index:20;border-radius:999px;background:#155eef;color:#fff;border:0;box-shadow:0 10px 30px rgba(21,94,239,.25)}
    .ai-panel{position:fixed;right:22px;bottom:76px;width:min(440px,calc(100vw - 32px));height:min(640px,calc(100vh - 110px));background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 50px rgba(15,23,42,.18);z-index:20;display:none;grid-template-rows:auto 1fr auto}
    .ai-panel.open{display:grid}
    .ai-panel header{height:auto;position:static;border-bottom:1px solid var(--line);padding:12px 14px;gap:8px}
    .ai-log{padding:12px;overflow:auto;display:grid;gap:10px;background:#f8fafc}
    .ai-msg{padding:10px;border-radius:8px;background:#fff;border:1px solid #eef1f5;white-space:pre-wrap}
    .ai-msg.user{background:#eef4ff;border-color:#c7d7fe}
    .ai-form{display:grid;gap:8px;padding:12px;border-top:1px solid var(--line)}
    .ai-form textarea{min-height:74px}
    @media (max-width:900px){nav{position:static;width:auto;min-height:0;display:flex;overflow:auto}main{margin-left:0}.grid,.form-grid,.split,.report-grid,.advice{grid-template-columns:1fr}header{position:static}}
  </style>`;
}

function script(): string {
  return `<script>
    const page = document.body.dataset.page;
    const state = { stores: [], adAccounts: [], validMappingRows: [], aiConversationId: null };

    function $(id){ return document.getElementById(id); }
    function esc(value){ return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch])); }
    function fmtDate(value){ return value ? new Date(value).toLocaleString("zh-CN") : ""; }
    function setStatus(id, text, kind = ""){ const el = $(id); if (!el) return; el.className = "status " + kind; el.textContent = text || ""; }
    function formData(form){ return Object.fromEntries(new FormData(form).entries()); }
    function compact(obj){ return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== "" && value !== undefined && value !== null)); }
    function accountId(account){ return account.displayAccountId || String(account.metaAccountId || "").replace(/^act_/, ""); }
    function todayIso(){ return new Date().toISOString().slice(0, 10); }
    function addDaysIso(days){ const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
    function reportQuery(formId){ return new URLSearchParams(compact(formData($(formId)))).toString(); }
    function actionText(row){ return Array.isArray(row.suggestions) ? row.suggestions.join("；") : ""; }
    function suggestionStatusLabel(status){ return ({ pending: "待处理", accepted: "已采纳", rejected: "已拒绝", done: "已完成" })[status] || status; }
    function suggestionStatusBadge(status){ return '<span class="pill ' + esc(status) + '">' + esc(suggestionStatusLabel(status)) + '</span>'; }
    function suggestionEntity(row){
      const entity = row.entity || {};
      const label = entity.label || row.report?.entityId || "";
      return entity.href ? '<a class="button-link" href="' + esc(entity.href) + '">' + esc(label) + '</a>' : esc(label);
    }
    function entityAiButton(type, id, label = "AI分析"){
      return id ? '<button data-ai-entity-type="' + esc(type) + '" data-ai-entity-id="' + esc(id) + '">' + esc(label) + '</button>' : "";
    }
    function reportList(values){
      if (!Array.isArray(values) || values.length === 0) return '<div class="empty">暂无内容</div>';
      return '<ul>' + values.map(value => '<li>' + esc(value) + '</li>').join("") + '</ul>';
    }
    function renderSuggestionReport(payload){
      const report = payload.report || {};
      const suggestion = payload.suggestion || {};
      const metadata = report.metadata || {};
      const data = report.dataBasis || {};
      const advice = metadata.structuredAdvice || {};
      const entity = payload.entity || {};
      const details = [
        '<section><h2>深度分析报告</h2>',
        '<p><strong>' + esc(entity.label || report.entityId || "") + '</strong></p>',
        '<p>' + esc(report.conclusion || "") + '</p>',
        '<div class="report-grid">' + renderMetrics({
          "报告类型": report.type || "",
          "优先级": "P" + (report.priority || suggestion.priority || 3),
          "模型": report.model || "local-structured-analysis",
          "建议状态": suggestionStatusLabel(suggestion.status || "pending"),
        }) + '</div>',
        '<h3>AI 深度结论</h3><div class="ai-msg assistant">' + esc(metadata.aiNarrative || "暂无 AI 文本，使用本地规则分析结果。") + '</div>',
        '<h3>主要问题</h3>' + reportList(advice.mainIssues),
        '<h3>建议动作</h3>' + reportList(advice.suggestedActions),
        '<h3>风险提醒</h3>' + reportList(report.riskPoints || advice.riskWarnings),
        '<h3>执行清单</h3>' + reportList(suggestion.executionChecklist || advice.operatorChecklist),
        '<h3>账户核心数据</h3><div class="report-grid">' + renderMetrics(data.overview || {}) + '</div>',
        '<h3>重点国家</h3>' + simpleTable(data.countries || [], [
          { label: "国家", value: "country" }, { label: "消耗", value: "spend" }, { label: "购买", value: "purchases" }, { label: "ROAS", value: "roas" }, { label: "CTR", value: "ctr" },
        ]),
        '<h3>重点 Campaign</h3>' + simpleTable(data.campaigns || [], [
          { label: "ID", value: "id" }, { label: "名称", value: "name" }, { label: "消耗", value: "spend" }, { label: "购买", value: "purchases" }, { label: "ROAS", value: "roas" }, { label: "建议", value: "action" },
        ]),
        '<h3>重点 Ad Set</h3>' + simpleTable(data.adsets || [], [
          { label: "ID", value: "id" }, { label: "名称", value: "name" }, { label: "消耗", value: "spend" }, { label: "购买", value: "purchases" }, { label: "ROAS", value: "roas" }, { label: "建议", value: "action" },
        ]),
        '<h3>重点广告/素材</h3>' + simpleTable(data.ads || [], [
          { label: "ID", value: "id" }, { label: "名称", value: "name" }, { label: "消耗", value: "spend" }, { label: "CTR", value: "ctr" }, { label: "购买", value: "purchases" }, { label: "ROAS", value: "roas" }, { label: "素材判断", value: "creativeJudgement" }, { label: "建议", value: "action" },
        ]),
        '</section>',
      ];
      $("suggestion-report").innerHTML = details.join("");
      $("suggestion-report").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    function aiContext(){
      return compact({
        page,
        adAccountId: $("analysis-account")?.value,
        since: $("analysis-since")?.value || $("spend-since")?.value,
        until: $("analysis-until")?.value || $("spend-until")?.value,
      });
    }
    function appendAiMessage(role, text){
      const log = $("ai-log");
      if (!log) return;
      log.insertAdjacentHTML("beforeend", '<div class="ai-msg ' + esc(role) + '">' + esc(text) + '</div>');
      log.scrollTop = log.scrollHeight;
    }
    function readFileAsBase64(file){
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
        reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
        reader.readAsDataURL(file);
      });
    }
    async function api(path, options = {}){
      const response = await fetch(path, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || payload.error || "请求失败");
      return payload.data;
    }
    async function loadStores(){ state.stores = await api("/api/stores"); return state.stores; }
    async function loadAdAccounts(){ state.adAccounts = await api("/api/ad-accounts"); return state.adAccounts; }
    function storesOptions(){ return state.stores.map(store => '<option value="' + esc(store.id) + '">' + esc(store.name) + ' / ' + esc(store.domain) + '</option>').join(""); }
    function accountsOptions(){ return state.adAccounts.map(account => '<option value="' + esc(account.id) + '">' + esc(accountId(account)) + ' / ' + esc(account.name || "") + '</option>').join(""); }
    async function initReportForm(formId){
      await loadStores();
      if (state.stores.length === 0) {
        setStatus("report-status", "暂无店铺，请先新增店铺。", "error");
        return false;
      }
      const storeSelect = $(formId).querySelector('[name="storeId"]');
      storeSelect.innerHTML = storesOptions();
      const since = $(formId).querySelector('[name="since"]');
      const until = $(formId).querySelector('[name="until"]');
      if (since && !since.value) since.value = addDaysIso(-6);
      if (until && !until.value) until.value = todayIso();
      return true;
    }
    function renderMetrics(metrics){
      return Object.entries(metrics).map(([label, value]) => '<div class="metric"><span>' + esc(label) + '</span><strong>' + esc(value ?? "N/A") + '</strong></div>').join("");
    }
    function renderAdvice(advice){
      if (!advice) return "";
      const section = (title, values) => '<div><h3>' + title + '</h3><ul>' + (values || []).map(value => '<li>' + esc(value) + '</li>').join("") + '</ul></div>';
      return '<section><h2>AI 建议</h2><p><strong>' + esc(advice.currentConclusion || "") + '</strong></p><div class="advice">' +
        section("主要问题", advice.mainIssues) +
        section("数据依据", advice.dataBasis) +
        section("建议动作", advice.suggestedActions) +
        section("风险提醒", advice.riskWarnings) +
        section("运营执行清单", advice.operatorChecklist) +
        '</div></section>';
    }
    function simpleTable(rows, columns){
      if (!rows || rows.length === 0) return '<div class="empty">暂无数据</div>';
      return '<div class="table-scroll"><table><thead><tr>' + columns.map(col => '<th>' + esc(col.label) + '</th>').join("") + '</tr></thead><tbody>' +
        rows.map(row => '<tr>' + columns.map(col => {
          if (col.html) return '<td>' + col.html(row) + '</td>';
          const value = typeof col.value === "function" ? col.value(row) : row[col.value];
          return '<td>' + esc(value) + '</td>';
        }).join("") + '</tr>').join("") +
        '</tbody></table></div>';
    }
    function renderLogsTable(logs){
      return simpleTable(logs || [], [
        { label: "类型", value: "type" },
        { label: "状态", value: "status" },
        { label: "开始时间", value: row => fmtDate(row.startedAt) },
        { label: "结束时间", value: row => fmtDate(row.finishedAt) },
        { label: "抓取", value: "recordsFetched" },
        { label: "保存", value: "recordsSaved" },
        { label: "错误", value: row => row.errorMessage || "" },
      ]);
    }
    async function dashboard(){
      const summary = await api("/api/dashboard");
      $("metrics").innerHTML = renderMetrics({
        "店铺数": summary.storeCount,
        "启用店铺": summary.activeStoreCount,
        "活跃广告账户": summary.adAccountCount,
        "已绑定账户": summary.mappedAdAccountCount,
      });
      $("recent-logs").innerHTML = renderLogsTable(summary.recentLogs || []);
    }
    async function storesPage(){
      const stores = await loadStores();
      $("stores-table").innerHTML = simpleTable(stores, [
        { label: "店铺名称", value: "name" },
        { label: "平台", value: "platform" },
        { label: "域名", value: "domain" },
        { label: "API 基础 URL", value: "apiBaseUrl" },
        { label: "App Key", value: row => row.appKey || "" },
        { label: "币种", value: row => row.currency || "" },
        { label: "状态", value: row => row.status === "active" ? "启用" : "停用" },
        { label: "更新时间", value: row => fmtDate(row.updatedAt) },
        { label: "操作", html: store => '<div class="row-actions"><button data-test-token="' + esc(store.id) + '">测试令牌</button><button data-sync-profile="' + esc(store.id) + '">同步资料</button><button data-sync-orders="' + esc(store.id) + '">同步订单</button><button class="danger" data-deactivate="' + esc(store.id) + '">停用</button></div>' },
      ]);
    }
    async function adAccountsPage(){
      const accounts = await loadAdAccounts();
      $("accounts-table").innerHTML = simpleTable(accounts, [
        { label: "账户 ID", value: accountId },
        { label: "账户名称", value: row => row.name || "" },
        { label: "状态", value: row => row.displayStatus || (row.status === "1" ? "活跃" : "停用") },
        { label: "操作", html: account => '<div class="row-actions"><button data-sync-structure="' + esc(account.id) + '">同步结构</button><button data-sync-insights="' + esc(account.id) + '">同步30天数据</button><button data-sync-creatives="' + esc(account.id) + '">同步素材</button><a class="button-link primary" href="/admin/account-analysis?adAccountId=' + encodeURIComponent(account.id) + '">分析</a></div>' },
      ]);
    }
    async function accountSpendPage(){
      if (!$("spend-since").value) $("spend-since").value = addDaysIso(-29);
      if (!$("spend-until").value) $("spend-until").value = todayIso();
      await loadAccountSpend();
    }
    async function loadAccountSpend(){
      const query = new URLSearchParams(compact({ since: $("spend-since").value, until: $("spend-until").value })).toString();
      const report = await api("/api/ad-accounts/spend?" + query);
      $("account-spend-table").innerHTML = simpleTable(report.accounts || [], [
        { label: "账户 ID", value: "accountId" },
        { label: "账户名称", value: "name" },
        { label: "状态", value: "status" },
        { label: "绑定店铺", value: "storeName" },
        { label: "消耗", value: "spend" },
        { label: "展示", value: "impressions" },
        { label: "点击", value: "clicks" },
        { label: "CTR", value: "ctr" },
        { label: "CPC", value: "cpc" },
        { label: "CPM", value: "cpm" },
        { label: "Meta订单", value: "purchases" },
        { label: "Meta ROAS", value: "roas" },
        { label: "操作", html: row => '<a class="button-link primary" href="/admin/account-analysis?adAccountId=' + encodeURIComponent(row.id) + '">详细分析</a>' },
      ]);
    }
    async function accountAnalysisPage(){
      await loadAdAccounts();
      const select = $("analysis-account");
      select.innerHTML = accountsOptions();
      const targetId = new URLSearchParams(location.search).get("adAccountId");
      if (targetId) select.value = targetId;
      if (!$("analysis-since").value) $("analysis-since").value = addDaysIso(-29);
      if (!$("analysis-until").value) $("analysis-until").value = todayIso();
      if (state.adAccounts.length === 0) {
        setStatus("analysis-status", "暂无活跃广告账户，请先同步广告账户。", "error");
        return;
      }
      await loadAccountAnalysis();
    }
    async function loadAccountAnalysis(){
      const query = new URLSearchParams(compact({
        adAccountId: $("analysis-account").value,
        since: $("analysis-since").value,
        until: $("analysis-until").value,
      })).toString();
      const report = await api("/api/analysis/account-detail?" + query);
      $("account-analysis-title").textContent = "账户概览：" + report.account.accountId + " / " + (report.account.name || "");
      $("account-overview").innerHTML = renderMetrics({
        "消耗": report.overview.spend,
        "展示": report.overview.impressions,
        "点击": report.overview.clicks,
        "CTR": report.overview.ctr,
        "CPC": report.overview.cpc,
        "CPM": report.overview.cpm,
        "Meta订单": report.overview.purchases,
        "Meta ROAS": report.overview.roas,
      });
      $("account-advice").innerHTML = renderAdvice(report.advice);
      $("account-countries").innerHTML = simpleTable(report.countries || [], [
        { label: "国家", value: "country" }, { label: "消耗", value: "spend" }, { label: "购买", value: "purchases" }, { label: "ROAS", value: "roas" }, { label: "CTR", value: "ctr" },
      ]);
      $("campaign-analysis").innerHTML = simpleTable(report.campaigns || [], [
        { label: "广告系列 ID", value: "campaignId" }, { label: "名称", value: "campaignName" }, { label: "消耗", value: "spend" }, { label: "购买", value: "purchases" }, { label: "ROAS", value: "roas" }, { label: "建议", value: "action" }, { label: "依据", value: actionText }, { label: "AI", html: row => entityAiButton("campaign", row.campaignId) },
      ]);
      $("adset-analysis").innerHTML = simpleTable(report.adsets || [], [
        { label: "广告组 ID", value: "adsetId" }, { label: "名称", value: "adsetName" }, { label: "所属系列", value: "campaignName" }, { label: "消耗", value: "spend" }, { label: "购买", value: "purchases" }, { label: "ROAS", value: "roas" }, { label: "建议", value: "action" }, { label: "AI", html: row => entityAiButton("adset", row.adsetId) },
      ]);
      $("ad-analysis").innerHTML = simpleTable(report.ads || [], [
        { label: "广告 ID", value: "adId" }, { label: "广告名", value: "adName" }, { label: "Creative ID", value: "creativeId" }, { label: "消耗", value: "spend" }, { label: "CTR", value: "ctr" }, { label: "购买", value: "purchases" }, { label: "ROAS", value: "roas" }, { label: "素材判断", value: "creativeJudgement" }, { label: "建议", value: "action" }, { label: "AI", html: row => '<div class="row-actions">' + entityAiButton("ad", row.adId, "广告分析") + entityAiButton("creative", row.creativeId, "素材分析") + '</div>' },
      ]);
    }
    async function mappingsPage(){
      await Promise.all([loadStores(), loadAdAccounts()]);
      $("bind-store").innerHTML = storesOptions();
      $("bind-account").innerHTML = accountsOptions();
      $("mapping-summary").innerHTML = simpleTable(state.adAccounts.filter(account => account.store), [
        { label: "店铺", value: row => row.store?.name || "" },
        { label: "广告账户 ID", value: accountId },
        { label: "广告账户名称", value: "name" },
      ]);
    }
    async function syncLogsPage(){
      const type = $("log-type")?.value || "";
      const logs = await api("/api/sync-logs?limit=100" + (type ? "&type=" + encodeURIComponent(type) : ""));
      $("logs-table").innerHTML = renderLogsTable(logs);
    }
    async function storeReportPage(){
      if (!await initReportForm("store-report-form")) return;
      await loadStoreReport();
    }
    async function loadStoreReport(){
      const q = reportQuery("store-report-form");
      const [overview, accounts, creatives, trends] = await Promise.all([
        api("/api/analysis/store-overview?" + q),
        api("/api/analysis/ad-accounts?" + q),
        api("/api/analysis/creatives?" + q),
        api("/api/analysis/trends?" + q),
      ]);
      $("store-overview").innerHTML = '<section><h2>店铺总览</h2><div class="report-grid">' + renderMetrics({
        "订单数": overview.orderCount,
        "销售额": overview.salesAmount,
        "广告花费": overview.adSpend,
        "真实 ROAS": overview.realRoas,
        "Meta ROAS": overview.metaRoas,
        "Meta订单": overview.metaPurchases,
        "订单差异": overview.orderGap,
      }) + '</div><p>' + esc(overview.coreProblemSummary) + '</p></section>' + renderAdvice(overview.aiAdvice);
      $("account-report").innerHTML = '<section><h2>店铺内广告账户</h2>' + simpleTable(accounts.accounts || [], [
        { label: "账户", value: "accountName" }, { label: "花费", value: "spend" }, { label: "Meta订单", value: "metaPurchases" }, { label: "真实订单趋势", value: "storeOrderTrend" }, { label: "预算建议", value: "budgetSuggestion" },
      ]) + '</section>';
      $("creative-report").innerHTML = '<section><h2>素材分析</h2>' + simpleTable(creatives.creatives || [], [
        { label: "广告", value: "adName" }, { label: "素材", value: "creativeId" }, { label: "花费", value: "spend" }, { label: "CTR", value: "ctr" }, { label: "购买", value: "purchases" }, { label: "ROAS", value: "roas" }, { label: "判断", value: "judgement" },
      ]) + '</section>';
      $("trend-report").innerHTML = '<section><h2>趋势分析</h2><div class="report-grid">' + renderMetrics({
        "CTR趋势": trends.ctrTrend,
        "CPM趋势": trends.cpmTrend,
        "CPA趋势": trends.cpaTrend,
        "素材疲劳": trends.creativeFatigueRisk,
      }) + '</div></section>';
    }
    async function countryReportPage(){
      if (!await initReportForm("country-report-form")) return;
      await loadCountryReport();
    }
    async function loadCountryReport(){
      const countries = await api("/api/analysis/countries?" + reportQuery("country-report-form"));
      $("country-report").innerHTML = simpleTable(countries.countries || [], [
        { label: "国家", value: "country" }, { label: "订单数", value: "orderCount" }, { label: "销售额", value: "salesAmount" }, { label: "花费", value: "adSpend" }, { label: "真实ROAS", value: "realRoas" }, { label: "MetaROAS", value: "metaRoas" }, { label: "建议", value: "suggestion" },
      ]);
    }
    async function productReportPage(){
      if (!await initReportForm("product-report-form")) return;
      await loadProductReport();
    }
    async function loadProductReport(){
      const products = await api("/api/analysis/products?" + reportQuery("product-report-form"));
      $("product-report").innerHTML = simpleTable(products.products || [], [
        { label: "产品名", value: "productName" }, { label: "SKU", value: "sku" }, { label: "订单数", value: "orderCount" }, { label: "销售额", value: "salesAmount" }, { label: "主要国家", value: row => (row.mainCountries || []).map(item => item.country + "(" + item.orders + ")").join(", ") }, { label: "单独投放", value: row => row.suitableForSingleCampaign ? "是" : "否" }, { label: "混投", value: row => row.suitableForMixedCampaign ? "是" : "否" }, { label: "新素材", value: row => row.suitableForNewCreative ? "是" : "否" },
      ]);
    }
    async function aiSettingsPage(){
      const providers = await api("/api/ai/providers");
      $("ai-provider-table").innerHTML = simpleTable(providers || [], [
        { label: "Provider", value: "provider" },
        { label: "名称", value: "displayName" },
        { label: "Key", value: "apiKeyMasked" },
        { label: "聊天模型", value: "defaultChatModel" },
        { label: "分析模型", value: "defaultAnalysisModel" },
        { label: "创意模型", value: "defaultCreativeModel" },
        { label: "启用", value: row => row.enabled ? "是" : "否" },
      ]);
    }
    async function aiSuggestionsPage(){
      if ($("suggestion-account")) {
        const selected = $("suggestion-account").value;
        await loadAdAccounts();
        $("suggestion-account").innerHTML = accountsOptions();
        if (selected) $("suggestion-account").value = selected;
        if (!$("suggestion-since").value) $("suggestion-since").value = addDaysIso(-29);
        if (!$("suggestion-until").value) $("suggestion-until").value = todayIso();
        if ($("generate-account-analysis")) $("generate-account-analysis").disabled = state.adAccounts.length === 0;
      }
      const status = $("suggestion-status")?.value || "";
      const query = new URLSearchParams(compact({ status, limit: 100 })).toString();
      const result = await api("/api/ai/suggestions?" + query);
      const summary = result.summary || {};
      $("suggestion-metrics").innerHTML = renderMetrics({
        "待处理": summary.pending || 0,
        "已采纳": summary.accepted || 0,
        "已完成": summary.done || 0,
        "已拒绝": summary.rejected || 0,
      });
      $("suggestions-table").innerHTML = simpleTable(result.items || [], [
        { label: "状态", html: row => suggestionStatusBadge(row.status) },
        { label: "优先级", value: row => "P" + row.priority },
        { label: "对象", html: suggestionEntity },
        { label: "结论", value: row => row.report?.conclusion || "" },
        { label: "建议动作", value: "action" },
        { label: "依据", value: "rationale" },
        { label: "观察周期", value: row => row.report?.observationWindow || "" },
        { label: "创建时间", value: row => fmtDate(row.createdAt) },
        { label: "操作", html: row => '<div class="row-actions"><button data-suggestion-report="' + esc(row.id) + '">查看报告</button><button data-suggestion-id="' + esc(row.id) + '" data-suggestion-status="accepted">采纳</button><button data-suggestion-id="' + esc(row.id) + '" data-suggestion-status="done">完成</button><button data-suggestion-id="' + esc(row.id) + '" data-suggestion-status="rejected">拒绝</button><button data-suggestion-id="' + esc(row.id) + '" data-suggestion-status="pending">待处理</button></div>' },
      ]);
    }
    document.addEventListener("submit", async (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      event.preventDefault();
      try {
        if (form.id === "create-store-form") {
          await api("/api/stores", { method: "POST", body: JSON.stringify(compact(formData(form))) });
          setStatus("stores-status", "店铺已创建。", "ok");
          form.reset();
          await storesPage();
        }
        if (form.id === "bind-form") {
          await api("/api/mappings/bind", { method: "POST", body: JSON.stringify(formData(form)) });
          setStatus("mapping-status", "绑定成功。", "ok");
          await mappingsPage();
        }
        if (form.id === "csv-form") {
          const data = new FormData(form);
          const file = data.get("mappingFile");
          const result = file && file instanceof File && file.size > 0
            ? await api("/api/mappings/validate-file", { method: "POST", body: JSON.stringify({ fileName: file.name, contentBase64: await readFileAsBase64(file) }) })
            : await api("/api/mappings/validate-csv", { method: "POST", body: JSON.stringify({ csv: data.get("csv") }) });
          state.validMappingRows = result.validRows || [];
          $("import-confirmed").disabled = state.validMappingRows.length === 0;
          $("csv-result").innerHTML = simpleTable([...(result.errors || []), ...(result.recommendations || [])], [
            { label: "行", value: "row" }, { label: "类型", value: "type" }, { label: "信息", value: row => row.message || row.reason || "" },
          ]);
          setStatus("csv-status", "有效行 " + state.validMappingRows.length + " 条。", result.errors?.length ? "error" : "ok");
        }
        if (form.id === "account-spend-form") await loadAccountSpend();
        if (form.id === "account-analysis-form") await loadAccountAnalysis();
        if (form.id === "store-report-form") await loadStoreReport();
        if (form.id === "country-report-form") await loadCountryReport();
        if (form.id === "product-report-form") await loadProductReport();
        if (form.id === "ai-provider-form") {
          const body = compact(formData(form));
          body.enabled = body.enabled === "on";
          await api("/api/ai/providers", { method: "POST", body: JSON.stringify(body) });
          setStatus("ai-settings-status", "AI Provider 已保存，Key 已加密入库。", "ok");
          form.reset();
          await aiSettingsPage();
        }
        if (form.id === "ai-form") {
          const message = formData(form).message;
          appendAiMessage("user", message);
          form.reset();
          const result = await api("/api/ai/chat", { method: "POST", body: JSON.stringify({ message, context: aiContext(), conversationId: state.aiConversationId }) });
          state.aiConversationId = result.conversationId;
          appendAiMessage("assistant", result.answer);
        }
      } catch (error) {
        setStatus(form.dataset.status || "page-status", error.message, "error");
      }
    });
    document.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      try {
        const deactivateId = target.getAttribute("data-deactivate");
        const syncOrdersId = target.getAttribute("data-sync-orders");
        const testTokenId = target.getAttribute("data-test-token");
        const syncProfileId = target.getAttribute("data-sync-profile");
        const syncInsightsId = target.getAttribute("data-sync-insights");
        const syncCreativesId = target.getAttribute("data-sync-creatives");
        const syncStructureId = target.getAttribute("data-sync-structure");
        const suggestionId = target.getAttribute("data-suggestion-id");
        const suggestionStatus = target.getAttribute("data-suggestion-status");
        const suggestionReportId = target.getAttribute("data-suggestion-report");
        const aiEntityType = target.getAttribute("data-ai-entity-type");
        const aiEntityId = target.getAttribute("data-ai-entity-id");
        if (deactivateId) { await api("/api/stores/" + encodeURIComponent(deactivateId) + "/deactivate", { method: "POST", body: "{}" }); await storesPage(); }
        if (syncOrdersId) { const result = await api("/api/stores/" + encodeURIComponent(syncOrdersId) + "/sync-orders", { method: "POST", body: JSON.stringify({}) }); await storesPage(); setStatus("page-status", "订单同步完成，保存 " + result.saved + " 条。", "ok"); }
        if (testTokenId) { const result = await api("/api/stores/" + encodeURIComponent(testTokenId) + "/test-token", { method: "POST", body: "{}" }); setStatus("page-status", result.ok ? "Token 可用。" : "Token 不可用。", result.ok ? "ok" : "error"); }
        if (syncProfileId) { await api("/api/stores/" + encodeURIComponent(syncProfileId) + "/sync-profile", { method: "POST", body: "{}" }); await storesPage(); setStatus("page-status", "店铺资料已同步。", "ok"); }
        if (target.id === "sync-accounts") { const result = await api("/api/ad-accounts/sync", { method: "POST", body: JSON.stringify({ limit: 500, activeLastDays: 90 }) }); await adAccountsPage(); setStatus("accounts-status", "同步完成，保存 " + result.saved + " 个账户。", "ok"); }
        if (syncStructureId) { const result = await api("/api/meta-structure/sync-account", { method: "POST", body: JSON.stringify({ adAccountId: syncStructureId, limit: 500, maxPages: 10 }) }); setStatus("page-status", "广告结构已同步：Campaign " + result.saved.campaignsSaved + "，Ad Set " + result.saved.adsetsSaved + "，Ad " + result.saved.adsSaved + "。", "ok"); }
        if (syncInsightsId) { const result = await api("/api/meta-insights/sync-account", { method: "POST", body: JSON.stringify({ adAccountId: syncInsightsId, days: 30, level: "ad", countryBreakdown: true, maxPages: 10 }) }); setStatus("page-status", "Meta 数据已同步，保存 " + result.saved + " 行。", "ok"); }
        if (syncCreativesId) { const result = await api("/api/meta-creatives/sync-account", { method: "POST", body: JSON.stringify({ adAccountId: syncCreativesId, limit: 250 }) }); setStatus("page-status", "素材快照已同步，保存 " + result.saved + " 条。", "ok"); }
        if (target.id === "import-confirmed") { await api("/api/mappings/import-confirmed", { method: "POST", body: JSON.stringify({ rows: state.validMappingRows }) }); state.validMappingRows = []; await mappingsPage(); setStatus("page-status", "映射已导入。", "ok"); }
        if (target.id === "refresh-logs") await syncLogsPage();
        if (target.id === "retry-failed-logs") { const result = await api("/api/sync-logs/retry-failed", { method: "POST", body: JSON.stringify({ limit: 10 }) }); await syncLogsPage(); setStatus("page-status", "已重试 " + result.retried + " 条失败任务。", result.failed ? "error" : "ok"); }
        if (target.id === "run-rule-monitor") { const result = await api("/api/ai/suggestions/run-rules", { method: "POST", body: "{}" }); await aiSuggestionsPage(); setStatus("page-status", "规则检测完成，扫描 " + result.scanned + " 个账户，新增 " + result.reportsCreated + " 份建议。", "ok"); }
        if (target.id === "generate-account-analysis") {
          const body = compact({ adAccountId: $("suggestion-account").value, since: $("suggestion-since").value, until: $("suggestion-until").value });
          const result = await api("/api/ai/suggestions/analyze-account", { method: "POST", body: JSON.stringify(body) });
          await aiSuggestionsPage();
          setStatus("page-status", "账户深度分析已生成，新增 " + result.suggestionsCreated + " 条建议，模型：" + result.model + (result.aiError ? "；AI 调用失败，已使用本地规则兜底。" : "。"), result.aiError ? "error" : "ok");
        }
        if (suggestionReportId) { const result = await api("/api/ai/suggestions/" + encodeURIComponent(suggestionReportId) + "/report"); renderSuggestionReport(result); }
        if (aiEntityType && aiEntityId) {
          const body = compact({ adAccountId: $("analysis-account").value, since: $("analysis-since").value, until: $("analysis-until").value, entityType: aiEntityType, entityId: aiEntityId });
          const result = await api("/api/ai/suggestions/analyze-entity", { method: "POST", body: JSON.stringify(body) });
          setStatus("page-status", "单体深度分析已生成，新增 " + result.suggestionsCreated + " 条建议，模型：" + result.model + (result.aiError ? "；AI 调用失败，已使用本地规则兜底。" : "。"), result.aiError ? "error" : "ok");
        }
        if (suggestionId && suggestionStatus) { await api("/api/ai/suggestions/" + encodeURIComponent(suggestionId), { method: "PATCH", body: JSON.stringify({ status: suggestionStatus }) }); await aiSuggestionsPage(); setStatus("page-status", "建议状态已更新为：" + suggestionStatusLabel(suggestionStatus), "ok"); }
        if (target.id === "ai-toggle") $("ai-panel")?.classList.toggle("open");
        if (target.id === "ai-creative") {
          const result = await api("/api/ai/creative-brief", { method: "POST", body: JSON.stringify({ entityType: "ad", entityId: $("analysis-account")?.value || "current-page", language: "zh-CN", performanceSummary: aiContext() }) });
          appendAiMessage("assistant", result.brief);
          $("ai-panel")?.classList.add("open");
        }
      } catch (error) {
        setStatus("page-status", error.message, "error");
      }
    });
    document.addEventListener("change", async (event) => {
      if (event.target?.id === "log-type") await syncLogsPage();
      if (event.target?.id === "suggestion-status") await aiSuggestionsPage();
    });
    (async function init(){
      try {
        if (page === "dashboard") await dashboard();
        if (page === "stores") await storesPage();
        if (page === "ad-accounts") await adAccountsPage();
        if (page === "account-spend") await accountSpendPage();
        if (page === "account-analysis") await accountAnalysisPage();
        if (page === "mappings") await mappingsPage();
        if (page === "sync-logs") await syncLogsPage();
        if (page === "store-report") await storeReportPage();
        if (page === "country-report") await countryReportPage();
        if (page === "product-report") await productReportPage();
        if (page === "ai-suggestions") await aiSuggestionsPage();
        if (page === "ai-settings") await aiSettingsPage();
      } catch (error) {
        setStatus("page-status", error.message, "error");
      }
    })();
  </script>`;
}

function body(page: AdminPage): string {
  if (page === "dashboard") {
    return `<h1>仪表盘</h1><div id="page-status" class="status"></div><div id="metrics" class="grid"></div><section><h2>最近同步日志</h2><div id="recent-logs"></div></section>`;
  }
  if (page === "stores") {
    return `<h1>店铺管理</h1><section><h2>新增店铺</h2><form id="create-store-form" data-status="stores-status" class="form-grid">
      <label>店铺名称<input name="name" required /></label>
      <label>平台<select name="platform"><option value="shopline">Shopline</option><option value="shoplazza">Shoplazza</option></select></label>
      <label>店铺域名<input name="domain" placeholder="example.com" required /></label>
      <label>API 基础 URL<input name="apiBaseUrl" type="url" placeholder="https://example.com" required /></label>
      <label>App Key<input name="appKey" autocomplete="off" /></label>
      <label>App Secret<input name="appSecret" type="password" autocomplete="new-password" /></label>
      <label>后台 API 访问令牌<input name="apiToken" type="password" autocomplete="new-password" required /></label>
      <label>币种<input name="currency" placeholder="USD" /></label>
      <label>时区<input name="timezone" placeholder="Asia/Shanghai" /></label>
      <button class="primary" type="submit">创建店铺</button>
    </form><div id="stores-status" class="status"></div></section><section><h2>店铺列表</h2><div id="stores-table"></div></section><div id="page-status" class="status"></div>`;
  }
  if (page === "ad-accounts") {
    return `<h1>广告账户</h1><div class="toolbar"><button id="sync-accounts" class="primary">同步近90天活跃账户</button><div id="accounts-status" class="status"></div></div><section><h2>账户列表</h2><div id="accounts-table"></div></section><div id="page-status" class="status"></div>`;
  }
  if (page === "account-spend") {
    return `<h1>账户数据</h1><section><form id="account-spend-form" data-status="spend-status" class="form-grid">
      <label>开始日期<input id="spend-since" name="since" type="date" /></label>
      <label>结束日期<input id="spend-until" name="until" type="date" /></label>
      <button class="primary" type="submit">刷新账户数据</button>
    </form><div id="spend-status" class="status"></div><div id="page-status" class="status"></div></section><section><h2>账户消耗数据</h2><div id="account-spend-table"></div></section>`;
  }
  if (page === "account-analysis") {
    return `<h1>账户分析</h1><section><form id="account-analysis-form" data-status="analysis-status" class="form-grid">
      <label>广告账户<select id="analysis-account" name="adAccountId"></select></label>
      <label>开始日期<input id="analysis-since" name="since" type="date" /></label>
      <label>结束日期<input id="analysis-until" name="until" type="date" /></label>
      <button class="primary" type="submit">生成分析</button>
    </form><div id="analysis-status" class="status"></div><div id="page-status" class="status"></div></section>
    <section><h2 id="account-analysis-title">账户概览</h2><div id="account-overview" class="report-grid"></div></section>
    <div id="account-advice"></div>
    <section><h2>国家表现</h2><div id="account-countries"></div></section>
    <section><h2>广告系列操作建议</h2><div id="campaign-analysis"></div></section>
    <section><h2>广告组操作建议</h2><div id="adset-analysis"></div></section>
    <section><h2>广告操作建议</h2><div id="ad-analysis"></div></section>`;
  }
  if (page === "mappings") {
    return `<h1>店铺账户映射</h1><div id="page-status" class="status"></div><div class="split"><section><h2>手动绑定</h2><form id="bind-form" data-status="mapping-status" class="form-grid">
      <label>店铺<select id="bind-store" name="storeId"></select></label>
      <label>广告账户<select id="bind-account" name="adAccountId"></select></label>
      <button class="primary" type="submit">绑定</button>
    </form><div id="mapping-status" class="status"></div></section><section><h2>CSV / Excel 导入</h2><form id="csv-form" data-status="csv-status"><label>文件<input name="mappingFile" type="file" accept=".csv,.tsv,.xlsx" /></label><textarea name="csv" spellcheck="false">store_name,platform,domain,meta_account_id,meta_account_name</textarea><div class="toolbar"><button type="submit">校验</button><button id="import-confirmed" type="button" class="primary" disabled>确认导入</button></div></form><div id="csv-status" class="status"></div><div id="csv-result"></div></section></div><section><h2>当前映射</h2><div id="mapping-summary"></div></section>`;
  }
  if (page === "store-report") {
    return `<h1>店铺分析</h1><section><form id="store-report-form" data-status="report-status" class="form-grid">
      <label>店铺<select name="storeId"></select></label>
      <label>开始日期<input name="since" type="date" /></label>
      <label>结束日期<input name="until" type="date" /></label>
      <button class="primary" type="submit">刷新</button>
    </form><div id="report-status" class="status"></div><div id="page-status" class="status"></div></section><div id="store-overview"></div><div id="account-report"></div><div id="creative-report"></div><div id="trend-report"></div>`;
  }
  if (page === "country-report") {
    return `<h1>国家分析</h1><section><form id="country-report-form" data-status="report-status" class="form-grid">
      <label>店铺<select name="storeId"></select></label>
      <label>开始日期<input name="since" type="date" /></label>
      <label>结束日期<input name="until" type="date" /></label>
      <button class="primary" type="submit">刷新</button>
    </form><div id="report-status" class="status"></div><div id="page-status" class="status"></div></section><section><h2>国家表现</h2><div id="country-report"></div></section>`;
  }
  if (page === "product-report") {
    return `<h1>产品分析</h1><section><form id="product-report-form" data-status="report-status" class="form-grid">
      <label>店铺<select name="storeId"></select></label>
      <label>开始日期<input name="since" type="date" /></label>
      <label>结束日期<input name="until" type="date" /></label>
      <button class="primary" type="submit">刷新</button>
    </form><div id="report-status" class="status"></div><div id="page-status" class="status"></div></section><section><h2>产品表现</h2><div id="product-report"></div></section>`;
  }
  if (page === "ai-settings") {
    return `<h1>AI 设置</h1><section><h2>新增 / 更新 AI Provider</h2><form id="ai-provider-form" data-status="ai-settings-status" class="form-grid">
      <label>Provider<select name="provider"><option value="gemini">Gemini</option><option value="openai">OpenAI</option></select></label>
      <label>配置名称<input name="displayName" value="default" required /></label>
      <label>API Key<input name="apiKey" type="password" autocomplete="new-password" required /></label>
      <label>聊天模型<input name="defaultChatModel" placeholder="gemini-1.5-flash / gpt-4o-mini" /></label>
      <label>分析模型<input name="defaultAnalysisModel" placeholder="留空则使用聊天模型" /></label>
      <label>创意模型<input name="defaultCreativeModel" placeholder="留空则使用聊天模型" /></label>
      <label>启用<input name="enabled" type="checkbox" checked /></label>
      <button class="primary" type="submit">加密保存</button>
    </form><div id="ai-settings-status" class="status"></div></section><section><h2>已配置 Provider</h2><div id="ai-provider-table"></div></section><div id="page-status" class="status"></div>`;
  }
  if (page === "ai-suggestions") {
    return `<h1>AI 建议</h1><section><h2>生成账户深度分析</h2><div class="form-grid">
      <label>广告账户<select id="suggestion-account"></select></label>
      <label>开始日期<input id="suggestion-since" type="date" /></label>
      <label>结束日期<input id="suggestion-until" type="date" /></label>
      <button id="generate-account-analysis" class="primary" type="button">生成深度分析</button>
    </div><div class="status">生成后会把账户、Campaign、Ad Set、广告、素材判断写入 AI 报告，并创建可跟进的建议卡片。</div></section><div class="toolbar"><select id="suggestion-status"><option value="">全部状态</option><option value="pending">待处理</option><option value="accepted">已采纳</option><option value="done">已完成</option><option value="rejected">已拒绝</option></select><button id="run-rule-monitor" class="primary">运行规则检测</button><div id="page-status" class="status"></div></div><div id="suggestion-metrics" class="grid"></div><section><h2>建议卡片</h2><div id="suggestions-table"></div></section><div id="suggestion-report"></div>`;
  }
  return `<h1>同步日志</h1><div class="toolbar"><select id="log-type"><option value="">全部类型</option><option value="orders">订单</option><option value="meta_ad_accounts">广告账户</option><option value="meta_structure">广告结构</option><option value="meta_insights">Meta数据</option><option value="meta_creatives">素材</option><option value="mapping_import">映射导入</option><option value="store_profile">店铺资料</option></select><button id="refresh-logs">刷新</button><button id="retry-failed-logs">重试失败任务</button><div id="page-status" class="status"></div></div><section><h2>日志</h2><div id="logs-table"></div></section>`;
}

export function renderAdminPage(page: AdminPage): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${pageTitle(page)} - Meta 广告店铺分析</title>
  ${styles()}
</head>
<body data-page="${page}">
  <header>
    <strong>Meta 广告店铺分析</strong>
    <form method="post" action="/admin/logout"><button type="submit">退出登录</button></form>
  </header>
  <nav>${nav(page)}</nav>
  <main>${body(page)}</main>
  <button id="ai-toggle" class="ai-launcher" type="button">问 AI</button>
  <section id="ai-panel" class="ai-panel" aria-label="AI Media Buyer Copilot">
    <header><strong>AI Media Buyer Copilot</strong><button id="ai-creative" type="button">生成创意方向</button></header>
    <div id="ai-log" class="ai-log"><div class="ai-msg assistant">我会读取当前页面上下文，只给建议，不会操作 Meta 广告账户。</div></div>
    <form id="ai-form" class="ai-form" data-status="page-status">
      <textarea name="message" placeholder="问我这个账户、广告、国家或素材应该怎么优化" required></textarea>
      <button class="primary" type="submit">发送</button>
    </form>
  </section>
  ${script()}
</body>
</html>`;
}
