import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  Globe2,
  Image as ImageIcon,
  Lightbulb,
  LineChart,
  Link2,
  LayoutGrid,
  Loader2,
  LogOut,
  MessageSquareText,
  PackageSearch,
  RefreshCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  TrendingUp,
  Users,
  Wand2,
} from "lucide-react";
import "./styles.css";
import { compactCopilotContext, type AiCopilotPageContext } from "./ai-copilot-context";
import { getDateRangeByPreset, type DatePreset } from "../../../src/shared/date-time.js";

type Page =
  | "overview"
  | "stores"
  | "accounts"
  | "mappings"
  | "storeData"
  | "accountData"
  | "accountStructure"
  | "accountAnalysis"
  | "storeAnalysis"
  | "countryAnalysis"
  | "audienceAnalysis"
  | "creativeData"
  | "productAnalysis"
  | "projectBoard"
  | "ownerOverview"
  | "aiSuggestions"
  | "creativeCopilot"
  | "aiSettings"
  | "systemSettings"
  | "syncLogs";

interface ApiResult<T> {
  data: T;
}

interface DashboardSummary {
  range?: {
    since: string;
    until: string;
    days: number;
  };
  storeCount: number;
  activeStoreCount: number;
  adAccountCount: number;
  mappedAdAccountCount: number;
  overview?: {
    storeOrderCount: number;
    storeSales: number;
    metaSpend: number;
    realRoas: number | null;
    metaRoas: number | null;
    metaPurchases: number;
    metaPurchaseValue: number;
    impressions: number;
    clicks: number;
    ctr: number | null;
  };
  stores?: Array<{
    id: string;
    name: string;
    platform: string;
    domain: string;
    status: string;
    currency?: string | null;
    mappedAccounts: number;
    orderCount: number;
    sales: number;
  }>;
  accounts?: Array<{
    id: string;
    metaAccountId: string;
    name?: string | null;
    status?: string | null;
    storeName?: string | null;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    purchaseValue: number;
    roas: number | null;
  }>;
  products?: Array<{
    productName: string;
    sku?: string | null;
    orderCount: number;
    quantity: number;
    sales: number;
  }>;
  syncHealth?: Record<string, number>;
  ai?: {
    pendingSuggestions: number;
  };
  dataReadiness?: Array<{
    key: string;
    label: string;
    status: "ready" | "missing" | string;
    records: number;
    latestDataAt?: string | null;
    latestSyncAt?: string | null;
    note?: string;
  }>;
  recentLogs: SyncLog[];
}

interface SyncLog {
  id: string;
  type: string;
  status: string;
  storeId?: string;
  adAccountId?: string;
  startedAt: string;
  finishedAt?: string;
  rangeStart?: string;
  rangeEnd?: string;
  recordsFetched: number;
  recordsSaved: number;
  errorMessage?: string;
  metadata?: unknown;
}

interface SyncOperationSummary {
  type: string;
  label: string;
  enabled: boolean;
  intervalMinutes: number | null;
  nextRunAt?: string | null;
  health: "disabled" | "running" | "attention" | "healthy" | "idle";
  latest?: SyncLog | null;
  counts: {
    success: number;
    failed: number;
    running: number;
    pending: number;
  };
}

interface SyncOperationsSummary {
  scheduler: {
    enabled: boolean;
    startDelaySeconds: number;
    failedRetryEnabled: boolean;
    failedRetryIntervalMinutes: number;
    ruleMonitorEnabled: boolean;
    ruleMonitorIntervalMinutes: number;
  };
  totals: {
    recentSampleSize: number;
    running: number;
    failed: number;
    success: number;
    failedQueue: number;
  };
  operations: SyncOperationSummary[];
  failedQueue: SyncLog[];
  recentLogs: SyncLog[];
}

interface AdAccount {
  id: string;
  metaAccountId: string;
  displayAccountId?: string;
  name?: string;
  status?: string;
  displayStatus?: string;
  currency?: string;
  timezone?: string;
  store?: { name?: string } | null;
  storeMap?: { store?: StoreRecord | null } | null;
}

interface StoreRecord {
  id: string;
  name: string;
  platform: "shopline" | "shoplazza" | "shopify";
  domain: string;
  apiBaseUrl?: string;
  currency?: string;
  timezone?: string;
  timezoneSource?: string;
  timezoneVerifiedAt?: string;
  appKey?: string;
  apiTokenConfigured?: boolean;
  appSecretConfigured?: boolean;
  status?: string;
  mappedAccounts?: Array<{
    id: string;
    metaAccountId: string;
    name?: string | null;
    status?: string | null;
  }>;
}

interface MappingImportIssue {
  row: number;
  code: string;
  message: string;
  recommendation?: string;
}

interface MappingImportRow {
  store_name: string;
  platform: "shopline" | "shoplazza" | "shopify";
  domain: string;
  meta_account_id: string;
  meta_account_name?: string;
}

interface StoreProbeResult {
  ok: boolean;
  stage?: "products" | "orders";
  message?: string;
  endpoint?: string;
  attemptedPaths?: string[];
  requestId?: string;
  sampleProducts?: number;
  sampleOrders?: number;
  productProbeError?: string;
}

interface StoreSyncResult {
  fetched: number;
  saved: number;
  pages?: number;
  endpoint?: string;
  attemptedPaths?: string[];
  requestId?: string;
  message?: string;
}

interface SpendAccount {
  id: string;
  accountId: string;
  name?: string;
  status?: string;
  storeName?: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr?: number;
  cpc?: number;
  cpm?: number;
  purchases: number;
  purchaseValue: number;
  costPerPurchase?: number;
  roas?: number;
  addToCart?: number;
  addToCartRate?: number;
  initiateCheckout?: number;
  checkoutRate?: number;
  insightRows?: number;
  firstInsightDate?: string | null;
  lastInsightDate?: string | null;
}

interface Suggestion {
  id: string;
  action: string;
  rationale: string;
  priority: number;
  status: string;
  createdAt: string;
  report?: {
    id?: string;
    type?: string;
    entityType?: string;
    entityId?: string;
    conclusion?: string;
    observationWindow?: string;
    model?: string;
  };
  entity?: {
    type?: string;
    id?: string;
    label?: string;
  };
}

interface CreativeBriefResult {
  provider: string;
  model: string;
  brief: string;
  reportId?: string;
  entity?: {
    type?: string;
    id?: string;
    label?: string;
  };
}

interface AiReportDetail {
  report: {
    id: string;
    type: string;
    entityType: string;
    entityId: string;
    conclusion: string;
    dataBasis?: unknown;
    riskPoints?: unknown;
    priority: number;
    observationWindow?: string | null;
    model?: string | null;
    metadata?: unknown;
    createdAt: string;
  };
  suggestions: Array<{
    id: string;
    action: string;
    rationale: string;
    priority: number;
    status: string;
    executionChecklist: string[];
  }>;
  entity?: {
    type?: string;
    id?: string;
    label?: string;
    href?: string | null;
  };
}

interface AiProvider {
  id: string;
  provider: string;
  displayName: string;
  apiKeyMasked: string;
  defaultChatModel?: string;
  defaultAnalysisModel?: string;
  defaultCreativeModel?: string;
  priority?: number;
  enabled: boolean;
}

interface AiModelListResult {
  provider: string;
  models: string[];
  defaultChatModel?: string;
}

interface SystemConfigSummary {
  meta: {
    tokenConfigured: boolean;
    apiVersion: string;
    readOnlyMode: boolean;
    accountSyncEnabled: boolean;
    insightsSyncEnabled: boolean;
    structureSyncEnabled: boolean;
    activeAccountWindowDays: number;
    insightAccountLimit: number;
  };
  stores: {
    total: number;
    active: number;
    shopline: number;
    shoplazza: number;
    tokenStorage: string;
  };
  ai: {
    enabledProviders: number;
    keyStorage: string;
    frontendExposure: string;
  };
  sync: {
    workerEnabled: boolean;
    orderSyncEnabled: boolean;
    redisConfigured: boolean;
    workerConcurrency: number;
    metaIntervalMinutes: number;
    orderIntervalMinutes: number;
    recentLogs: SyncLog[];
  };
  security: {
    apiKeyConfigured: boolean;
    sessionSecretConfigured: boolean;
    tokenEncryptionKeyConfigured: boolean;
    corsOrigin: string;
    corsWildcard: boolean;
    httpsRequired: boolean;
    metaWriteBlocked: boolean;
  };
  data: {
    adAccounts: number;
    mappedAccounts: number;
    unmappedAccounts: number;
  };
}

interface CopilotLaunchDetail {
  context: AiCopilotPageContext;
  prompt?: string;
}

interface NavItem {
  page: Page;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}

interface NavGroup {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  items: NavItem[];
}

const overviewNavItem: NavItem = { page: "overview", label: "数据概览", icon: BarChart3 };
const ACCOUNT_ANALYSIS_TARGET_KEY = "meta-ai-os:selected-ad-account";

const navGroups: NavGroup[] = [
  {
    key: "data",
    label: "数据中心",
    icon: LineChart,
    items: [
      { page: "accountData", label: "数据明细", icon: LineChart },
      { page: "accountStructure", label: "广告系列结构", icon: LayoutGrid },
      { page: "audienceAnalysis", label: "受众", icon: Globe2 },
      { page: "creativeData", label: "素材", icon: ImageIcon },
      { page: "storeData", label: "店铺数据", icon: Store },
    ],
  },
  {
    key: "analysis",
    label: "AI 分析",
    icon: Brain,
    items: [
      { page: "accountAnalysis", label: "账户分析", icon: LayoutGrid },
      { page: "storeAnalysis", label: "店铺分析", icon: Store },
      { page: "countryAnalysis", label: "国家分析", icon: Users },
      { page: "productAnalysis", label: "产品分析", icon: PackageSearch },
    ],
  },
  {
    key: "suggestions",
    label: "建议中心",
    icon: TrendingUp,
    items: [
      { page: "aiSuggestions", label: "AI 建议卡片", icon: Lightbulb },
    ],
  },
  {
    key: "creative",
    label: "创意中心",
    icon: Wand2,
    items: [
      { page: "creativeCopilot", label: "Creative Copilot", icon: ImageIcon },
    ],
  },
  {
    key: "config",
    label: "配置中心",
    icon: Settings,
    items: [
      { page: "stores", label: "店铺配置", icon: Store },
      { page: "mappings", label: "店铺账户映射", icon: Link2 },
      { page: "accounts", label: "Meta 账户配置", icon: Target },
      { page: "syncLogs", label: "同步日志", icon: RefreshCcw },
      { page: "aiSettings", label: "AI 模型设置", icon: Bot },
      { page: "systemSettings", label: "系统参数", icon: ShieldCheck },
    ],
  },
];

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "请求失败");
  }
  return (payload as ApiResult<T>).data;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const datePresetOptions: Array<{ value: DatePreset; label: string }> = [
  { value: "today", label: "今天" },
  { value: "yesterday", label: "昨天" },
  { value: "last_7_days", label: "过去 7 天" },
  { value: "last_14_days", label: "过去 14 天" },
  { value: "last_30_days", label: "过去 30 天" },
  { value: "this_week", label: "本周" },
  { value: "last_week", label: "上周" },
  { value: "this_month", label: "本月" },
  { value: "last_month", label: "上月" },
  { value: "this_year", label: "今年" },
  { value: "last_year", label: "去年" },
];

function QuickDatePresets({
  timezone,
  onApply,
}: {
  timezone?: string | null;
  onApply: (range: { startDate: string; endDate: string; timezone: string }) => void;
}) {
  const tz = timezone || "UTC";
  return (
    <div className="date-preset-bar">
      <span>时区：{tz}</span>
      {datePresetOptions.map((option) => (
        <button key={option.value} type="button" onClick={() => onApply(getDateRangeByPreset(option.value, tz))}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function accountId(account: AdAccount): string {
  return account.displayAccountId || String(account.metaAccountId || "").replace(/^act_/, "");
}

function compactPathList(paths?: string[]): string {
  if (!paths || paths.length === 0) return "";
  const preview = paths.slice(0, 4).join("，");
  return paths.length > 4 ? `${preview} 等 ${paths.length} 个路径` : preview;
}

function fmtDate(value?: string): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "";
}

function metric(value: unknown): string {
  if (value === null || value === undefined || value === "") return "N/A";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

function accountStore(account: AdAccount): StoreRecord | null {
  return account.storeMap?.store ?? null;
}

function money(value: number): string {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function currency(value: number | null | undefined): string {
  return `$${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function roas(value: number | null | undefined): string {
  return value === null || value === undefined ? "N/A" : `${Number(value).toFixed(2)}x`;
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",").pop() ?? "" : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-mark"><Bot size={28} /></div>
        <h1>AI 广告投放操作系统</h1>
        <p>Meta Ads 只读分析 · 多店铺归因 · AI Media Buyer Copilot</p>
        <form onSubmit={submit}>
          <label>账号<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label>
          <label>密码<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required /></label>
          {error && <div className="error-text">{error}</div>}
          <button className="primary-btn" disabled={loading}>{loading ? "登录中..." : "登录后台"}</button>
        </form>
      </section>
    </main>
  );
}

function StatCard({ label, value, hint }: { label: string; value: unknown; hint?: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{metric(value)}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function StatusPill({ status }: { status?: string }) {
  const text = status || "unknown";
  return <span className={`pill ${text}`}>{text}</span>;
}

const dataCenterTabs: Array<{ page: Page; label: string }> = [
  { page: "accountData", label: "数据明细" },
  { page: "accountStructure", label: "广告系列结构" },
  { page: "audienceAnalysis", label: "受众" },
  { page: "creativeData", label: "素材" },
  { page: "storeData", label: "店铺数据" },
];

function DataCenterTabs({ active }: { active: Page }) {
  return (
    <nav className="page-tabs" aria-label="数据中心">
      {dataCenterTabs.map((tab) => (
        <button
          key={tab.page}
          className={active === tab.page ? "active" : ""}
          onClick={() => window.dispatchEvent(new CustomEvent<Page>("switch-page", { detail: tab.page }))}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function Shell({ children, page, setPage, onLogout }: {
  children: React.ReactNode;
  page: Page;
  setPage: (page: Page) => void;
  onLogout: () => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    data: true,
    analysis: true,
    suggestions: false,
    creative: false,
    config: false,
  });
  const navButton = (item: NavItem, className = "") => {
    const Icon = item.icon;
    return (
      <button key={item.page} className={`${page === item.page ? "active" : ""}${className ? ` ${className}` : ""}`} onClick={() => setPage(item.page)}>
        <Icon size={17} />
        {item.label}
        <ChevronRight className="nav-arrow" size={14} />
      </button>
    );
  };
  const navGroup = (group: NavGroup) => {
    const Icon = group.icon;
    const expanded = expandedGroups[group.key] ?? false;
    const active = group.items.some((item) => item.page === page);
    return (
      <div className="nav-group" key={group.key}>
        <button
          className={`nav-parent ${active ? "active-parent" : ""}`}
          onClick={() => setExpandedGroups((current) => ({ ...current, [group.key]: !expanded }))}
        >
          <Icon size={17} />
          {group.label}
          <ChevronDown className={`nav-arrow ${expanded ? "expanded" : ""}`} size={15} />
        </button>
        {expanded && <div className="subnav">{group.items.map((item) => navButton(item, "subitem"))}</div>}
      </div>
    );
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon"><BarChart3 size={20} /></div>
          <div>
            <strong>Meta Insights Pro</strong>
            <span>AI Media Buying OS</span>
          </div>
        </div>
        <nav>
          {navButton(overviewNavItem)}
          {navGroups.map(navGroup)}
        </nav>
        <div className="sidebar-bottom">
          <button className="logout-nav" onClick={onLogout}><LogOut size={16} />退出登录</button>
          <div className="user-chip"><span>ADMIN</span><strong>admin</strong></div>
        </div>
      </aside>
      <section className="workspace">
        <main>{children}</main>
      </section>
      <FloatingCopilot />
    </div>
  );
}

function Overview() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(refresh = false) {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      setSummary(await api<DashboardSummary>("/api/dashboard" + (refresh ? "?refresh=true" : "")));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function switchPage(page: Page) {
    window.dispatchEvent(new CustomEvent<Page>("switch-page", { detail: page }));
  }

  function askOverviewAi() {
    window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
      detail: {
        context: compactCopilotContext({
          page: "overview",
          since: summary?.range?.since,
          until: summary?.range?.until,
          filters: {
            pendingSuggestions: summary?.ai?.pendingSuggestions ?? 0,
            syncFailed: summary?.syncHealth?.failed ?? 0,
            adAccountCount: summary?.adAccountCount ?? 0,
            activeStoreCount: summary?.activeStoreCount ?? 0,
          },
        }),
        prompt: "请基于当前数据总览做一次运营诊断：指出店铺销售、Meta 花费、真实 ROAS、Meta ROAS、账户排行、产品排行和同步健康里最值得优先处理的问题，并输出结论、建议动作、数据依据、风险点、优先级、观察周期和执行清单。当前概览数据："
          + JSON.stringify({
            range: summary?.range,
            overview: summary?.overview,
            topAccounts: (summary?.accounts || []).slice(0, 8),
            topProducts: (summary?.products || []).slice(0, 8),
            dataReadiness: summary?.dataReadiness,
            syncHealth: summary?.syncHealth,
            pendingSuggestions: summary?.ai?.pendingSuggestions,
          }),
      },
    }));
  }

  function askStoreAi(store: NonNullable<DashboardSummary["stores"]>[number]) {
    window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
      detail: {
        context: compactCopilotContext({
          page: "overview",
          storeId: store.id,
          since: summary?.range?.since,
          until: summary?.range?.until,
          filters: { entityType: "store", storeName: store.name, platform: store.platform, domain: store.domain },
        }),
        prompt: "请分析这个店铺近 30 天表现，判断订单、销售额、绑定广告账户数量是否足够支撑投放决策，并给运营明确下一步动作。店铺数据："
          + JSON.stringify(store),
      },
    }));
  }

  function askAccountAi(account: NonNullable<DashboardSummary["accounts"]>[number]) {
    window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
      detail: {
        context: compactCopilotContext({
          page: "overview",
          adAccountId: account.id,
          since: summary?.range?.since,
          until: summary?.range?.until,
          filters: { entityType: "ad_account", accountName: account.name, metaAccountId: account.metaAccountId },
        }),
        prompt: "请分析这个 Meta 广告账户近 30 天表现，判断是否应该优先加预算、降预算、观察或进入深度结构分析，并给出数据依据和执行清单。账户数据："
          + JSON.stringify(account),
      },
    }));
  }

  function askProductAi(product: NonNullable<DashboardSummary["products"]>[number]) {
    window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
      detail: {
        context: compactCopilotContext({
          page: "overview",
          since: summary?.range?.since,
          until: summary?.range?.until,
          filters: { entityType: "product", productName: product.productName, sku: product.sku },
        }),
        prompt: "请分析这个产品近 30 天销售表现，判断是否适合单独开广告系列、补充素材、做国家本地化或继续观察，并给出运营执行清单。产品数据："
          + JSON.stringify(product),
      },
    }));
  }

  return (
    <PageBlock title="数据总览" subtitle="经营总览入口：店铺订单、Meta 投放、账户排行、产品排行和同步健康。">
      {summary?.range && <div className="notice">
        <strong>统计范围</strong>
        <span>{summary.range.since} 至 {summary.range.until}，基于后台同步入库数据汇总。</span>
        <button className="table-btn" onClick={() => load(true)} disabled={refreshing}>{refreshing ? "刷新中..." : "刷新概览"}</button>
      </div>}
      <div className="grid four">
        <StatCard label="店铺销售额" value={currency(summary?.overview?.storeSales)} hint={`订单 ${summary?.overview?.storeOrderCount ?? 0} 笔`} />
        <StatCard label="Meta 花费" value={currency(summary?.overview?.metaSpend)} hint={`展示 ${money(summary?.overview?.impressions ?? 0)}，点击 ${money(summary?.overview?.clicks ?? 0)}`} />
        <StatCard label="真实 ROAS" value={roas(summary?.overview?.realRoas)} hint="店铺销售额 / Meta 花费" />
        <StatCard label="Meta ROAS" value={roas(summary?.overview?.metaRoas)} hint={`Meta 订单 ${summary?.overview?.metaPurchases ?? 0}`} />
      </div>
      <div className="grid four">
        <StatCard label="店铺数" value={summary?.storeCount ?? 0} hint={`启用 ${summary?.activeStoreCount ?? 0}`} />
        <StatCard label="广告账户" value={summary?.adAccountCount ?? 0} hint={`已绑定 ${summary?.mappedAdAccountCount ?? 0}`} />
        <StatCard label="同步失败" value={summary?.syncHealth?.failed ?? 0} hint={`运行中 ${summary?.syncHealth?.running ?? 0}`} />
        <StatCard label="待处理 AI 建议" value={summary?.ai?.pendingSuggestions ?? 0} hint="AI 只给建议，不执行操作" />
      </div>

      <section className="overview-actions">
        <button onClick={() => switchPage("accountData")}>
          <LineChart size={18} />
          <strong>查看账户消耗</strong>
          <span>按账户判断花费、点击、订单和 ROAS</span>
        </button>
        <button onClick={() => switchPage("accountAnalysis")}>
          <Brain size={18} />
          <strong>账户深度分析</strong>
          <span>拆 Campaign / Ad Set / Ad 并生成 AI 建议</span>
        </button>
        <button onClick={() => switchPage("aiSuggestions")}>
          <Lightbulb size={18} />
          <strong>处理 AI 建议</strong>
          <span>查看、接受、完成或拒绝运营建议</span>
        </button>
        <button onClick={() => switchPage("syncLogs")}>
          <RefreshCcw size={18} />
          <strong>检查同步状态</strong>
          <span>确认 Meta、订单和素材任务是否正常</span>
        </button>
        <button onClick={askOverviewAi}>
          <Sparkles size={18} />
          <strong>问 AI 总览诊断</strong>
          <span>基于当前汇总判断优先处理事项</span>
        </button>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>数据完整性状态</h2>
          <span className="muted">用于判断当前数据是否足够支撑账户、素材、国家和产品分析。</span>
        </div>
        {loading ? <Loading /> : (
          <div className="readiness-grid">
            {(summary?.dataReadiness || []).map((item) => (
              <article key={item.key} className={`readiness-card ${item.status === "ready" ? "ready" : "missing"}`}>
                <span className={`pill ${item.status === "ready" ? "success" : "pending"}`}>{item.status === "ready" ? "可分析" : "待同步"}</span>
                <strong>{item.label}</strong>
                <dl>
                  <dt>记录数</dt><dd>{money(item.records || 0)}</dd>
                  <dt>数据日期</dt><dd>{formatDateOnly(item.latestDataAt || undefined) || "-"}</dd>
                  <dt>最近同步</dt><dd>{fmtDate(item.latestSyncAt || undefined) || "-"}</dd>
                </dl>
                <p>{item.note || "等待后台同步任务更新。"}</p>
              </article>
            ))}
            {(summary?.dataReadiness || []).length === 0 && <div className="empty-state compact"><RefreshCcw size={22} /><strong>暂无完整性状态</strong><span>请等待后台同步任务生成数据。</span></div>}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>店铺数据概览</h2>
          <span className="muted">按近 30 天销售额排序</span>
        </div>
        {loading ? <Loading /> : (
          <table className="dense-table">
            <thead><tr><th>店铺</th><th>平台</th><th>域名</th><th>状态</th><th>绑定账户</th><th>订单</th><th>销售额</th><th>操作</th></tr></thead>
            <tbody>
              {(summary?.stores || []).map((store) => <tr key={store.id}>
                <td><strong>{store.name}</strong></td>
                <td>{store.platform}</td>
                <td>{store.domain}</td>
                <td><StatusPill status={store.status} /></td>
                <td>{store.mappedAccounts}</td>
                <td>{store.orderCount}</td>
                <td className="positive-money">{currency(store.sales)}</td>
                <td><div className="row-actions">
                  <button className="table-btn" onClick={() => switchPage("storeAnalysis")}>店铺分析</button>
                  <button className="table-btn" onClick={() => askStoreAi(store)}>问 AI</button>
                </div></td>
              </tr>)}
              {(summary?.stores || []).length === 0 && <tr><td colSpan={8}><div className="empty-state compact"><Store size={22} /><strong>暂无店铺数据</strong><span>请先添加店铺并同步订单。</span></div></td></tr>}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>账户数据概览</h2>
          <span className="muted">按近 30 天 Meta 花费排序</span>
        </div>
        {loading ? <Loading /> : (
          <table className="dense-table">
            <thead><tr><th>账户名称</th><th>账户 ID</th><th>绑定店铺</th><th>状态</th><th>花费</th><th>点击</th><th>Meta 订单</th><th>Meta ROAS</th><th>操作</th></tr></thead>
            <tbody>
              {(summary?.accounts || []).map((account) => <tr key={account.id}>
                <td><strong>{account.name || "-"}</strong></td>
                <td>{account.metaAccountId}</td>
                <td>{account.storeName || "-"}</td>
                <td>{account.status || "-"}</td>
                <td>{currency(account.spend)}</td>
                <td>{money(account.clicks)}</td>
                <td>{account.purchases}</td>
                <td className="roas-cell">{roas(account.roas)}</td>
                <td><div className="row-actions">
                  <button className="table-btn" onClick={() => switchPage("accountAnalysis")}>深度分析</button>
                  <button className="table-btn" onClick={() => askAccountAi(account)}>问 AI</button>
                </div></td>
              </tr>)}
              {(summary?.accounts || []).length === 0 && <tr><td colSpan={9}><div className="empty-state compact"><Target size={22} /><strong>暂无账户消耗</strong><span>请等待 Worker 自动同步或在数据明细页同步 Meta 数据。</span></div></td></tr>}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>产品销售排行</h2>
          <span className="muted">用于判断可单独扩量的产品线索</span>
        </div>
        {loading ? <Loading /> : (
          <table className="dense-table">
            <thead><tr><th>产品</th><th>SKU</th><th>订单数</th><th>销量</th><th>销售额</th><th>操作</th></tr></thead>
            <tbody>
              {(summary?.products || []).map((product, index) => <tr key={`${product.productName}-${product.sku || index}`}>
                <td><strong>{product.productName}</strong></td>
                <td>{product.sku || "-"}</td>
                <td>{product.orderCount}</td>
                <td>{product.quantity}</td>
                <td className="positive-money">{currency(product.sales)}</td>
                <td><div className="row-actions">
                  <button className="table-btn" onClick={() => switchPage("productAnalysis")}>产品分析</button>
                  <button className="table-btn" onClick={() => askProductAi(product)}>问 AI</button>
                </div></td>
              </tr>)}
              {(summary?.products || []).length === 0 && <tr><td colSpan={6}><div className="empty-state compact"><PackageSearch size={22} /><strong>暂无产品排行</strong><span>订单同步后会自动生成产品销售排行。</span></div></td></tr>}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>最近同步日志</h2>
        {loading ? <Loading /> : <SyncLogTableV2 logs={summary?.recentLogs || []} compact />}
      </section>
    </PageBlock>
  );
}

function Accounts() {
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");

  async function load() {
    setLoading(true);
    setAccounts(await api<AdAccount[]>("/api/ad-accounts"));
    setLoading(false);
  }

  async function sync() {
    setStatus("正在同步最近 90 天活跃广告账户...");
    const result = await api<{ saved: number; fetched: number }>("/api/ad-accounts/sync", {
      method: "POST",
      body: JSON.stringify({ limit: 500, activeLastDays: 90 }),
    });
    setStatus(`同步完成：抓取 ${result.fetched}，保存 ${result.saved}`);
    await load();
  }

  useEffect(() => { void load(); }, []);

  return (
    <PageBlock title="Meta 广告账户" subtitle="只读同步账户 ID、名称、状态，生产环境不会修改广告账户。">
      <div className="toolbar">
        <button className="primary-btn" onClick={sync}><RefreshCcw size={16} />同步近 90 天活跃账户</button>
        <span className="muted">{status}</span>
      </div>
      <section className="panel">
        {loading ? <Loading /> : (
          <table>
            <thead><tr><th>账户 ID</th><th>账户名称</th><th>状态</th><th>币种</th><th>时区</th><th>操作</th></tr></thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>{accountId(account)}</td>
                  <td>{account.name || "-"}</td>
                  <td>{account.displayStatus || account.status || "-"}</td>
                  <td>{account.currency || "-"}</td>
                  <td>{account.timezone || "-"}</td>
                  <td><button className="table-btn" onClick={() => window.dispatchEvent(new CustomEvent("open-account-analysis", { detail: account.id }))}>深度分析</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </PageBlock>
  );
}

function StoreData() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [search, setSearch] = useState("");
  const [since, setSince] = useState(addDaysIso(-29));
  const [until, setUntil] = useState(todayIso());
  const [platform, setPlatform] = useState<"all" | StoreRecord["platform"]>("all");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyStoreId, setBusyStoreId] = useState("");
  const [bulkSyncing, setBulkSyncing] = useState(false);

  async function load(refresh = false) {
    setLoading(true);
    try {
      const query = new URLSearchParams({ since, until });
      if (refresh) query.set("refresh", "true");
      setSummary(await api<DashboardSummary>(`/api/dashboard?${query.toString()}`));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "店铺经营数据读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function syncOrders(storeId: string) {
    setBusyStoreId(storeId);
    setStatus(`正在按 ${since} 至 ${until} 同步店铺订单...`);
    try {
      const result = await api<StoreSyncResult>(`/api/stores/${encodeURIComponent(storeId)}/sync-orders`, {
        method: "POST",
        body: JSON.stringify({ limit: 250, rangeStart: since, rangeEnd: until }),
      });
      setStatus(`订单同步完成：抓取 ${result.fetched}，保存 ${result.saved}${result.endpoint ? `，接口 ${result.endpoint}` : ""}${result.pages ? `，页数 ${result.pages}` : ""}`);
      await load(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "订单同步失败，请检查店铺凭据和同步日志");
    } finally {
      setBusyStoreId("");
    }
  }

  async function syncVisibleStores() {
    const targets = stores.filter((store) => store.status !== "inactive");
    if (targets.length === 0) {
      setStatus("当前筛选范围内没有可同步的启用店铺。");
      return;
    }
    setBulkSyncing(true);
    setStatus(`正在按 ${since} 至 ${until} 同步 ${targets.length} 个店铺订单...`);
    try {
      const result = await api<{
        success: boolean;
        fetched: number;
        saved: number;
        stores: number;
        results: Array<{ storeName: string; success: boolean; error?: string }>;
      }>("/api/sync-store", {
        method: "POST",
        body: JSON.stringify({ limit: 250, startDate: since, endDate: until }),
      });
      const failures = result.results.filter((item) => !item.success);
      setStatus(failures.length
        ? `同步完成但有失败：店铺 ${result.stores}，抓取 ${result.fetched}，保存 ${result.saved}。失败：${failures.slice(0, 3).map((item) => `${item.storeName}: ${item.error || "同步失败"}`).join("；")}`
        : `全部店铺同步完成：店铺 ${result.stores}，抓取 ${result.fetched}，保存 ${result.saved}`);
      await load(true);
    } finally {
      setBusyStoreId("");
      setBulkSyncing(false);
    }
  }

  function askStore(store: NonNullable<DashboardSummary["stores"]>[number]) {
    window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
      detail: {
        context: compactCopilotContext({
          page: "store-data",
          storeId: store.id,
          since: summary?.range?.since,
          until: summary?.range?.until,
          filters: { platform: store.platform, domain: store.domain, storeName: store.name },
        }),
        prompt: "请基于当前店铺经营数据判断订单量、销售额、绑定广告账户数量和数据完整性，并说明下一步应该同步数据、检查映射还是进入店铺分析。数据："
          + JSON.stringify(store),
      },
    }));
  }

  useEffect(() => { void load(); }, [since, until]);

  const stores = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return (summary?.stores || []).filter((store) => {
      const platformMatched = platform === "all" || store.platform === platform;
      const keywordMatched = !keyword
        || store.name.toLowerCase().includes(keyword)
        || store.domain.toLowerCase().includes(keyword)
        || store.platform.toLowerCase().includes(keyword);
      return platformMatched && keywordMatched;
    });
  }, [summary, search, platform]);
  const totalOrders = stores.reduce((sum, store) => sum + store.orderCount, 0);
  const totalSales = stores.reduce((sum, store) => sum + store.sales, 0);
  const activeStores = stores.filter((store) => store.status !== "inactive").length;
  const mappedAccounts = stores.reduce((sum, store) => sum + store.mappedAccounts, 0);
  const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;
  const recentOrderLogs = (summary?.recentLogs || []).filter((log) => log.type === "orders").slice(0, 5);
  const orderSyncStats = recentOrderLogs.reduce((acc, log) => {
    acc.total += 1;
    if (log.status === "success") acc.success += 1;
    if (log.status === "failed") acc.failed += 1;
    if (log.status === "running") acc.running += 1;
    return acc;
  }, { total: 0, success: 0, failed: 0, running: 0 });

  return (
    <PageBlock title="店铺数据" subtitle="按日期范围查看店铺订单、销售额、客单价、绑定广告账户和同步状态；原始订单仅保留非隐私字段。">
      <DataCenterTabs active="storeData" />
      <section className="filter-strip">
        <label>开始日期<input type="date" value={since} onChange={(event) => setSince(event.target.value)} /></label>
        <label>结束日期<input type="date" value={until} onChange={(event) => setUntil(event.target.value)} /></label>
        <label>平台筛选<select value={platform} onChange={(event) => setPlatform(event.target.value as typeof platform)}><option value="all">全部平台</option><option value="shopline">Shopline</option><option value="shoplazza">Shoplazza</option><option value="shopify">Shopify</option></select></label>
        <label className="search-field">搜索店铺<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索店铺名称 / 域名 / 平台" /></label>
        <button className="primary-btn" onClick={() => load(true)} disabled={loading}><RefreshCcw size={16} />刷新店铺数据</button>
        <button className="primary-btn" onClick={syncVisibleStores} disabled={bulkSyncing || loading}>按当前范围同步订单</button>
      </section>
      <QuickDatePresets
        timezone="UTC"
        onApply={(range) => {
          setSince(range.startDate);
          setUntil(range.endDate);
        }}
      />
      <div className="timezone-note">订单统计按每个店铺自己的 timezone 归属日期后再聚合；Meta 数据仍按广告账户 timezone 口径。</div>
      {status && <div className="notice">{status}</div>}
      <div className="grid four">
        <StatCard label="筛选店铺" value={stores.length} hint={`启用 ${activeStores}`} />
        <StatCard label="订单数" value={totalOrders} hint={`${since} 至 ${until}`} />
        <StatCard label="销售额" value={currency(totalSales)} />
        <StatCard label="客单价" value={currency(averageOrderValue)} hint={`绑定账户 ${mappedAccounts}`} />
      </div>
      <div className="grid four">
        <StatCard label="最近同步" value={orderSyncStats.total} hint="订单同步日志" />
        <StatCard label="同步成功" value={orderSyncStats.success} />
        <StatCard label="同步失败" value={orderSyncStats.failed} />
        <StatCard label="同步中" value={orderSyncStats.running} />
      </div>
      <section className="panel data-panel">
        <div className="panel-heading">
          <h2>店铺经营明细</h2>
          <div className="row-actions">
            <button className="ghost-btn" onClick={() => window.dispatchEvent(new CustomEvent<Page>("switch-page", { detail: "stores" }))}>店铺配置</button>
            <button className="ghost-btn" onClick={() => window.dispatchEvent(new CustomEvent<Page>("switch-page", { detail: "mappings" }))}>账户映射</button>
          </div>
        </div>
        {loading ? <Loading /> : (
          <table className="dense-table">
            <thead><tr><th>店铺</th><th>平台</th><th>域名</th><th>状态</th><th>绑定账户</th><th>订单</th><th>销售额</th><th>客单价</th><th>同步状态</th><th>操作</th></tr></thead>
            <tbody>
              {stores.map((store) => <tr key={store.id}>
                <td><strong>{store.name}</strong><small>{store.id}</small></td>
                <td>{store.platform}</td>
                <td>{store.domain}</td>
                <td><StatusPill status={store.status} /></td>
                <td>{store.mappedAccounts}</td>
                <td>{store.orderCount}</td>
                <td className="positive-money">{currency(store.sales)}</td>
                <td>{currency(store.orderCount > 0 ? store.sales / store.orderCount : 0)}</td>
                <td><span className={`pill ${store.orderCount > 0 ? "success" : "idle"}`}>{busyStoreId === store.id ? "同步中" : store.orderCount > 0 ? "有订单数据" : "无订单/未同步"}</span></td>
                <td><div className="row-actions">
                  <button className="table-btn" disabled={busyStoreId === store.id} onClick={() => syncOrders(store.id)}>同步订单</button>
                  <button className="table-btn" onClick={() => window.dispatchEvent(new CustomEvent<Page>("switch-page", { detail: "storeAnalysis" }))}>分析</button>
                  <button className="table-btn" onClick={() => askStore(store)}>问 AI</button>
                </div></td>
              </tr>)}
              {stores.length === 0 && <tr><td colSpan={10}><div className="empty-state compact"><Store size={22} /><strong>暂无店铺经营数据</strong><span>请先在店铺配置中添加店铺，并按当前日期范围同步订单。</span></div></td></tr>}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>最近订单同步状态</h2>
          <span className="muted">失败原因会保留在同步日志，方便排查域名、Token 和权限问题。</span>
        </div>
        <SyncLogTableV2 logs={recentOrderLogs} compact />
      </section>
    </PageBlock>
  );
}














function AccountData() {
  const [since, setSince] = useState(addDaysIso(-29));
  const [until, setUntil] = useState(todayIso());
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<SpendAccount[]>([]);
  const [sort, setSort] = useState<{ key: keyof SpendAccount | "name"; direction: "asc" | "desc" }>({ key: "spend", direction: "desc" });
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const query = new URLSearchParams({ since, until }).toString();
      const report = await api<{ accounts: SpendAccount[] }>(`/api/ad-accounts/spend?${query}`);
      setRows(report.accounts || []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "账户消耗数据读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function syncAndRefresh() {
    setLoading(true);
    setStatus("正在从 Meta 同步当前日期范围内的账户消耗数据...");
    try {
      const result = await api<{ accounts: number; fetched: number; saved: number }>("/api/meta-insights/sync-active-accounts", {
        method: "POST",
        body: JSON.stringify({ since, until, level: "ad", countryBreakdown: true, maxPages: 10, accountLimit: 50 }),
      });
      setStatus(`同步完成：账户 ${result.accounts}，抓取 ${result.fetched}，保存 ${result.saved}`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "同步失败，请检查 Meta Token、账户权限或同步日志");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) =>
      row.accountId.toLowerCase().includes(keyword) ||
      (row.name || "").toLowerCase().includes(keyword)
    );
  }, [rows, search]);

  const sortedRows = useMemo(() => {
    const read = (row: SpendAccount, key: keyof SpendAccount | "name") => key === "name" ? (row.name || row.accountId) : row[key];
    return [...filteredRows].sort((a, b) => {
      const aValue = read(a, sort.key);
      const bValue = read(b, sort.key);
      if (typeof aValue === "string" || typeof bValue === "string") {
        const result = String(aValue || "").localeCompare(String(bValue || ""), "zh-CN");
        return sort.direction === "asc" ? result : -result;
      }
      const result = Number(aValue || 0) - Number(bValue || 0);
      return sort.direction === "asc" ? result : -result;
    });
  }, [filteredRows, sort]);

  const totals = useMemo(() => {
    const spend = filteredRows.reduce((sum, row) => sum + (row.spend || 0), 0);
    const purchaseValue = filteredRows.reduce((sum, row) => sum + (row.purchaseValue || 0), 0);
    const purchases = filteredRows.reduce((sum, row) => sum + (row.purchases || 0), 0);
    return { spend, purchaseValue, roas: safeRatio(purchaseValue, spend), purchases };
  }, [filteredRows]);

  function fmtMoney(value: number | null | undefined): string {
    return `$${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtPercent(value: number | null | undefined): string {
    return `${Number(value || 0).toFixed(2)}%`;
  }

  function fmtRoas(value: number | null | undefined): string {
    return Number(value || 0).toFixed(2);
  }

  function exportCsv() {
    const headers = ["账户名称", "抵达", "印象", "点击", "CPC", "点击率", "已花费金额", "加购", "加购率", "结账发起", "结账率", "成效", "单次费用", "转化价值", "ROAS"];
    const body = sortedRows.map((row) => [
      row.name || row.accountId,
      row.reach,
      row.impressions,
      row.clicks,
      row.cpc ?? "",
      row.ctr ?? "",
      row.spend,
      row.addToCart ?? 0,
      row.addToCartRate ?? "",
      row.initiateCheckout ?? 0,
      row.checkoutRate ?? "",
      row.purchases,
      row.costPerPurchase ?? "",
      row.purchaseValue,
      row.roas ?? "",
    ]);
    const csv = [headers, ...body].map((line) => line.map((cell) => '"' + String(cell ?? "").replaceAll('"', '""') + '"').join(",")).join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `meta-account-details-${since}-${until}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function requestSort(key: keyof SpendAccount | "name") {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  }

  function sortHeader(label: string, key: keyof SpendAccount | "name") {
    const active = sort.key === key;
    return (
      <th>
        <button className={`th-sort ${active ? "active" : ""}`} onClick={() => requestSort(key)}>
          {label} {active ? (sort.direction === "desc" ? "↓" : "↑") : "↕"}
        </button>
      </th>
    );
  }

  function askAccount(row: SpendAccount) {
    window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
      detail: {
        context: compactCopilotContext({
          page: "account-data",
          adAccountId: row.id,
          entity: { type: "ad_account", id: row.accountId, name: row.name || row.accountId },
          filters: { since, until, search },
          metrics: {
            spend: row.spend,
            impressions: row.impressions,
            clicks: row.clicks,
            ctr: row.ctr,
            cpc: row.cpc,
            purchases: row.purchases,
            purchaseValue: row.purchaseValue,
            roas: row.roas,
          },
        }),
        prompt: "请基于当前日期范围分析这个广告账户的消耗、CTR、CPC、购买、转化价值和 ROAS，给出加预算、降预算、观察或拆结构的建议。",
      },
    }));
  }

  function openAccountPage(row: SpendAccount, targetPage: Page) {
    sessionStorage.setItem(ACCOUNT_ANALYSIS_TARGET_KEY, row.id);
    window.dispatchEvent(new CustomEvent<Page>("switch-page", { detail: targetPage }));
  }

  return (
    <PageBlock title="数据明细" subtitle="参考 Meta Insights Pro 的账户级运营明细：消耗、抵达、点击、加购、结账、成效、转化价值与 ROAS。">
      <DataCenterTabs active="accountData" />
      <section className="filter-strip">
        <label>开始日期<input type="date" value={since} onChange={(event) => setSince(event.target.value)} /></label>
        <span className="date-separator">至</span>
        <label>结束日期<input type="date" value={until} onChange={(event) => setUntil(event.target.value)} /></label>
        <label className="search-field">搜索账户名称<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索账户名称 / 账户 ID" /></label>
        <button className="primary-btn" onClick={syncAndRefresh} disabled={loading}><RefreshCcw size={16} />同步 Meta 数据</button>
      </section>
      {status && <div className="notice">{status}</div>}
      <div className="grid four">
        <StatCard label="总支出消耗" value={fmtMoney(totals.spend)} hint="投放消耗金额" />
        <StatCard label="总转化价值" value={fmtMoney(totals.purchaseValue)} hint="全渠道营收" />
        <StatCard label="平均 ROI" value={`${fmtRoas(totals.roas)}x`} hint="广告投资回报" />
        <StatCard label="总成效" value={totals.purchases} hint="购买转化次数" />
      </div>
      <section className="panel data-panel">
        <div className="panel-heading">
          <h2>广告账户详情明细</h2>
          <button className="ghost-btn" onClick={exportCsv}>导出报表</button>
        </div>
        {loading ? <Loading /> : (
          <table className="dense-table">
            <thead><tr>{sortHeader("账户名称", "name")}{sortHeader("抵达", "reach")}{sortHeader("印象", "impressions")}{sortHeader("点击", "clicks")}{sortHeader("CPC", "cpc")}{sortHeader("点击率 %", "ctr")}{sortHeader("已花费金额", "spend")}<th>加购</th><th>加购率</th><th>结账发起</th><th>结账率</th>{sortHeader("成效", "purchases")}{sortHeader("单次费用", "costPerPurchase")}{sortHeader("转化价值", "purchaseValue")}{sortHeader("ROAS", "roas")}<th>AI</th></tr></thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name || row.accountId}</strong><small>{row.accountId}</small></td>
                  <td>{metric(row.reach)}</td>
                  <td>{metric(row.impressions)}</td>
                  <td>{metric(row.clicks)}</td>
                  <td>{fmtMoney(row.cpc ?? 0)}</td>
                  <td>{fmtPercent(row.ctr ?? 0)}</td>
                  <td>{fmtMoney(row.spend)}</td>
                  <td>{metric(row.addToCart ?? 0)}</td>
                  <td>{fmtPercent(row.addToCartRate ?? 0)}</td>
                  <td>{metric(row.initiateCheckout ?? 0)}</td>
                  <td>{fmtPercent(row.checkoutRate ?? 0)}</td>
                  <td>{metric(row.purchases)}</td>
                  <td>{fmtMoney(row.costPerPurchase ?? 0)}</td>
                  <td className="positive-money">{fmtMoney(row.purchaseValue)}</td>
                  <td className="roas-cell">{fmtRoas(row.roas)}</td>
                  <td className="row-actions">
                    <button className="table-btn" onClick={() => openAccountPage(row, "accountStructure")}>结构</button>
                    <button className="table-btn" onClick={() => openAccountPage(row, "accountAnalysis")}>分析</button>
                    <button className="table-btn" onClick={() => openAccountPage(row, "creativeData")}>素材</button>
                    <button className="table-btn" onClick={() => askAccount(row)}>问 AI</button>
                  </td>
                </tr>
              ))}
              {sortedRows.length === 0 && <tr><td colSpan={16}><div className="empty-state compact"><LineChart size={24} /><h2>暂无账户消耗数据</h2><p>请先同步 Meta 数据，或调整日期范围和搜索条件。</p></div></td></tr>}
            </tbody>
            {sortedRows.length > 0 && <tfoot><tr><td>汇总</td><td>{metric(sortedRows.reduce((sum, row) => sum + (row.reach || 0), 0))}</td><td>{metric(sortedRows.reduce((sum, row) => sum + (row.impressions || 0), 0))}</td><td>{metric(sortedRows.reduce((sum, row) => sum + (row.clicks || 0), 0))}</td><td>{fmtMoney(safeRatio(totals.spend, sortedRows.reduce((sum, row) => sum + (row.clicks || 0), 0)))}</td><td>{fmtPercent(safeRatio(sortedRows.reduce((sum, row) => sum + (row.clicks || 0), 0), sortedRows.reduce((sum, row) => sum + (row.impressions || 0), 0)) * 100)}</td><td>{fmtMoney(totals.spend)}</td><td>{metric(sortedRows.reduce((sum, row) => sum + (row.addToCart || 0), 0))}</td><td>-</td><td>{metric(sortedRows.reduce((sum, row) => sum + (row.initiateCheckout || 0), 0))}</td><td>-</td><td>{metric(totals.purchases)}</td><td>{fmtMoney(safeRatio(totals.spend, totals.purchases))}</td><td className="positive-money">{fmtMoney(totals.purchaseValue)}</td><td className="roas-cell">{fmtRoas(totals.roas)}</td><td>-</td></tr></tfoot>}
          </table>
        )}
        <div className="table-footnote">统计数据按 account_id 自动汇总；同步动作仍然只调用 Meta GET 接口。</div>
      </section>
    </PageBlock>
  );
}


function AccountAnalysis({ mode = "analysis" }: { mode?: "analysis" | "structure" }) {
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [adAccountId, setAdAccountId] = useState("");
  const [since, setSince] = useState(addDaysIso(-29));
  const [until, setUntil] = useState(todayIso());
  const [report, setReport] = useState<any>(null);
  const [latestAiReport, setLatestAiReport] = useState<AiReportDetail | null>(null);
  const [activeLevel, setActiveLevel] = useState<"campaigns" | "adsets" | "ads" | "creatives">("campaigns");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<AdAccount[]>("/api/ad-accounts").then((items) => {
      setAccounts(items);
      const pendingAccountId = sessionStorage.getItem(ACCOUNT_ANALYSIS_TARGET_KEY);
      setAdAccountId((current) => current || (pendingAccountId && items.some((item) => item.id === pendingAccountId) ? pendingAccountId : items[0]?.id || ""));
    });
    const listener = (event: Event) => {
      const targetId = (event as CustomEvent<string>).detail;
      if (targetId) {
        sessionStorage.setItem(ACCOUNT_ANALYSIS_TARGET_KEY, targetId);
        setAdAccountId(targetId);
      }
    };
    window.addEventListener("open-account-analysis", listener);
    return () => window.removeEventListener("open-account-analysis", listener);
  }, []);

  async function load() {
    if (!adAccountId) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ adAccountId, since, until }).toString();
      setReport(await api<any>("/api/analysis/account-detail?" + query));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "账户深度分析读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function syncStructure() {
    if (!adAccountId) return;
    setLoading(true);
    setStatus("正在刷新 Campaign / Ad Set / Ad / Creative 结构...");
    try {
      const result = await api<{ saved?: { campaignsSaved?: number; adsetsSaved?: number; adsSaved?: number; creativeSnapshotsSaved?: number } }>("/api/meta-structure/sync-account", {
        method: "POST",
        body: JSON.stringify({ adAccountId, limit: 500, maxPages: 10 }),
      });
      const saved = result.saved || {};
      setStatus("结构同步完成：Campaign " + (saved.campaignsSaved || 0) + "，Ad Set " + (saved.adsetsSaved || 0) + "，Ads " + (saved.adsSaved || 0) + "，素材 " + (saved.creativeSnapshotsSaved || 0));
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "结构同步失败");
    } finally {
      setLoading(false);
    }
  }

  async function syncInsights() {
    if (!adAccountId) return;
    setLoading(true);
    setStatus("正在同步当前账户 Insights...");
    try {
      const result = await api<{ saved: number; fetched: number }>("/api/meta-insights/sync-account", {
        method: "POST",
        body: JSON.stringify({ adAccountId, days: 30, level: "ad", countryBreakdown: true, maxPages: 10 }),
      });
      setStatus("Insights 同步完成：抓取 " + result.fetched + "，保存 " + result.saved);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Insights 同步失败");
    } finally {
      setLoading(false);
    }
  }

  async function deepAnalyzeAccount() {
    if (!adAccountId) return;
    setStatus("正在生成账户级 AI 深度分析...");
    try {
      const result = await api<{ reportId: string; suggestionsCreated: number; model: string; aiError?: string }>("/api/ai/suggestions/analyze-account", {
        method: "POST",
        body: JSON.stringify({ adAccountId, since, until }),
      });
      if (result.reportId) {
        setLatestAiReport(await api<AiReportDetail>("/api/ai/reports/" + encodeURIComponent(result.reportId)));
      }
      setStatus("已生成 " + result.suggestionsCreated + " 条建议，模型：" + result.model + (result.aiError ? "（AI 调用失败，已使用本地规则兜底）" : ""));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI 账户分析失败");
    }
  }

  function openCopilot(entityType: string, entityId: string, row?: any) {
    window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
      detail: {
        context: compactCopilotContext({
          page: "account-analysis",
          adAccountId,
          campaignId: entityType === "campaign" ? entityId : row?.campaignId,
          adsetId: entityType === "adset" ? entityId : row?.adsetId,
          adId: entityType === "ad" ? entityId : row?.adId,
          creativeId: entityType === "creative" ? entityId : row?.creativeId,
          since,
          until,
          filters: { entityType, entityName: row?.campaignName || row?.adsetName || row?.adName || row?.creativeId || null },
        }),
        prompt: "请分析这个 " + entityType + " 的表现，指出是否应该加预算、降预算、观察、换素材或拆结构，并给出数据依据和执行清单。",
      },
    }));
  }

  async function analyzeEntity(entityType: string, entityId: string) {
    setStatus("正在生成 " + entityType + " 深度分析...");
    try {
      const result = await api<{ reportId: string; suggestionsCreated: number; model: string; aiError?: string }>("/api/ai/suggestions/analyze-entity", {
        method: "POST",
        body: JSON.stringify({ adAccountId, since, until, entityType, entityId }),
      });
      if (result.reportId) {
        setLatestAiReport(await api<AiReportDetail>("/api/ai/reports/" + encodeURIComponent(result.reportId)));
      }
      setStatus("已生成 " + result.suggestionsCreated + " 条建议，模型：" + result.model + (result.aiError ? "（AI 调用失败，已使用本地规则兜底）" : ""));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI 深度分析失败");
    }
  }

  async function updateLatestReportSuggestionStatus(id: string, nextStatus: string) {
    await api("/api/ai/suggestions/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
    setLatestAiReport((current) => current ? {
      ...current,
      suggestions: current.suggestions.map((suggestion) => suggestion.id === id ? { ...suggestion, status: nextStatus } : suggestion),
    } : current);
    setStatus("建议状态已更新，只影响本系统的运营处理记录。");
  }

  async function generateCreative(entityType: "ad" | "creative" | "campaign", entityId: string, row?: any) {
    setStatus("正在生成创意方向...");
    try {
      const result = await api<{ brief: string; model: string }>("/api/ai/creative-brief", {
        method: "POST",
        body: JSON.stringify({ entityType, entityId, language: "zh-CN", performanceSummary: { account: report?.account, range: report?.range, row } }),
      });
      setStatus("创意方向已生成，模型：" + result.model + "。请在 Creative Copilot 页面查看和继续追问。");
      window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
        detail: {
          context: compactCopilotContext({ page: "creative-copilot", adAccountId, since, until, filters: { entityType, entityId } }),
          prompt: result.brief,
        },
      }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "创意方向生成失败");
    }
  }

  useEffect(() => { if (adAccountId) void load(); }, [adAccountId]);

  const campaigns = report?.campaigns || [];
  const adsets = report?.adsets || [];
  const ads = report?.ads || [];
  const creatives = ads.filter((row: any) => row.creativeId);
  const rows = activeLevel === "campaigns" ? campaigns : activeLevel === "adsets" ? adsets : activeLevel === "ads" ? ads : creatives;

  const title = mode === "structure" ? "广告系列结构" : "账户分析";
  const subtitle = mode === "structure"
    ? "按账户拆解 Campaign / Ad Set / Ad / Creative 四层数据，支持单项问 AI、深度分析和创意方向生成。"
    : "围绕单个广告账户汇总消耗、转化、ROAS、结构数据与 AI 建议，用于判断账户下一步操作。";

  return (
    <PageBlock title={title} subtitle={subtitle}>
      {mode === "structure" && <DataCenterTabs active="accountStructure" />}
      <section className="structure-toolbar">
        <select value={adAccountId} onChange={(event) => setAdAccountId(event.target.value)}>
          {accounts.map((account) => <option key={account.id} value={account.id}>{accountId(account)} / {account.name || ""}</option>)}
        </select>
        <DateToolbar since={since} until={until} setSince={setSince} setUntil={setUntil} onRefresh={load} compact />
        <button className="ghost-btn" onClick={syncStructure}><RefreshCcw size={16} />刷新结构</button>
        <button className="primary-btn" onClick={syncInsights}><LineChart size={16} />同步 Meta 数据</button>
        <button className="ghost-btn" onClick={deepAnalyzeAccount}><Brain size={16} />AI 诊断</button>
      </section>
      {status && <div className="notice">{status}</div>}
      {loading ? <Loading /> : report && <>
        {latestAiReport && <AiReportPanel
          detail={latestAiReport}
          onOpenSuggestions={() => window.dispatchEvent(new CustomEvent<Page>("switch-page", { detail: "aiSuggestions" }))}
          onSuggestionStatusChange={updateLatestReportSuggestionStatus}
        />}
        {report.dataQuality && <section className={`panel data-quality-panel ${report.dataQuality.status}`}>
          <div className="panel-heading">
            <h2>账户数据质量</h2>
            <span className={`pill ${report.dataQuality.status === "ready" ? "success" : report.dataQuality.status === "missing" ? "failed" : "pending"}`}>
              {report.dataQuality.status === "ready" ? "数据可分析" : report.dataQuality.status === "missing" ? "缺少核心数据" : "部分数据缺失"}
            </span>
          </div>
          <div className="quality-metrics">
            <span>Insights：<strong>{report.dataQuality.insightsRows}</strong></span>
            <span>日期：<strong>{report.dataQuality.firstInsightDate || "-"} 至 {report.dataQuality.lastInsightDate || "-"}</strong></span>
            <span>Campaign：<strong>{report.dataQuality.campaignCount}</strong></span>
            <span>Ad Set：<strong>{report.dataQuality.adsetCount}</strong></span>
            <span>Ad：<strong>{report.dataQuality.adCount}</strong></span>
            <span>素材：<strong>{report.dataQuality.creativeCount}</strong></span>
          </div>
          {report.dataQuality.warnings?.length > 0 && <ul className="quality-warnings">
            {report.dataQuality.warnings.map((warning: string) => <li key={warning}>{warning}</li>)}
          </ul>}
        </section>}
        <div className="grid four">
          <StatCard label="花费金额" value={money(report.overview?.spend || 0)} />
          <StatCard label="转化价值" value={money(report.overview?.purchaseValue || 0)} />
          <StatCard label="ROAS" value={metric(report.overview?.roas)} />
          <StatCard label="购买量" value={metric(report.overview?.purchases)} />
        </div>
        <div className="tabs structure-tabs">
          <button className={activeLevel === "campaigns" ? "active" : ""} onClick={() => setActiveLevel("campaigns")}>广告系列 <span>{campaigns.length}</span></button>
          <button className={activeLevel === "adsets" ? "active" : ""} onClick={() => setActiveLevel("adsets")}>广告组 <span>{adsets.length}</span></button>
          <button className={activeLevel === "ads" ? "active" : ""} onClick={() => setActiveLevel("ads")}>广告 <span>{ads.length}</span></button>
          <button className={activeLevel === "creatives" ? "active" : ""} onClick={() => setActiveLevel("creatives")}>素材 <span>{creatives.length}</span></button>
        </div>
        <SimpleEntityTable
          rows={rows}
          level={activeLevel}
          onAsk={openCopilot}
          onAnalyze={analyzeEntity}
          onCreative={generateCreative}
        />
      </>}
      {!loading && !report && <section className="panel empty-state"><LayoutGrid size={32} /><h2>暂无账户结构数据</h2><p>请选择账户并刷新结构或同步 Meta 数据。</p></section>}
    </PageBlock>
  );
}

function entityIdForRow(level: string, row: any): string {
  if (level === "campaigns") return row.campaignId;
  if (level === "adsets") return row.adsetId;
  if (level === "ads") return row.adId;
  return row.creativeId || row.adId;
}

function entityTypeForLevel(level: string): string {
  if (level === "campaigns") return "campaign";
  if (level === "adsets") return "adset";
  if (level === "ads") return "ad";
  return "creative";
}

function entityNameForRow(level: string, row: any): string {
  if (level === "campaigns") return row.campaignName || row.name || row.campaignId;
  if (level === "adsets") return row.adsetName || row.name || row.adsetId;
  if (level === "ads") return row.adName || row.name || row.adId;
  return row.title || row.adName || row.creativeId || row.adId;
}

function SimpleEntityTable({ rows, level, onAsk, onAnalyze, onCreative }: {
  rows: any[];
  level: "campaigns" | "adsets" | "ads" | "creatives";
  onAsk: (type: string, id: string, row?: any) => void;
  onAnalyze: (type: string, id: string) => void;
  onCreative: (type: "ad" | "creative" | "campaign", id: string, row?: any) => void;
}) {
  const type = entityTypeForLevel(level);
  return (
    <section className="panel data-panel">
      <div className="panel-heading">
        <h2>{level === "campaigns" ? "Campaign 明细" : level === "adsets" ? "Ad Set 明细" : level === "ads" ? "Ad 明细" : "素材明细"}</h2>
        <span className="muted">{rows.length} 条数据，AI 只输出建议，不执行广告操作。</span>
      </div>
      <table className="dense-table structure-table">
        <thead><tr><th>名称</th><th>状态</th><th>花费</th><th>转化价值</th><th>ROAS</th><th>购买</th><th>展示</th><th>点击</th><th>CTR</th><th>CPC</th><th>频次</th><th>AI</th></tr></thead>
        <tbody>
          {rows.slice(0, 120).map((row: any) => {
            const id = entityIdForRow(level, row);
            return <tr key={id}>
              <td><strong>{entityNameForRow(level, row)}</strong><small>{id}</small></td>
              <td><StatusPill status={row.status || "ACTIVE"} /></td>
              <td>{money(row.spend || 0)}</td>
              <td className="positive-money">{money(row.purchaseValue || 0)}</td>
              <td className="roas-cell">{metric(row.roas)}</td>
              <td>{metric(row.purchases)}</td>
              <td>{metric(row.impressions)}</td>
              <td>{metric(row.clicks)}</td>
              <td>{metric(row.ctr)}</td>
              <td>{money(row.cpc || 0)}</td>
              <td>{metric(row.frequency)}</td>
              <td className="row-actions">
                <button className="table-btn" onClick={() => onAsk(type, id, row)}>问 AI</button>
                <button className="table-btn" onClick={() => onAnalyze(type, id)}>深度分析</button>
                {(type === "campaign" || type === "ad" || type === "creative") && <button className="table-btn" onClick={() => onCreative(type as "ad" | "creative" | "campaign", id, row)}>创意方向</button>}
              </td>
            </tr>;
          })}
          {rows.length === 0 && <tr><td colSpan={12}><div className="empty-state compact"><LayoutGrid size={24} /><h2>暂无结构数据</h2><p>请先刷新结构或同步 Meta 数据。</p></div></td></tr>}
        </tbody>
      </table>
    </section>
  );
}


function StoreAnalysisV2() {
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [storeId, setStoreId] = useState("");
  const [since, setSince] = useState(addDaysIso(-29));
  const [until, setUntil] = useState(todayIso());
  const [report, setReport] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<StoreRecord[]>("/api/stores").then((items) => {
      setStores(items);
      setStoreId((current) => current || items[0]?.id || "");
    });
  }, []);

  async function load() {
    if (!storeId) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ storeId, since, until }).toString();
      setReport(await api<any>("/api/analysis/store-overview?" + query));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "店铺分析读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (storeId) void load(); }, [storeId]);

  function askStoreReportAi() {
    const store = stores.find((item) => item.id === storeId);
    window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
      detail: {
        context: compactCopilotContext({
          page: "storeAnalysis",
          storeId,
          since,
          until,
          filters: { storeName: store?.name, platform: store?.platform, domain: store?.domain },
        }),
        prompt: "请基于当前店铺分析结果判断真实 ROAS、Meta ROAS、订单、销售额和广告花费是否健康，并给出运营动作建议。店铺："
          + JSON.stringify(store || { id: storeId }) + "；分析数据：" + JSON.stringify(report),
      },
    }));
  }

  return (
    <PageBlock title="店铺分析" subtitle="按店铺查看真实订单、销售额、广告花费、真实 ROAS 与 Meta ROAS。">
      <StoreAnalysisToolbar stores={stores} storeId={storeId} setStoreId={setStoreId} since={since} until={until} setSince={setSince} setUntil={setUntil} onRefresh={load} />
      {status && <div className="notice danger"><strong>读取失败</strong><span>{status}</span></div>}
      {loading ? <Loading /> : report ? <section className="panel">
        <div className="grid four">
          <StatCard label="订单数" value={metric(report.ordersCount || report.orderCount || 0)} />
          <StatCard label="销售额" value={money(report.salesAmount || report.revenue || 0)} />
          <StatCard label="广告花费" value={money(report.adSpend || report.spend || 0)} />
          <StatCard label="真实 ROAS" value={metric(report.realRoas || report.roas)} />
        </div>
        <div className="ai-report-card">
          <div className="panel-heading compact-heading">
            <h2>运营结论</h2>
            <button className="table-btn" onClick={askStoreReportAi}>问 AI</button>
          </div>
          <p>{report.summary || "当前页面保留核心店铺归因指标，复杂建议卡片后续继续恢复。"}</p>
        </div>
      </section> : <section className="panel empty-state compact"><Store size={24} /><h2>暂无店铺分析数据</h2><p>请选择店铺并刷新。</p></section>}
    </PageBlock>
  );
}

function CountryAnalysisV2() {
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [storeId, setStoreId] = useState("");
  const [since, setSince] = useState(addDaysIso(-29));
  const [until, setUntil] = useState(todayIso());
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<StoreRecord[]>("/api/stores").then((items) => {
      setStores(items);
      setStoreId((current) => current || items[0]?.id || "");
    });
  }, []);

  async function load() {
    if (!storeId) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ storeId, since, until }).toString();
      const result = await api<any>("/api/analysis/countries?" + query);
      setRows(result.rows || result.countries || []);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "国家分析读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (storeId) void load(); }, [storeId]);

  function askCountryAi(row: any) {
    const store = stores.find((item) => item.id === storeId);
    window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
      detail: {
        context: compactCopilotContext({
          page: "countryAnalysis",
          storeId,
          since,
          until,
          filters: { entityType: "country", country: row.country, storeName: store?.name },
        }),
        prompt: "请分析这个国家维度表现，判断是否建议加预算、保持、降预算、排除或单独开国家系列，并给出数据依据和执行清单。店铺："
          + JSON.stringify(store || { id: storeId }) + "；国家数据：" + JSON.stringify(row),
      },
    }));
  }

  return (
    <PageBlock title="国家分析" subtitle="按国家对比真实订单、销售额、Meta 花费、真实 ROAS 和预算建议。">
      <StoreAnalysisToolbar stores={stores} storeId={storeId} setStoreId={setStoreId} since={since} until={until} setSince={setSince} setUntil={setUntil} onRefresh={load} />
      {status && <div className="notice danger"><strong>读取失败</strong><span>{status}</span></div>}
      {loading ? <Loading /> : <section className="panel data-panel">
        <table className="dense-table"><thead><tr><th>国家</th><th>订单</th><th>销售额</th><th>Meta 花费</th><th>真实 ROAS</th><th>建议</th><th>AI</th></tr></thead><tbody>
          {rows.map((row, index) => <tr key={row.country || index}><td>{row.country || "-"}</td><td>{metric(row.storeOrderCount || row.orders || row.orderCount)}</td><td>{currency(row.storeSales || row.salesAmount || row.revenue || 0)}</td><td>{currency(row.metaSpend || row.spend || row.adSpend || 0)}</td><td>{roas(row.realRoas || row.roas)}</td><td>{row.recommendation || row.suggestion || "观察"}</td><td><button className="table-btn" onClick={() => askCountryAi(row)}>问 AI</button></td></tr>)}
          {rows.length === 0 && <tr><td colSpan={7}><div className="empty-state compact"><Globe2 size={22} /><strong>暂无国家数据</strong><span>请同步订单和 Meta Insights 后刷新。</span></div></td></tr>}
        </tbody></table>
      </section>}
    </PageBlock>
  );
}


function ProductAnalysis() {
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [storeId, setStoreId] = useState("");
  const [since, setSince] = useState(addDaysIso(-29));
  const [until, setUntil] = useState(todayIso());
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<StoreRecord[]>("/api/stores").then((items) => {
      setStores(items);
      setStoreId((current) => current || items[0]?.id || "");
    });
  }, []);

  async function load() {
    if (!storeId) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ storeId, since, until }).toString();
      const result = await api<any>("/api/analysis/products?" + query);
      setRows(result.rows || result.products || []);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "产品分析读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (storeId) void load(); }, [storeId]);

  function askProductRowAi(row: any) {
    const store = stores.find((item) => item.id === storeId);
    window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
      detail: {
        context: compactCopilotContext({
          page: "productAnalysis",
          storeId,
          since,
          until,
          filters: { entityType: "product", productName: row.productName || row.name, sku: row.sku, storeName: store?.name },
        }),
        prompt: "请分析这个产品 / SKU 的订单和销售表现，判断是否适合单独投放、混投、补素材、做新 Hook 或继续观察，并给出执行清单。店铺："
          + JSON.stringify(store || { id: storeId }) + "；产品数据：" + JSON.stringify(row),
      },
    }));
  }

  return (
    <PageBlock title="产品分析" subtitle="按产品 / SKU 查看订单、销售额、主要国家和素材建议。">
      <StoreAnalysisToolbar stores={stores} storeId={storeId} setStoreId={setStoreId} since={since} until={until} setSince={setSince} setUntil={setUntil} onRefresh={load} />
      {status && <div className="notice danger"><strong>读取失败</strong><span>{status}</span></div>}
      {loading ? <Loading /> : <section className="panel data-panel">
        <table className="dense-table"><thead><tr><th>产品</th><th>SKU</th><th>订单</th><th>销售额</th><th>主要国家</th><th>建议</th><th>AI</th></tr></thead><tbody>
          {rows.map((row, index) => <tr key={row.productId || row.sku || index}><td>{row.productName || row.name || "-"}</td><td>{row.sku || "-"}</td><td>{metric(row.orders || row.orderCount || row.quantity)}</td><td>{money(row.salesAmount || row.revenue || row.totalAmount || 0)}</td><td>{row.topCountry || row.country || "-"}</td><td>{row.suggestion || "观察产品表现"}</td><td><button className="table-btn" onClick={() => askProductRowAi(row)}>问 AI</button></td></tr>)}
          {rows.length === 0 && <tr><td colSpan={7}><div className="empty-state compact"><PackageSearch size={22} /><strong>暂无产品数据</strong><span>请同步订单后刷新。</span></div></td></tr>}
        </tbody></table>
      </section>}
    </PageBlock>
  );
}

function AudienceAnalysis() {
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [adAccountId, setAdAccountId] = useState("");
  const [since, setSince] = useState(addDaysIso(-29));
  const [until, setUntil] = useState(todayIso());
  const [breakdown, setBreakdown] = useState<"gender_age" | "country" | "placement">("gender_age");
  const [report, setReport] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<AdAccount[]>("/api/ad-accounts").then((items) => {
      setAccounts(items);
      const pendingAccountId = sessionStorage.getItem(ACCOUNT_ANALYSIS_TARGET_KEY);
      setAdAccountId((current) => current || (pendingAccountId && items.some((item) => item.id === pendingAccountId) ? pendingAccountId : items[0]?.id || ""));
    });
  }, []);

  async function load() {
    if (!adAccountId) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ adAccountId, since, until, breakdown }).toString();
      setReport(await api<any>("/api/analysis/audience?" + query));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "受众分析读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function syncAudienceBreakdowns() {
    if (!adAccountId) return;
    setLoading(true);
    setStatus("正在同步年龄、性别、版位和设备 breakdown...");
    try {
      const result = await api<{ fetched: number; saved: number; breakdownRows?: number }>("/api/meta-insights/sync-account", {
        method: "POST",
        body: JSON.stringify({
          adAccountId,
          since,
          until,
          days: 30,
          level: "ad",
          countryBreakdown: true,
          syncBreakdowns: true,
          breakdowns: ["age", "gender", "publisher_platform", "platform_position", "impression_device"],
          maxPages: 10,
        }),
      });
      setStatus(`受众 breakdown 同步完成：抓取 ${result.fetched}，保存 ${result.saved}`);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "受众 breakdown 同步失败");
    } finally {
      setLoading(false);
    }
  }

  function askAudienceAi(row?: any) {
    const account = accounts.find((item) => item.id === adAccountId);
    window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
      detail: {
        context: compactCopilotContext({
          page: "audienceAnalysis",
          adAccountId,
          since,
          until,
          filters: {
            breakdown,
            segment: row?.label,
            segmentType: row?.type,
            accountName: account?.name,
            metaAccountId: account?.metaAccountId,
          },
        }),
        prompt: "请基于当前受众 breakdown 分析投放机会，判断年龄、性别、国家、版位或设备是否适合加预算、降预算、排除、单独拆系列或继续观察，并给出数据依据和执行清单。账户："
          + JSON.stringify(account || { id: adAccountId }) + "；汇总：" + JSON.stringify(report?.overview || {}) + "；受众分组："
          + JSON.stringify(row || (report?.rows || []).slice(0, 12)),
      },
    }));
  }

  useEffect(() => { if (adAccountId) void load(); }, [adAccountId, breakdown]);

  const rows = report?.rows || [];
  const maxSpend = Math.max(...rows.map((row: any) => Number(row.spend || 0)), 1);

  return (
    <PageBlock title="受众分析" subtitle="按年龄、性别、国家、版位和设备查看聚合表现；数据来自 Meta Insights breakdown，只用于投放建议。">
      <DataCenterTabs active="audienceAnalysis" />
      <section className="filter-strip audience-filter">
        <label>开始日期<input type="date" value={since} onChange={(event) => setSince(event.target.value)} /></label>
        <label>结束日期<input type="date" value={until} onChange={(event) => setUntil(event.target.value)} /></label>
        <select value={adAccountId} onChange={(event) => setAdAccountId(event.target.value)}>
          {accounts.map((account) => <option key={account.id} value={account.id}>{accountId(account)} / {account.name || ""}</option>)}
        </select>
        <select value={breakdown} onChange={(event) => setBreakdown(event.target.value as "gender_age" | "country" | "placement")}>
          <option value="gender_age">年龄 / 性别</option>
          <option value="country">国家</option>
          <option value="placement">版位 / 设备</option>
        </select>
        <button className="primary-btn" onClick={load} disabled={loading}><RefreshCcw size={16} />刷新</button>
        <button className="ghost-btn" onClick={syncAudienceBreakdowns} disabled={loading}>同步受众数据</button>
        <button className="ghost-btn" onClick={() => askAudienceAi()} disabled={!report}>问 AI 总结</button>
      </section>
      {status && <div className="notice">{status}</div>}
      {report?.warning && <div className="notice danger"><strong>数据提示</strong><span>{report.warning}</span></div>}
      {loading ? <Loading /> : <>
        <div className="grid four">
          <StatCard label="受众花费" value={money(report?.overview?.spend || 0)} />
          <StatCard label="受众 ROAS" value={metric(report?.overview?.roas)} />
          <StatCard label="购买数" value={metric(report?.overview?.purchases)} />
          <StatCard label="点击率" value={`${metric(report?.overview?.ctr)}%`} />
        </div>
        <section className="panel audience-chart-panel">
          <div className="panel-heading">
            <h2>受众花费分布</h2>
            <span className="muted">按花费排序，辅助判断重点购买群体与版位机会。</span>
          </div>
          <div className="audience-bars">
            {rows.slice(0, 12).map((row: any) => (
              <div className="audience-bar-row" key={row.key}>
                <span>{row.label}</span>
                <div><i style={{ width: `${Math.max(4, (Number(row.spend || 0) / maxSpend) * 100)}%` }} /></div>
                <strong>{money(row.spend || 0)}</strong>
              </div>
            ))}
            {rows.length === 0 && <div className="empty-state compact"><Users size={22} /><strong>暂无受众数据</strong><span>请先同步受众 breakdown。</span></div>}
          </div>
        </section>
        <section className="panel data-panel">
          <table className="dense-table audience-table">
            <thead><tr><th>受众分组</th><th>类型</th><th>花费</th><th>展示</th><th>点击</th><th>CTR</th><th>CPC</th><th>CPM</th><th>购买</th><th>转化价值</th><th>ROAS</th><th>建议</th><th>AI</th></tr></thead>
            <tbody>
              {rows.map((row: any) => <tr key={row.key}>
                <td><strong>{row.label}</strong><small>{row.key}</small></td>
                <td>{row.type}</td>
                <td>{money(row.spend || 0)}</td>
                <td>{metric(row.impressions)}</td>
                <td>{metric(row.clicks)}</td>
                <td>{metric(row.ctr)}%</td>
                <td>{money(row.cpc || 0)}</td>
                <td>{money(row.cpm || 0)}</td>
                <td>{metric(row.purchases)}</td>
                <td className="positive-money">{money(row.purchaseValue || 0)}</td>
                <td className="roas-cell">{metric(row.roas)}</td>
                <td>{row.recommendation || "观察"}</td>
                <td><button className="table-btn" onClick={() => askAudienceAi(row)}>问 AI</button></td>
              </tr>)}
              {rows.length === 0 && <tr><td colSpan={13}><div className="empty-state compact"><Users size={22} /><strong>暂无受众明细</strong><span>点击“同步受众数据”后再刷新。</span></div></td></tr>}
            </tbody>
          </table>
        </section>
      </>}
    </PageBlock>
  );
}


function StoreAnalysisToolbar({ stores, storeId, setStoreId, since, until, setSince, setUntil, onRefresh }: {
  stores: StoreRecord[];
  storeId: string;
  setStoreId: (value: string) => void;
  since: string;
  until: string;
  setSince: (value: string) => void;
  setUntil: (value: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="toolbar">
      <label>店铺<select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
        {stores.map((store) => <option key={store.id} value={store.id}>{store.name} / {store.platform} / {store.domain}</option>)}
      </select></label>
      <DateToolbar since={since} until={until} setSince={setSince} setUntil={setUntil} onRefresh={onRefresh} compact />
    </div>
  );
}


function AiSuggestions() {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [since, setSince] = useState(addDaysIso(-6));
  const [until, setUntil] = useState(todayIso());
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("");
  const [openReport, setOpenReport] = useState<AiReportDetail | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: "120" });
      if (statusFilter) query.set("status", statusFilter);
      if (typeFilter) query.set("type", typeFilter);
      if (entityTypeFilter) query.set("entityType", entityTypeFilter);
      const result = await api<{ items: Suggestion[]; summary: Record<string, number> }>("/api/ai/suggestions?" + query.toString());
      setItems(result.items || []);
      setSummary(result.summary || {});
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI 建议列表读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function syncAndRunRules() {
    setLoading(true);
    setStatus("正在同步账户数据并运行低成本规则引擎...");
    try {
      await api("/api/meta-insights/sync-active-accounts", {
        method: "POST",
        body: JSON.stringify({ since, until, level: "ad", countryBreakdown: true, maxPages: 10, accountLimit: 50 }),
      });
      await api("/api/ai/suggestions/run-rules", { method: "POST", body: "{}" });
      setStatus("规则扫描完成，AI 仍然只生成建议，不执行广告操作。");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "规则扫描失败");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id: string, nextStatus: string) {
    await api("/api/ai/suggestions/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
    await load();
  }

  async function updateOpenReportSuggestionStatus(id: string, nextStatus: string) {
    await api("/api/ai/suggestions/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
    setOpenReport((current) => current ? {
      ...current,
      suggestions: current.suggestions.map((suggestion) => suggestion.id === id ? { ...suggestion, status: nextStatus } : suggestion),
    } : current);
    await load();
  }

  async function openSuggestionReport(item: Suggestion) {
    const reportId = item.report?.id;
    if (!reportId) {
      setStatus("这条建议缺少关联报告 ID，请重新运行规则扫描或深度分析。");
      return;
    }
    setLoading(true);
    try {
      setOpenReport(await api<AiReportDetail>("/api/ai/reports/" + encodeURIComponent(reportId)));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI 报告读取失败");
    } finally {
      setLoading(false);
    }
  }

  function askSuggestion(item: Suggestion) {
    window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
      detail: {
        context: compactCopilotContext({
          page: "ai-suggestions",
          filters: {
            suggestionId: item.id,
            priority: item.priority,
            entityType: item.entity?.type,
            entityId: item.entity?.id,
            entityLabel: item.entity?.label,
          },
        }),
        prompt: "请基于这条建议继续分析，输出结论、建议动作、数据依据、风险点、优先级、观察周期和执行清单："
          + item.action + "；" + item.rationale,
      },
    }));
  }

  async function generateCreativeFromSuggestion(item: Suggestion) {
    setLoading(true);
    setStatus("正在基于建议卡片生成 Creative Copilot 方向...");
    try {
      const result = await api<CreativeBriefResult>("/api/ai/suggestions/" + encodeURIComponent(item.id) + "/creative-brief", {
        method: "POST",
        body: JSON.stringify({ language: "zh-CN" }),
      });
      setStatus("创意方向已生成，模型：" + result.model + "。该结果只用于人工制作素材，不会上传或创建广告。");
      window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
        detail: {
          context: compactCopilotContext({
            page: "creative-copilot",
            since,
            until,
            filters: {
              sourceSuggestionId: item.id,
              reportId: result.reportId,
              entityType: result.entity?.type || item.entity?.type,
              entityId: result.entity?.id || item.entity?.id,
              entityLabel: result.entity?.label || item.entity?.label,
            },
          }),
          prompt: "请基于以下 Creative Copilot Brief 继续细化：输出 3 个 Hook、3 条广告文案、1 个 15 秒视频脚本、图片 Prompt、视频 Prompt、A/B Test 方案和制作注意事项。Brief：\n" + result.brief,
        },
      }));
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Creative Copilot 生成失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [statusFilter, typeFilter, entityTypeFilter]);

  return (
    <PageBlock title="AI 建议卡片" subtitle="规则引擎先低成本识别异常，再按需触发 AI 深度分析；所有动作只供人工执行。">
      <section className="filter-strip">
        <label>开始日期<input type="date" value={since} onChange={(event) => setSince(event.target.value)} /></label>
        <label>结束日期<input type="date" value={until} onChange={(event) => setUntil(event.target.value)} /></label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">全部状态</option>
          <option value="pending">待处理</option>
          <option value="accepted">已接受</option>
          <option value="rejected">已拒绝</option>
          <option value="done">已完成</option>
        </select>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="">全部报告</option>
          <option value="media_buyer">投放分析</option>
          <option value="creative">创意分析</option>
          <option value="anomaly">异常监测</option>
          <option value="chat_followup">对话追问</option>
        </select>
        <select value={entityTypeFilter} onChange={(event) => setEntityTypeFilter(event.target.value)}>
          <option value="">全部对象</option>
          <option value="ad_account">广告账户</option>
          <option value="campaign">广告系列</option>
          <option value="adset">广告组</option>
          <option value="ad">广告</option>
          <option value="creative">素材</option>
          <option value="store">店铺</option>
          <option value="product">产品</option>
          <option value="country">国家</option>
        </select>
        <button className="primary-btn" onClick={syncAndRunRules} disabled={loading}><RefreshCcw size={16} />同步并扫描</button>
        <button className="ghost-btn" onClick={load} disabled={loading}>刷新</button>
      </section>
      {status && <div className="notice">{status}</div>}
      {openReport && <AiReportPanel
        detail={openReport}
        onOpenSuggestions={() => setOpenReport(null)}
        actionLabel="收起报告"
        onSuggestionStatusChange={updateOpenReportSuggestionStatus}
      />}
      <div className="grid four">
        <StatCard label="待处理" value={summary.pending || 0} />
        <StatCard label="已接受" value={summary.accepted || 0} />
        <StatCard label="已拒绝" value={summary.rejected || 0} />
        <StatCard label="已完成" value={summary.done || 0} />
      </div>
      {loading ? <Loading /> : <section className="suggestion-grid">
        {items.map((item) => <article className="suggestion-card" key={item.id}>
          <div className="suggestion-head">
            <span className={"pill " + (item.priority <= 1 ? "failed" : item.priority <= 3 ? "pending" : "success")}>P{item.priority}</span>
            <StatusPill status={item.status} />
          </div>
          <h2>{item.action}</h2>
          <p>{item.rationale}</p>
          <small>{item.entity?.label || `${item.entity?.type || "entity"} / ${item.entity?.id || "-"}`}</small>
          <small>{item.report?.type || "report"} · {item.report?.model || "local-rules"} · {item.report?.observationWindow || "默认观察周期"}</small>
          <div className="row-actions">
            <button className="table-btn" onClick={() => openSuggestionReport(item)}>看报告</button>
            <button className="table-btn" onClick={() => askSuggestion(item)}>问 AI</button>
            <button className="table-btn" onClick={() => generateCreativeFromSuggestion(item)}>生成创意</button>
            {item.status !== "accepted" && <button className="table-btn" onClick={() => updateStatus(item.id, "accepted")}>接受</button>}
            {item.status !== "done" && <button className="table-btn" onClick={() => updateStatus(item.id, "done")}>完成</button>}
            {item.status !== "rejected" && <button className="table-btn" onClick={() => updateStatus(item.id, "rejected")}>拒绝</button>}
            {item.status !== "pending" && <button className="table-btn" onClick={() => updateStatus(item.id, "pending")}>待处理</button>}
          </div>
        </article>)}
        {items.length === 0 && <section className="panel empty-state compact"><Lightbulb size={24} /><h2>暂无建议卡片</h2><p>请先同步并扫描，或等待 Worker 自动规则监测。</p></section>}
      </section>}
    </PageBlock>
  );
}

function AiSettings() {
  return (
    <PageBlock title="AI 模型设置" subtitle="后台录入 OpenAI / Gemini Key，数据库加密保存，前端只显示脱敏状态。">
      <div className="notice">调用规则：只使用“启用”的 Provider，优先级数字越小越先调用；同优先级再按 Provider 和配置名称稳定排序。AI 只生成建议，不会执行广告操作。</div>
      <AiProviderSettingsPanel />
    </PageBlock>
  );
}

function AiProviderSettingsPanel() {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [form, setForm] = useState({ provider: "gemini", displayName: "default", apiKey: "", defaultChatModel: "", defaultAnalysisModel: "", defaultCreativeModel: "", enabled: true, priority: 100 });
  const [editingId, setEditingId] = useState("");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);

  async function load() {
    setProviders(await api<AiProvider[]>("/api/ai/providers"));
  }

  function resetForm() {
    setEditingId("");
    setModelOptions([]);
    setForm({ provider: "gemini", displayName: "default", apiKey: "", defaultChatModel: "", defaultAnalysisModel: "", defaultCreativeModel: "", enabled: true, priority: 100 });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingId && !form.apiKey.trim()) {
      setStatus("新增 AI Provider 必须填写 API Key。");
      return;
    }
    const body: Record<string, unknown> = {
      provider: form.provider,
      displayName: form.displayName,
      defaultChatModel: form.defaultChatModel || undefined,
      defaultAnalysisModel: form.defaultAnalysisModel || undefined,
      defaultCreativeModel: form.defaultCreativeModel || undefined,
      enabled: form.enabled,
      priority: Number(form.priority) || 100,
    };
    if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();
    await api(editingId ? `/api/ai/providers/${encodeURIComponent(editingId)}` : "/api/ai/providers", {
      method: editingId ? "PATCH" : "POST",
      body: JSON.stringify(body),
    });
    setStatus(editingId ? "AI Provider 已更新，Key 留空时不会修改原密钥。" : "AI Key 已加密保存，前端不会暴露明文。");
    resetForm();
    await load();
  }

  function editProvider(provider: AiProvider) {
    setEditingId(provider.id);
    setModelOptions([]);
    setForm({
      provider: provider.provider,
      displayName: provider.displayName,
      apiKey: "",
      defaultChatModel: provider.defaultChatModel || "",
      defaultAnalysisModel: provider.defaultAnalysisModel || "",
      defaultCreativeModel: provider.defaultCreativeModel || "",
      enabled: provider.enabled,
      priority: provider.priority ?? 100,
    });
    setStatus("正在编辑 AI Provider。API Key 留空表示不修改。");
  }

  async function toggleProvider(provider: AiProvider) {
    await api(`/api/ai/providers/${encodeURIComponent(provider.id)}/enabled`, {
      method: "POST",
      body: JSON.stringify({ enabled: !provider.enabled }),
    });
    setStatus(provider.enabled ? "已停用该 AI Provider，后续不会被自动调用。" : "已启用该 AI Provider。");
    await load();
  }

  async function deleteProvider(provider: AiProvider) {
    if (!window.confirm(`确认删除 ${provider.provider} / ${provider.displayName}？删除后需要重新录入 API Key。`)) return;
    await api(`/api/ai/providers/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
    setStatus("AI Provider 已删除。");
    if (editingId === provider.id) resetForm();
    await load();
  }

  async function loadModels(providerId?: string) {
    setLoadingModels(true);
    setStatus("正在从模型服务获取当前可调用版本...");
    try {
      const result = await api<AiModelListResult>("/api/ai/models", {
        method: "POST",
        body: JSON.stringify(providerId ? { providerId } : { provider: form.provider, apiKey: form.apiKey }),
      });
      setModelOptions(result.models);
      setStatus(`已获取 ${result.provider} 可调用模型 ${result.models.length} 个。`);
      if (!form.defaultChatModel && result.defaultChatModel) setForm((value) => ({ ...value, defaultChatModel: result.defaultChatModel || "" }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "获取模型列表失败，请检查 API Key 权限。");
    } finally {
      setLoadingModels(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const activeProviders = providers.filter((provider) => provider.enabled);

  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>{editingId ? "设置 AI Provider" : "添加 AI Provider"}</h2>
          <span className="muted">Key 加密保存；编辑时留空不修改原 Key。</span>
        </div>
        <form className="form-grid" onSubmit={submit}>
          <label>Provider<select value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value, defaultChatModel: "", defaultAnalysisModel: "", defaultCreativeModel: "" })}><option value="gemini">Gemini</option><option value="openai">OpenAI</option></select></label>
          <label>配置名称<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="default / backup / creative" /></label>
          <label>优先级<input type="number" min={1} max={999} value={form.priority} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })} /></label>
          <label>API Key<input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={editingId ? "留空表示不修改" : "粘贴 API Key 后可获取模型列表"} required={!editingId} /></label>
          <label>聊天模型<input list="ai-model-options" value={form.defaultChatModel} onChange={(event) => setForm({ ...form, defaultChatModel: event.target.value })} placeholder="gemini-1.5-flash / gpt-4o-mini" /></label>
          <label>分析模型<input list="ai-model-options" value={form.defaultAnalysisModel} onChange={(event) => setForm({ ...form, defaultAnalysisModel: event.target.value })} /></label>
          <label>创意模型<input list="ai-model-options" value={form.defaultCreativeModel} onChange={(event) => setForm({ ...form, defaultCreativeModel: event.target.value })} /></label>
          <label>状态<select value={form.enabled ? "enabled" : "disabled"} onChange={(event) => setForm({ ...form, enabled: event.target.value === "enabled" })}><option value="enabled">启用</option><option value="disabled">停用</option></select></label>
          <datalist id="ai-model-options">{modelOptions.map((model) => <option key={model} value={model} />)}</datalist>
          <div className="form-actions">
            <button className="primary-btn">{editingId ? "保存设置" : "加密保存"}</button>
            <button className="ghost-btn" type="button" onClick={() => void loadModels()} disabled={loadingModels || (!editingId && !form.apiKey)}>{loadingModels ? "获取中" : "获取可用模型"}</button>
            {editingId && <button className="ghost-btn" type="button" onClick={resetForm}>取消编辑</button>}
          </div>
        </form>
        {status && <div className="notice">{status}</div>}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>已配置模型</h2>
          <span className="muted">当前可自动调用 {activeProviders.length} 个；排在最前的启用 Provider 会被优先使用。</span>
        </div>
        <table className="dense-table config-provider-table"><thead><tr><th>优先级</th><th>Provider</th><th>名称</th><th>Key</th><th>聊天模型</th><th>分析模型</th><th>创意模型</th><th>状态</th><th>操作</th></tr></thead><tbody>
          {providers.map((provider) => <tr key={provider.id}>
            <td>{provider.priority ?? 100}</td>
            <td>{provider.provider}</td>
            <td>{provider.displayName}</td>
            <td>{provider.apiKeyMasked}</td>
            <td>{provider.defaultChatModel || "-"}</td>
            <td>{provider.defaultAnalysisModel || "-"}</td>
            <td>{provider.defaultCreativeModel || "-"}</td>
            <td><span className={`pill ${provider.enabled ? "success" : "pending"}`}>{provider.enabled ? "启用" : "停用"}</span></td>
            <td className="row-actions">
              <button className="table-btn" onClick={() => editProvider(provider)}>设置</button>
              <button className="table-btn" onClick={() => toggleProvider(provider)}>{provider.enabled ? "停用" : "启用"}</button>
              <button className="table-btn" onClick={() => void loadModels(provider.id)}>模型</button>
              <button className="table-btn danger-btn" onClick={() => deleteProvider(provider)}>删除</button>
            </td>
          </tr>)}
          {providers.length === 0 && <tr><td colSpan={9}><div className="empty-state compact"><Bot size={22} /><strong>暂无 AI Provider</strong><span>请先添加 OpenAI 或 Gemini API Key。</span></div></td></tr>}
        </tbody></table>
      </section>
    </>
  );
}







function CreativeData() {
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [adAccountId, setAdAccountId] = useState("");
  const [since, setSince] = useState(addDaysIso(-29));
  const [until, setUntil] = useState(todayIso());
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<AdAccount[]>("/api/ad-accounts").then((items) => {
      setAccounts(items);
      const pendingAccountId = sessionStorage.getItem(ACCOUNT_ANALYSIS_TARGET_KEY);
      setAdAccountId((current) => current || (pendingAccountId && items.some((item) => item.id === pendingAccountId) ? pendingAccountId : items[0]?.id || ""));
    });
  }, []);

  async function load() {
    if (!adAccountId) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ adAccountId, since, until }).toString();
      const result = await api<any>("/api/analysis/account-detail?" + query);
      setRows((result.ads || []).filter((row: any) => row.creativeId));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "素材数据读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function syncStructure() {
    if (!adAccountId) return;
    setLoading(true);
    setStatus("正在同步广告结构和素材快照...");
    try {
      await api("/api/meta-structure/sync-account", {
        method: "POST",
        body: JSON.stringify({ adAccountId, limit: 500, maxPages: 10 }),
      });
      setStatus("素材数据已同步。");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "素材同步失败");
    } finally {
      setLoading(false);
    }
  }

  function askCreative(row: any) {
    window.dispatchEvent(new CustomEvent<CopilotLaunchDetail>("open-copilot", {
      detail: {
        context: compactCopilotContext({
          page: "creative-data",
          adAccountId,
          creativeId: row.creativeId,
          entity: { type: "creative", id: row.creativeId, name: row.adName || row.title || row.creativeId },
          filters: { since, until },
          metrics: {
            spend: row.spend,
            impressions: row.impressions,
            clicks: row.clicks,
            ctr: row.ctr,
            cpc: row.cpc,
            cpm: row.cpm,
            purchases: row.purchases,
            purchaseValue: row.purchaseValue,
            roas: row.roas,
          },
        }),
        prompt: "请分析这个广告素材的数据表现，判断是否疲劳、是否高点击低转化、是否可扩量、是否需要替换 Hook，并给出运营动作建议。",
      },
    }));
  }

  useEffect(() => { if (adAccountId) void load(); }, [adAccountId]);

  const totals = useMemo(() => {
    const spend = rows.reduce((sum, row) => sum + (row.spend || 0), 0);
    const purchases = rows.reduce((sum, row) => sum + (row.purchases || 0), 0);
    const purchaseValue = rows.reduce((sum, row) => sum + (row.purchaseValue || 0), 0);
    const impressions = rows.reduce((sum, row) => sum + (row.impressions || 0), 0);
    const clicks = rows.reduce((sum, row) => sum + (row.clicks || 0), 0);
    return { spend, purchases, purchaseValue, impressions, clicks, roas: safeRatio(purchaseValue, spend), ctr: safeRatio(clicks, impressions) * 100 };
  }, [rows]);

  return (
    <PageBlock title="素材" subtitle="按素材查看花费、点击、转化和 ROAS，用于判断疲劳、扩量和替换方向。">
      <DataCenterTabs active="creativeData" />
      <section className="structure-toolbar">
        <select value={adAccountId} onChange={(event) => setAdAccountId(event.target.value)}>
          {accounts.map((account) => <option key={account.id} value={account.id}>{accountId(account)} / {account.name || ""}</option>)}
        </select>
        <DateToolbar since={since} until={until} setSince={setSince} setUntil={setUntil} onRefresh={load} compact />
        <button className="primary-btn" onClick={syncStructure} disabled={loading}><RefreshCcw size={16} />同步素材</button>
      </section>
      {status && <div className="notice">{status}</div>}
      <div className="grid four">
        <StatCard label="素材数" value={rows.length} />
        <StatCard label="素材花费" value={money(totals.spend)} />
        <StatCard label="素材 ROAS" value={metric(totals.roas)} />
        <StatCard label="平均 CTR" value={`${metric(totals.ctr)}%`} />
      </div>
      {loading ? <Loading /> : <section className="panel data-table-panel">
        <div className="panel-heading">
          <h2>素材表现明细</h2>
        </div>
        <div className="table-scroll">
          <table className="dense-table">
            <thead><tr><th>素材 / 广告</th><th>Creative ID</th><th>花费</th><th>展示</th><th>点击</th><th>CTR</th><th>CPC</th><th>CPM</th><th>购买</th><th>转化价值</th><th>ROAS</th><th>判断</th><th>AI</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const judge = (row.roas || 0) >= 1.5 && (row.purchases || 0) > 0
                  ? "可继续观察/扩量"
                  : (row.ctr || 0) >= 4 && (row.purchases || 0) === 0
                    ? "高点击低转化"
                    : (row.ctr || 0) < 1.5 && (row.spend || 0) > 30
                      ? "低点击，需换 Hook"
                      : (row.frequency || 0) >= 3
                        ? "可能疲劳"
                        : "观察";
                return (
                  <tr key={row.creativeId || row.adId}>
                    <td><strong>{row.adName || row.title || row.creativeId}</strong><span className="subtext">{row.adId || ""}</span></td>
                    <td>{row.creativeId || "-"}</td>
                    <td>{money(row.spend || 0)}</td>
                    <td>{metric(row.impressions)}</td>
                    <td>{metric(row.clicks)}</td>
                    <td>{metric(row.ctr)}</td>
                    <td>{money(row.cpc || 0)}</td>
                    <td>{money(row.cpm || 0)}</td>
                    <td>{metric(row.purchases)}</td>
                    <td className="positive-money">{money(row.purchaseValue || 0)}</td>
                    <td className="roas-cell">{metric(row.roas)}</td>
                    <td>{judge}</td>
                    <td><button className="table-btn" onClick={() => askCreative(row)}>问 AI</button></td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={13}><div className="empty-state compact"><ImageIcon size={22} /><strong>暂无素材数据</strong><span>请先选择账户并同步素材。</span></div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>}
    </PageBlock>
  );
}



function CreativeCopilot() {
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [adAccountId, setAdAccountId] = useState("");
  const [since, setSince] = useState(addDaysIso(-29));
  const [until, setUntil] = useState(todayIso());
  const [rows, setRows] = useState<any[]>([]);
  const [brief, setBrief] = useState<CreativeBriefResult | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [creativeLoadingId, setCreativeLoadingId] = useState("");

  useEffect(() => {
    api<AdAccount[]>("/api/ad-accounts").then((items) => {
      setAccounts(items);
      setAdAccountId((current) => current || items[0]?.id || "");
    });
  }, []);

  async function load() {
    if (!adAccountId) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ adAccountId, since, until }).toString();
      const result = await api<any>("/api/analysis/account-detail?" + query);
      setRows((result.ads || []).filter((row: any) => row.creativeId));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "素材数据读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function syncStructure() {
    if (!adAccountId) return;
    setLoading(true);
    setStatus("正在同步广告结构和素材快照...");
    try {
      await api("/api/meta-structure/sync-account", {
        method: "POST",
        body: JSON.stringify({ adAccountId, limit: 500, maxPages: 10 }),
      });
      setStatus("素材结构同步完成。");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "素材同步失败");
    } finally {
      setLoading(false);
    }
  }

  async function generate(row: any) {
    setCreativeLoadingId(row.creativeId || row.adId);
    try {
      const result = await api<CreativeBriefResult>("/api/ai/creative-brief", {
        method: "POST",
        body: JSON.stringify({
          entityType: row.creativeId ? "creative" : "ad",
          entityId: row.creativeId || row.adId,
          language: "zh-CN",
          productName: row.adName || row.title || row.creativeId,
          performanceSummary: row,
        }),
      });
      setBrief(result);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "创意方向生成失败");
    } finally {
      setCreativeLoadingId("");
    }
  }

  useEffect(() => { if (adAccountId) void load(); }, [adAccountId]);

  return (
    <PageBlock title="Creative Copilot" subtitle="基于素材表现生成文案、Hook、视频脚本、图片/视频 Prompt 和 A/B Test 方向；不会上传或创建广告。">
      <section className="structure-toolbar">
        <select value={adAccountId} onChange={(event) => setAdAccountId(event.target.value)}>
          {accounts.map((account) => <option key={account.id} value={account.id}>{accountId(account)} / {account.name || ""}</option>)}
        </select>
        <DateToolbar since={since} until={until} setSince={setSince} setUntil={setUntil} onRefresh={load} compact />
        <button className="primary-btn" onClick={syncStructure} disabled={loading}><Sparkles size={16} />同步素材</button>
      </section>
      {status && <div className="notice">{status}</div>}
      {loading ? <Loading /> : <section className="creative-grid">
        {rows.slice(0, 60).map((row) => <article className="creative-card" key={row.creativeId || row.adId}>
          <strong>{row.adName || row.title || row.creativeId}</strong>
          <span>{row.creativeId}</span>
          <p>{row.title || row.body || "暂无素材文案快照，请先同步素材。"}</p>
          <dl><dt>花费</dt><dd>{money(row.spend || 0)}</dd><dt>CTR</dt><dd>{metric(row.ctr)}</dd><dt>ROAS</dt><dd>{metric(row.roas)}</dd><dt>购买</dt><dd>{metric(row.purchases)}</dd></dl>
          <button className="table-btn" disabled={creativeLoadingId === (row.creativeId || row.adId)} onClick={() => generate(row)}>{creativeLoadingId === (row.creativeId || row.adId) ? "生成中" : "生成创意方向"}</button>
        </article>)}
        {rows.length === 0 && <section className="panel empty-state compact"><Sparkles size={24} /><h2>暂无素材数据</h2><p>请先同步素材结构。</p></section>}
      </section>}
      {brief && <section className="panel report-panel"><h2>AI 创意输出</h2><div className="brief-meta"><span>模型：{brief.model}</span><span>Provider：{brief.provider}</span></div><pre>{brief.brief}</pre></section>}
    </PageBlock>
  );
}


function ProjectBoard() {
  const [rows, setRows] = useState<SpendAccount[]>([]);
  const [since, setSince] = useState(addDaysIso(-29));
  const [until, setUntil] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  async function load() {
    setLoading(true);
    try {
      const query = new URLSearchParams({ since, until }).toString();
      const result = await api<{ accounts: SpendAccount[] }>("/api/ad-accounts/spend?" + query);
      setRows(result.accounts || []);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "项目类别数据读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, SpendAccount[]>();
    for (const row of rows) {
      const key = row.storeName || "未绑定店铺";
      map.set(key, [...(map.get(key) || []), row]);
    }
    return Array.from(map.entries()).map(([name, accounts]) => ({
      name,
      accounts,
      spend: accounts.reduce((sum, row) => sum + (row.spend || 0), 0),
      purchaseValue: accounts.reduce((sum, row) => sum + (row.purchaseValue || 0), 0),
      purchases: accounts.reduce((sum, row) => sum + (row.purchases || 0), 0),
    }));
  }, [rows]);

  return (
    <PageBlock title="项目类别看板" subtitle="按店铺 / 项目聚合账户表现，作为 AI Media Buyer 的工作台入口。">
      <DateToolbar since={since} until={until} setSince={setSince} setUntil={setUntil} onRefresh={load} />
      {status && <div className="notice danger"><strong>读取失败</strong><span>{status}</span></div>}
      {loading ? <Loading /> : <section className="project-grid">
        {grouped.map((item) => <article className="project-card" key={item.name}>
          <h2>{item.name}</h2>
          <div className="grid three">
            <StatCard label="账户数" value={item.accounts.length} />
            <StatCard label="花费" value={money(item.spend)} />
            <StatCard label="ROAS" value={metric(safeRatio(item.purchaseValue, item.spend))} />
          </div>
          <p>购买 {metric(item.purchases)}，转化价值 {money(item.purchaseValue)}。</p>
        </article>)}
        {grouped.length === 0 && <section className="panel empty-state compact"><LayoutGrid size={24} /><h2>暂无项目数据</h2><p>请先同步账户消耗数据。</p></section>}
      </section>}
    </PageBlock>
  );
}


function OwnerOverview() {
  return (
    <PageBlock title="负责人概览" subtitle="用于承接负责人管理视角，后续接入负责人字段后按人汇总账户、店铺和建议卡片。">
      <div className="grid four">
        <StatCard label="负责人字段" value="待接入" />
        <StatCard label="账户归属" value="待同步" />
        <StatCard label="建议卡片" value="可复用" />
        <StatCard label="AI 分析" value="可追问" />
      </div>
      <section className="panel empty-state compact">
        <Users size={24} />
        <h2>负责人维度待接入</h2>
        <p>当前版本先保留入口，后续从账户或店铺配置中增加负责人字段后自动聚合。</p>
      </section>
    </PageBlock>
  );
}


function SystemSettings() {
  return <SystemSettingsV2 />;
}

function SystemSettingsV2() {
  return (
    <PageBlock title="系统配置中心" subtitle="统一管理 Meta、店铺 API、AI 模型、同步策略与安全状态；业务页面负责操作，配置中心负责确认配置是否可用。">
      <div className="grid four">
        <ConfigCard title="Meta API" value="只读 GET" body="READ_ONLY_MODE 强制开启，graph.facebook.com 非 GET 请求会被拒绝。" />
        <ConfigCard title="店铺 API" value="加密保存" body="Shopline / Shoplazza Token 与 Secret 只在后端加密保存。" />
        <ConfigCard title="AI 模型" value="可启停" body="启用的 Provider 按优先级调用，可随时停用避免突发调用。" />
        <ConfigCard title="同步任务" value="Worker 驱动" body="外部 API 由 Worker 拉取，前端只读数据库和缓存。" />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>数据源入口</h2>
          <span className="muted">配置入口集中展示，具体新增/编辑仍在对应业务页完成。</span>
        </div>
        <div className="config-grid">
          <ConfigRow label="Meta 广告账户" value="Meta Token / 只读权限" note="请在环境变量或后续配置表中提供 Meta Token，再同步广告账户和 Insights。" />
          <ConfigRow label="Shopline" value="平台内部域名 + 后台 API 访问令牌" note="只读同步订单；系统自动选择兼容接口并分页拉取。" />
          <ConfigRow label="Shoplazza" value="平台内部域名 + 私有应用 Access Token" note="只读同步订单，不需要 App UID 或 App Secret。" />
          <ConfigRow label="ERP" value="预留" note="当前只保留接口规划，未接入写入能力。" />
        </div>
      </section>
      <AiProviderSettingsPanel />
    </PageBlock>
  );
}

function ConfigHealthItem({ title, ok, body }: { title: string; ok: boolean; body: string }) {
  return (
    <article className={`config-health-item ${ok ? "ok" : "bad"}`}>
      <span className={`pill ${ok ? "success" : "failed"}`}>{ok ? "正常" : "需处理"}</span>
      <strong>{title}</strong>
      <p>{body}</p>
    </article>
  );
}

function ConfigActionCard({ title, value, body, action, onClick }: {
  title: string;
  value: string;
  body: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <article className="config-card action-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{body}</p>
      <button className="table-btn" onClick={onClick}>{action}</button>
    </article>
  );
}

function ConfigCard({ title, value, body }: { title: string; value: string; body: string }) {
  return (
    <article className="config-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{body}</p>
    </article>
  );
}

function ConfigRow({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="config-row">
      <strong>{label}</strong>
      <code>{value}</code>
      <span>{note}</span>
    </div>
  );
}














function Stores() {
  const emptyForm = {
    name: "",
    platform: "shopline" as StoreRecord["platform"],
    domain: "",
    apiToken: "",
    timezone: "",
  };
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [selectedAccountsByStore, setSelectedAccountsByStore] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState("");
  const [actionResult, setActionResult] = useState<{ type: "success" | "error"; title: string; body: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState("");
  const [busyStoreId, setBusyStoreId] = useState("");
  const [bindingStoreId, setBindingStoreId] = useState("");
  const [filter, setFilter] = useState<"connected" | "unconnected" | "all">("connected");
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [form, setForm] = useState(emptyForm);

  async function load() {
    setLoading(true);
    try {
      const [storeItems, accountItems] = await Promise.all([
        api<StoreRecord[]>("/api/stores"),
        api<AdAccount[]>("/api/ad-accounts"),
      ]);
      setStores(storeItems);
      setAccounts(accountItems);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "店铺列表读取失败");
    } finally {
      setLoading(false);
    }
  }

  function cleanDomain(value: string) {
    return value
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/admin(?:\/.*)?$/i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }

  function domainPlaceholder(platform: StoreRecord["platform"]) {
    if (platform === "shopline") return "your-handle.myshopline.com";
    if (platform === "shopify") return "your-store.myshopify.com";
    return "your-subdomain.myshoplaza.com";
  }

  function platformHelpText(platform: StoreRecord["platform"]) {
    if (platform === "shopline") {
      return "Shopline 只需填写平台内部域名（*.myshopline.com）和后台 API 访问令牌；系统按参考项目逻辑自动探测商品接口，必要时用订单接口兜底。";
    }
    if (platform === "shopify") {
      return "Shopify 使用 myshopify.com 内部域名和 Admin API Access Token；接口预留按参考项目 2024-01 products/orders 只读调用。";
    }
    return "Shoplazza 只需填写平台内部域名（*.myshoplaza.com）和私有应用 Access Token；系统按参考项目自动检测 2022-01/2020-01 与 .json 后缀。";
  }

  function tokenLabel(platform: StoreRecord["platform"]) {
    if (platform === "shopline") return "后台 API 访问令牌";
    if (platform === "shopify") return "Shopify Admin API Access Token";
    return "Shoplazza Access Token";
  }

  function tokenPlaceholder(platform: StoreRecord["platform"], isEditing: boolean) {
    if (isEditing) return "留空表示不修改";
    if (platform === "shopline") return "Shopline 后台 API 访问令牌";
    if (platform === "shopify") return "Shopify Admin API Access Token";
    return "Shoplazza Access Token";
  }

  function openCreateForm() {
    setEditingStoreId("");
    setForm(emptyForm);
    setFormOpen(true);
    setStatus("");
    setActionResult(null);
  }

  function openEditForm(store: StoreRecord) {
    setEditingStoreId(store.id);
    setForm({
      name: store.name,
      platform: store.platform,
      domain: cleanDomain(store.apiBaseUrl || store.domain),
      apiToken: "",
      timezone: store.timezone || "",
    });
    setFormOpen(true);
    setStatus("正在编辑店铺。已保存的访问令牌不会回显，留空表示不修改。");
    setActionResult(null);
  }

  function openStoreDetail(store: StoreRecord) {
    setSelectedStoreId(store.id);
    setFormOpen(false);
    setEditingStoreId("");
    setStatus("");
    setActionResult(null);
    setAccountSearch("");
  }

  function closeForm() {
    setFormOpen(false);
    setEditingStoreId("");
    setForm(emptyForm);
  }

  async function submitStore(event: React.FormEvent) {
    event.preventDefault();
    const isEditing = Boolean(editingStoreId);
    if (!isEditing && !form.apiToken.trim()) {
      setStatus("新增店铺必须填写 API Token / 后台 API 访问令牌。");
      return;
    }
    if (!form.domain.trim()) {
      setStatus(`请填写平台内部店铺域名：${domainPlaceholder(form.platform)}。`);
      return;
    }
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      platform: form.platform,
      domain: cleanDomain(form.domain),
      status: "active",
    };
    if (form.apiToken.trim()) body.apiToken = form.apiToken.trim();
    if (form.timezone.trim()) body.timezone = form.timezone.trim();

    setStatus(isEditing ? "正在保存店铺配置..." : "正在创建店铺...");
    try {
      await api(isEditing ? `/api/stores/${encodeURIComponent(editingStoreId)}` : "/api/stores", {
        method: isEditing ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      setStatus(isEditing ? "店铺订单连接配置已更新。" : "店铺已创建，访问令牌已由后端加密保存。");
      closeForm();
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存店铺失败");
    }
  }

  async function testFormConnection() {
    if (!form.domain.trim() || !form.apiToken.trim()) {
      setActionResult({ type: "error", title: "无法测试连接", body: "请先填写平台内部店铺域名和访问令牌。" });
      return;
    }
    setBusyStoreId("form-test");
    setActionResult(null);
    try {
      const result = await fetch(`/api/stores/test-${form.platform}-connection`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: cleanDomain(form.domain), token: form.apiToken.trim() }),
      }).then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || payload.message || "连接测试失败");
        return payload as { success: boolean; message?: string; products?: unknown[]; api_path_used?: string };
      });
      setActionResult({
        type: result.success ? "success" : "error",
        title: result.success ? "连接测试通过" : "连接测试失败",
        body: `${result.message || ""}${result.api_path_used ? ` 接口：${result.api_path_used}` : ""}${result.products ? ` 样本商品：${result.products.length}` : ""}`,
      });
    } catch (error) {
      setActionResult({ type: "error", title: "连接测试失败", body: error instanceof Error ? error.message : "连接测试失败" });
    } finally {
      setBusyStoreId("");
    }
  }

  async function runStoreAction(storeId: string, action: "test-token" | "deactivate") {
    setBusyStoreId(storeId);
    setStatus("");
    setActionResult(null);
    try {
      if (action === "test-token") {
        const result = await api<StoreProbeResult>(`/api/stores/${encodeURIComponent(storeId)}/test-token`, { method: "POST", body: "{}" });
        const details = [
          result.message || (result.ok ? "订单读取权限验证通过。" : "请检查平台内部域名、访问令牌和订单读取权限。"),
          result.endpoint ? `接口：${result.endpoint}` : "",
          result.stage ? `探测：${result.stage === "products" ? "商品接口" : "订单接口"}` : "",
          result.sampleProducts !== undefined ? `商品样本：${result.sampleProducts}` : "",
          result.sampleOrders !== undefined ? `订单样本：${result.sampleOrders}` : "",
          result.requestId ? `Request ID：${result.requestId}` : "",
          result.productProbeError ? `商品接口兜底原因：${result.productProbeError}` : "",
          compactPathList(result.attemptedPaths) ? `尝试路径：${compactPathList(result.attemptedPaths)}` : "",
        ].filter(Boolean).join("；");
        setActionResult({
          type: result.ok ? "success" : "error",
          title: result.ok ? "连接测试通过" : "连接测试失败",
          body: details,
        });
      }
      if (action === "deactivate") {
        await api(`/api/stores/${encodeURIComponent(storeId)}/deactivate`, { method: "POST", body: "{}" });
        setActionResult({ type: "success", title: "店铺已停用", body: "后续自动任务不会继续同步该店铺。" });
      }
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "操作失败";
      setActionResult({
        type: "error",
        title: action === "test-token" ? "连接测试失败" : "操作失败",
        body: `${message}。请优先检查平台内部店铺域名、访问令牌是否过期、应用是否拥有订单读取权限。`,
      });
    } finally {
      setBusyStoreId("");
    }
  }

  async function syncStoreProfileAction(store: StoreRecord) {
    setBusyStoreId(store.id);
    setActionResult(null);
    try {
      await api(`/api/stores/${encodeURIComponent(store.id)}/sync-profile`, { method: "POST", body: "{}" });
      setActionResult({ type: "success", title: "店铺信息已同步", body: "已重新读取平台店铺名称、币种和 timezone。" });
      await load();
    } catch (error) {
      setActionResult({ type: "error", title: "店铺信息同步失败", body: error instanceof Error ? error.message : "请检查平台接口和访问令牌。" });
    } finally {
      setBusyStoreId("");
    }
  }

  async function bindSelectedAccounts(store: StoreRecord) {
    const adAccountIds = selectedAccountsByStore[store.id] || [];
    if (adAccountIds.length === 0) {
      setActionResult({ type: "error", title: "请选择广告账户", body: "至少选择一个 Meta 广告账户再绑定。" });
      return;
    }
    setBindingStoreId(store.id);
    setActionResult(null);
    try {
      const result = await api<{ saved: number }>("/api/mappings/bind-bulk", {
        method: "POST",
        body: JSON.stringify({ storeId: store.id, adAccountIds }),
      });
      setSelectedAccountsByStore((value) => ({ ...value, [store.id]: [] }));
      setActionResult({ type: "success", title: "绑定完成", body: `已绑定 ${result.saved} 个广告账户。` });
      await load();
    } catch (error) {
      setActionResult({ type: "error", title: "绑定失败", body: error instanceof Error ? error.message : "绑定广告账户失败" });
    } finally {
      setBindingStoreId("");
    }
  }

  function availableAccountsForStore(store: StoreRecord) {
    const mappedIds = new Set((store.mappedAccounts || []).map((account) => account.id));
    return accounts.filter((account) => !mappedIds.has(account.id));
  }

  function filteredAccountsForStore(store: StoreRecord) {
    const keyword = accountSearch.trim().toLowerCase();
    return availableAccountsForStore(store).filter((account) => {
      const id = accountId(account).toLowerCase();
      const name = (account.name || "").toLowerCase();
      return !keyword || id.includes(keyword) || name.includes(keyword);
    });
  }

  function updatePlatform(platform: StoreRecord["platform"]) {
    setForm((value) => ({
      ...value,
      platform,
      domain: platform === value.platform ? value.domain : "",
      apiToken: platform === value.platform ? value.apiToken : "",
    }));
  }

  const connectedStores = stores.filter((store) => store.apiTokenConfigured);
  const unconnectedStores = stores.filter((store) => !store.apiTokenConfigured);
  const visibleStores = filter === "connected" ? connectedStores : filter === "unconnected" ? unconnectedStores : stores;
  const selectedStore = stores.find((store) => store.id === selectedStoreId) || null;

  async function syncStoresFromConfig() {
    setStatus("正在同步最近 30 天店铺订单...");
    setActionResult(null);
    try {
      const result = await api<{ stores: number; fetched: number; saved: number; results: Array<{ storeName: string; success: boolean; error?: string }> }>("/api/sync-store", {
        method: "POST",
        body: JSON.stringify({ limit: 250, maxPages: 100 }),
      });
      const failures = result.results.filter((item) => !item.success);
      setActionResult({
        type: failures.length ? "error" : "success",
        title: failures.length ? "同步完成但有失败" : "同步完成",
        body: failures.length
          ? `店铺 ${result.stores}，抓取 ${result.fetched}，保存 ${result.saved}。失败：${failures.slice(0, 3).map((item) => `${item.storeName}: ${item.error || "同步失败"}`).join("；")}`
          : `店铺 ${result.stores}，抓取 ${result.fetched}，保存 ${result.saved}。`,
      });
      await load();
    } catch (error) {
      setActionResult({ type: "error", title: "同步失败", body: error instanceof Error ? error.message : "同步店铺数据失败" });
    } finally {
      setStatus("");
    }
  }

  async function syncOneStore(store: StoreRecord) {
    setBusyStoreId(store.id);
    setActionResult(null);
    try {
      const result = await api<{ fetched: number; saved: number; results?: Array<{ storeName: string; success: boolean; error?: string }> }>("/api/sync-store", {
        method: "POST",
        body: JSON.stringify({ storeId: store.id, limit: 250, maxPages: 100 }),
      });
      const failure = result.results?.find((item) => !item.success);
      setActionResult({
        type: failure ? "error" : "success",
        title: failure ? "同步失败" : "同步完成",
        body: failure?.error || `店铺 ${store.name} 抓取 ${result.fetched}，保存 ${result.saved}。`,
      });
      await load();
    } catch (error) {
      setActionResult({ type: "error", title: "同步失败", body: error instanceof Error ? error.message : "同步店铺数据失败" });
    } finally {
      setBusyStoreId("");
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <PageBlock title="店铺管理" subtitle="">
      <section className="panel compact-config-panel">
        <h2>店铺数据源配置</h2>
        <div className="row-actions">
          <button className="table-btn" onClick={syncStoresFromConfig}>同步店铺数据</button>
          <button className="primary-btn" onClick={openCreateForm}>添加店铺</button>
        </div>
      </section>
      <section className="panel store-filter-panel">
        <div className="segmented-tabs">
          <button className={filter === "connected" ? "active" : ""} onClick={() => setFilter("connected")}>已连接店铺（{connectedStores.length}）</button>
          <button className={filter === "unconnected" ? "active" : ""} onClick={() => setFilter("unconnected")}>未连接店铺（{unconnectedStores.length}）</button>
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部店铺（{stores.length}）</button>
        </div>
      </section>
      {formOpen && (
        <section className="panel store-form-panel">
          <div className="panel-heading">
            <h2>{editingStoreId ? "编辑店铺" : "新增店铺"}</h2>
          </div>
          <form className="store-form-grid" onSubmit={submitStore}>
            <label>店铺名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如 Kolaich" required /></label>
            <label>平台<select value={form.platform} onChange={(event) => updatePlatform(event.target.value as StoreRecord["platform"])}><option value="shopline">Shopline</option><option value="shoplazza">Shoplazza</option><option value="shopify">Shopify</option></select></label>
            <label>平台内部店铺域名<input value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} placeholder={domainPlaceholder(form.platform)} required /></label>
            <label>{tokenLabel(form.platform)}<input type="password" value={form.apiToken} onChange={(event) => setForm({ ...form, apiToken: event.target.value })} placeholder={tokenPlaceholder(form.platform, Boolean(editingStoreId))} required={!editingStoreId} /></label>
            <label>订单统计时区<input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} placeholder="默认自动获取，例如 Asia/Shanghai" /></label>
            {form.timezone && <div className="form-hint">手动修改 timezone 后，建议执行历史订单日期重算脚本，避免历史统计口径不一致。</div>}
            <div className="form-actions">
              <button className="primary-btn">{editingStoreId ? "保存修改" : "创建店铺"}</button>
              <button className="ghost-btn" type="button" onClick={testFormConnection} disabled={busyStoreId === "form-test"}>{busyStoreId === "form-test" ? "测试中" : "测试连接"}</button>
              <button className="ghost-btn" type="button" onClick={closeForm}>取消</button>
            </div>
          </form>
        </section>
      )}
      {status && <div className="notice">{status}</div>}
      {actionResult && <div className={`notice ${actionResult.type === "error" ? "danger" : "success"}`}><strong>{actionResult.title}</strong><span>{actionResult.body}</span></div>}
      {loading ? <Loading /> : stores.length === 0 ? (
        <section className="panel empty-state">
          <Store size={44} />
          <h2>暂无店铺</h2>
          <p>请先添加一个 Shopline、Shoplazza 或 Shopify 店铺，再绑定广告账户并同步订单。</p>
          <button className="primary-btn" onClick={openCreateForm}>添加第一个店铺</button>
        </section>
      ) : selectedStore ? (
        <section className="panel store-detail-panel">
          <div className="store-detail-topbar">
            <button className="ghost-btn" type="button" onClick={() => setSelectedStoreId("")}>返回店铺</button>
            <div>
              <strong>{selectedStore.name}</strong>
              <span>{selectedStore.platform} / {selectedStore.domain}</span>
            </div>
            <div className="row-actions">
              <button className="table-btn" onClick={() => window.dispatchEvent(new CustomEvent<Page>("switch-page", { detail: "storeData" }))}>查看数据</button>
              <button className="table-btn" onClick={() => openEditForm(selectedStore)}>设置</button>
              <button className="table-btn" disabled={busyStoreId === selectedStore.id} onClick={() => syncStoreProfileAction(selectedStore)}>同步店铺信息</button>
              <button className="table-btn" disabled={busyStoreId === selectedStore.id} onClick={() => runStoreAction(selectedStore.id, "test-token")}>测试连接</button>
              <button className="primary-btn" disabled={busyStoreId === selectedStore.id} onClick={() => syncOneStore(selectedStore)}>同步数据</button>
              {selectedStore.status !== "inactive" && <button className="table-btn danger-btn" disabled={busyStoreId === selectedStore.id} onClick={() => runStoreAction(selectedStore.id, "deactivate")}>停用</button>}
            </div>
          </div>
          <div className="store-detail-summary">
            <div><span>平台</span><strong>{selectedStore.platform}</strong></div>
            <div><span>内部域名</span><strong>{cleanDomain(selectedStore.apiBaseUrl || selectedStore.domain)}</strong></div>
            <div><span>连接状态</span><strong>{selectedStore.apiTokenConfigured ? "API 已配置" : "未配置 Token"}</strong></div>
            <div><span>已绑定账户</span><strong>{selectedStore.mappedAccounts?.length || 0}</strong></div>
            <div><span>订单统计时区</span><strong>{selectedStore.timezone || "未获取"}</strong></div>
          </div>
          <div className="store-detail-grid">
            <div className="store-detail-block">
              <h3>店铺设置</h3>
              <div className="store-config-readonly">
                <div><span>店铺名称</span><strong>{selectedStore.name}</strong></div>
                <div><span>平台</span><strong>{selectedStore.platform}</strong></div>
                <div><span>店铺域名</span><strong>{selectedStore.domain}</strong></div>
                <div><span>访问令牌</span><strong>{selectedStore.apiTokenConfigured ? "已加密保存" : "未配置"}</strong></div>
                <div><span>Timezone 来源</span><strong>{selectedStore.timezoneSource === "api" ? "平台自动获取" : selectedStore.timezoneSource === "manual" ? "手动设置" : selectedStore.timezoneSource === "default" ? "系统默认" : "未验证"}</strong></div>
                <div><span>最近验证</span><strong>{selectedStore.timezoneVerifiedAt ? fmtDate(selectedStore.timezoneVerifiedAt) : "-"}</strong></div>
              </div>
            </div>
            <div className="store-detail-block">
              <div className="store-mapping-head">
                <h3>Meta 账户批量绑定</h3>
                <span>{selectedStore.mappedAccounts?.length || 0} 个已绑定</span>
              </div>
              {(selectedStore.mappedAccounts || []).length > 0 && (
                <div className="mapped-account-list mapped-account-list-large">
                  {(selectedStore.mappedAccounts || []).map((account) => (
                    <span key={account.id}>{account.name || accountId(account as AdAccount)} / {accountId(account as AdAccount)}</span>
                  ))}
                </div>
              )}
              <label className="search-field">搜索可绑定账户<input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="搜索账户名称 / 账户 ID" /></label>
              <select
                multiple
                size={Math.min(10, Math.max(5, filteredAccountsForStore(selectedStore).length || 5))}
                value={selectedAccountsByStore[selectedStore.id] || []}
                onChange={(event) => {
                  const values = Array.from(event.currentTarget.selectedOptions).map((option) => option.value);
                  setSelectedAccountsByStore((current) => ({ ...current, [selectedStore.id]: values }));
                }}
              >
                {filteredAccountsForStore(selectedStore).map((account) => (
                  <option key={account.id} value={account.id}>{account.name || accountId(account)} / {accountId(account)}</option>
                ))}
              </select>
              <div className="row-actions">
                <button className="table-btn" disabled={bindingStoreId === selectedStore.id || filteredAccountsForStore(selectedStore).length === 0} onClick={() => bindSelectedAccounts(selectedStore)}>
                  批量绑定
                </button>
                <span className="muted-text">支持按账户名称或账户 ID 搜索后多选绑定。</span>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="store-grid">
          {visibleStores.map((store) => (
            <article className="store-card compact-store-card" key={store.id} role="button" tabIndex={0} onClick={() => openStoreDetail(store)} onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") openStoreDetail(store);
            }}>
              <div className="store-card-head">
                <div className="store-avatar"><Store size={20} /></div>
                <div>
                  <strong className="store-title-line">
                    {store.name}
                    <span className="platform-badge">{store.platform}</span>
                    <span className={`pill ${store.apiTokenConfigured ? "success" : "failed"}`}>{store.apiTokenConfigured ? "API ACTIVE" : "NO API"}</span>
                  </strong>
                  <span>{store.domain}</span>
                </div>
                <StatusPill status={store.status} />
              </div>
              <div className="compact-store-footer">
                <div><Link2 size={16} /><span>已关联 {store.mappedAccounts?.length || 0} 个广告账户</span></div>
                <span className={`pill ${store.apiTokenConfigured ? "success" : "failed"}`}>{store.apiTokenConfigured ? "API ACTIVE" : "NO API"}</span>
              </div>
            </article>
          ))}
        </section>
      )}
    </PageBlock>
  );
}


function Mappings() {
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [storeId, setStoreId] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [csv, setCsv] = useState("store_name,platform,domain,meta_account_id,meta_account_name\n");
  const [validRows, setValidRows] = useState<MappingImportRow[]>([]);
  const [issues, setIssues] = useState<MappingImportIssue[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [storeItems, accountItems] = await Promise.all([api<StoreRecord[]>("/api/stores"), api<AdAccount[]>("/api/ad-accounts")]);
      setStores(storeItems);
      setAccounts(accountItems);
      setStoreId((current) => current || storeItems[0]?.id || "");
      setAdAccountId((current) => current || accountItems[0]?.id || "");
    } finally {
      setLoading(false);
    }
  }

  async function bind(event: React.FormEvent) {
    event.preventDefault();
    if (!storeId || !adAccountId) return;
    try {
      await api("/api/mappings/bind", { method: "POST", body: JSON.stringify({ storeId, adAccountId }) });
      setStatus("绑定成功。一个广告账户只会绑定到一个主店铺。");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "绑定失败");
    }
  }

  async function validateImport(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{ validRows: MappingImportRow[]; issues: MappingImportIssue[] }>("/api/mappings/validate-csv", {
        method: "POST",
        body: JSON.stringify({ csv }),
      });
      setValidRows(result.validRows || []);
      setIssues(result.issues || []);
      setStatus("校验完成：可导入 " + (result.validRows || []).length + " 行，问题 " + (result.issues || []).length + " 条。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入校验失败");
    }
  }

  async function confirmImport() {
    try {
      await api("/api/mappings/import-confirmed", { method: "POST", body: JSON.stringify({ rows: validRows }) });
      setStatus("映射表导入完成。");
      setValidRows([]);
      setIssues([]);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <PageBlock title="店铺账户映射" subtitle="一个店铺可绑定多个 Meta 广告账户；一个广告账户只绑定一个主店铺。导入时只校验，不自动乱匹配。">
      {loading ? <Loading /> : <>
        <section className="panel">
          <div className="panel-heading"><h2>手动绑定</h2><span className="muted">用于少量账户快速绑定。</span></div>
          <form className="form-grid" onSubmit={bind}>
            <label>店铺<select value={storeId} onChange={(event) => setStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name} / {store.platform} / {store.domain}</option>)}</select></label>
            <label>广告账户<select value={adAccountId} onChange={(event) => setAdAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{accountId(account)} / {account.name || ""}</option>)}</select></label>
            <div className="form-actions"><button className="primary-btn">绑定</button></div>
          </form>
        </section>
        <section className="panel">
          <div className="panel-heading"><h2>CSV 批量导入</h2><span className="muted">格式：store_name,platform,domain,meta_account_id,meta_account_name</span></div>
          <form onSubmit={validateImport} className="stack-form">
            <textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={8} />
            <div className="form-actions"><button className="primary-btn">校验导入数据</button>{validRows.length > 0 && <button className="ghost-btn" type="button" onClick={confirmImport}>确认导入 {validRows.length} 行</button>}</div>
          </form>
        </section>
        {status && <div className="notice">{status}</div>}
        {issues.length > 0 && <section className="panel"><h2>校验问题</h2><table className="dense-table"><thead><tr><th>行号</th><th>字段</th><th>问题</th></tr></thead><tbody>{issues.map((issue, index) => <tr key={index}><td>{issue.rowNumber}</td><td>{issue.field || "-"}</td><td>{issue.message}</td></tr>)}</tbody></table></section>}
      </>}
    </PageBlock>
  );
}


function SyncLogs() {
  return <SyncLogsV2 />;
}


function SyncLogsV2() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [summary, setSummary] = useState<SyncOperationsSummary | null>(null);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: "120" });
      if (type) query.set("type", type);
      const [logsResult, summaryResult] = await Promise.all([
        api<SyncLog[]>("/api/sync-logs?" + query.toString()),
        api<SyncOperationsSummary>("/api/sync-logs/summary"),
      ]);
      setLogs(logsResult);
      setSummary(summaryResult);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同步日志读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function retryFailed() {
    setMessage("正在重试最近失败的同步任务...");
    try {
      const result = await api<{ scanned: number; retried: number; failed: number; skipped: number }>("/api/sync-logs/retry-failed", {
        method: "POST",
        body: JSON.stringify({ limit: 10 }),
      });
      setMessage(`重试完成：扫描 ${result.scanned}，已重试 ${result.retried}，失败 ${result.failed}，跳过 ${result.skipped}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重试失败");
    }
  }

  useEffect(() => { void load(); }, [type]);

  const visibleLogs = useMemo(() => status ? logs.filter((log) => log.status === status) : logs, [logs, status]);
  const operationTypes = summary?.operations.map((item) => ({ type: item.type, label: item.label })) || [];

  return (
    <PageBlock title="同步运行状态" subtitle="确认 Worker 是否启用、各同步任务最近是否成功、失败在哪里、是否能重试，以判断 Meta/订单数据是否正在自动拉取。">
      {loading && !summary ? <Loading /> : <>
        <div className="grid four">
          <StatCard label="Scheduler" value={summary?.scheduler.enabled ? "已启用" : "未启用"} hint={`启动延迟 ${summary?.scheduler.startDelaySeconds ?? 0}s`} />
          <StatCard label="运行中任务" value={summary?.totals.running ?? 0} hint="状态为 running 的日志" />
          <StatCard label="失败队列" value={summary?.totals.failedQueue ?? 0} hint={summary?.scheduler.failedRetryEnabled ? `自动重试每 ${summary.scheduler.failedRetryIntervalMinutes} 分钟` : "自动重试未启用"} />
          <StatCard label="规则监测" value={summary?.scheduler.ruleMonitorEnabled ? "已启用" : "未启用"} hint={`间隔 ${summary?.scheduler.ruleMonitorIntervalMinutes ?? 0} 分钟`} />
        </div>
        {summary && <section className="panel sync-health-panel">
          <div className="panel-heading">
            <h2>同步任务矩阵</h2>
            <div className="row-actions">
              <button className="table-btn" onClick={load}><RefreshCcw size={15} />刷新</button>
              <button className="table-btn" onClick={retryFailed}>重试失败</button>
            </div>
          </div>
          <div className="sync-operation-grid">
            {summary.operations.map((operation) => (
              <article key={operation.type} className={`sync-operation-card ${operation.health}`}>
                <div>
                  <span className={`pill ${syncHealthClass(operation.health)}`}>{syncHealthLabel(operation.health)}</span>
                  <strong>{operation.label}</strong>
                </div>
                <dl>
                  <dt>状态</dt><dd>{operation.enabled ? "自动任务启用" : "自动任务未启用"}</dd>
                  <dt>间隔</dt><dd>{operation.intervalMinutes ? `${operation.intervalMinutes} 分钟` : "-"}</dd>
                  <dt>最近执行</dt><dd>{fmtDate(operation.latest?.startedAt)}</dd>
                  <dt>下次预计</dt><dd>{fmtDate(operation.nextRunAt || undefined)}</dd>
                </dl>
                <p>{operation.latest?.errorMessage || latestSyncCopy(operation)}</p>
                {operation.latest?.metadata && <small className="sync-meta-line">{syncMetadataSummary(operation.latest.metadata)}</small>}
                <div className="row-actions">
                  {operation.type === "meta_insights" && <button className="table-btn" onClick={() => window.dispatchEvent(new CustomEvent<Page>("switch-page", { detail: "audienceAnalysis" }))}>受众分析</button>}
                  {operation.type === "meta_insights" && <button className="table-btn" onClick={() => window.dispatchEvent(new CustomEvent<Page>("switch-page", { detail: "accountData" }))}>账户消耗</button>}
                  {operation.type === "meta_structure" && <button className="table-btn" onClick={() => window.dispatchEvent(new CustomEvent<Page>("switch-page", { detail: "accountAnalysis" }))}>结构分析</button>}
                  {operation.type === "orders" && <button className="table-btn" onClick={() => window.dispatchEvent(new CustomEvent<Page>("switch-page", { detail: "storeAnalysis" }))}>店铺分析</button>}
                </div>
              </article>
            ))}
          </div>
        </section>}
        {summary && summary.failedQueue.length > 0 && <section className="panel sync-failed-panel">
          <div className="panel-heading">
            <h2>失败任务优先处理</h2>
            <span className="muted">展示最近 20 条失败任务，便于先定位 Token、权限、店铺 API 或 Meta 请求问题。</span>
          </div>
          <SyncLogTableV2 logs={summary.failedQueue} compact />
        </section>}
        <section className="panel">
          <div className="panel-heading">
            <h2>同步日志明细</h2>
            <div className="row-actions sync-filter-actions">
              <select value={type} onChange={(event) => setType(event.target.value)}>
                <option value="">全部类型</option>
                {operationTypes.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
              </select>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">全部状态</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
                <option value="running">运行中</option>
                <option value="pending">等待中</option>
              </select>
              <button className="primary-btn" onClick={load}><RefreshCcw size={16} />刷新日志</button>
            </div>
          </div>
          {message && <div className="notice">{message}</div>}
          {loading ? <Loading /> : <SyncLogTableV2 logs={visibleLogs} />}
        </section>
      </>}
    </PageBlock>
  );
}

function syncHealthClass(health: string): string {
  if (health === "healthy") return "success";
  if (health === "running") return "pending";
  if (health === "attention") return "failed";
  return "accepted";
}














function syncHealthLabel(health: string): string {
  if (health === "healthy") return "正常";
  if (health === "running") return "运行中";
  if (health === "attention") return "需处理";
  if (health === "disabled") return "未启用";
  return "待观察";
}

function latestSyncCopy(operation: SyncOperationSummary): string {
  if (!operation.enabled) return "该自动任务未启用，可在 .env 中开启对应同步开关。";
  if (!operation.latest) return "尚未产生同步日志，请等待 Worker 首次执行或手动触发同步。";
  if (operation.latest.status === "success") return `最近成功：抓取 ${operation.latest.recordsFetched}，保存 ${operation.latest.recordsSaved}。`;
  if (operation.latest.status === "running") return "任务正在执行，请稍后刷新查看结果。";
  return "最近任务未成功，请查看失败队列和错误信息。";
}

function syncMetadataSummary(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "-";
  const value = metadata as Record<string, unknown>;
  const parts: string[] = [];
  if (value.level) parts.push(`层级 ${value.level}`);
  if (value.days) parts.push(`天数 ${value.days}`);
  if (value.since || value.until) parts.push(`${value.since || "-"} 至 ${value.until || "-"}`);
  if (value.countryBreakdown !== undefined) parts.push(`国家 ${value.countryBreakdown ? "开" : "关"}`);
  if (Array.isArray(value.breakdowns) && value.breakdowns.length > 0) parts.push(`受众 ${value.breakdowns.join(", ")}`);
  if (value.breakdownRowsFetched !== undefined) parts.push(`受众行 ${value.breakdownRowsFetched}`);
  if (value.endpoint) parts.push(`接口 ${String(value.endpoint)}`);
  if (Array.isArray(value.attemptedPaths) && value.attemptedPaths.length > 0) parts.push(`路径 ${compactPathList(value.attemptedPaths.map((item) => String(item)))}`);
  if (value.requestId) parts.push(`Request ID ${String(value.requestId)}`);
  if (value.maxPages) parts.push(`页数 ${value.maxPages}`);
  if (value.pages) parts.push(`页数 ${value.pages}`);
  if (value.limit) parts.push(`limit ${value.limit}`);
  return parts.length > 0 ? parts.join(" / ") : JSON.stringify(value);
}

function DateToolbar({ since, until, setSince, setUntil, onRefresh, compact = false }: {
  since: string;
  until: string;
  setSince: (value: string) => void;
  setUntil: (value: string) => void;
  onRefresh: () => void;
  compact?: boolean;
}) {
  return <div className={compact ? "date-inline" : "toolbar"}><label>开始日期<input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label><label>结束日期<input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label><button className="primary-btn" onClick={onRefresh}><RefreshCcw size={16} />刷新</button></div>;
}

function jsonArrayText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function metadataText(metadata: unknown, key: string): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatReportDataValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function collectReportDataRows(value: unknown): Array<{ label: string; value: string }> {
  const labels: Record<string, string> = {
    spend: "消耗",
    impressions: "展示",
    reach: "覆盖",
    clicks: "点击",
    ctr: "CTR",
    cpc: "CPC",
    cpm: "CPM",
    purchases: "订单",
    purchaseValue: "转化价值",
    purchase_value: "转化价值",
    roas: "ROAS",
    purchaseRoas: "ROAS",
    costPerPurchase: "单次购买费用",
    addToCart: "加购",
    initiateCheckout: "结账发起",
    status: "数据状态",
    latestDataAt: "最新数据时间",
  };
  const rows: Array<{ label: string; value: string }> = [];
  const visited = new Set<string>();

  function addRowsFromRecord(record: Record<string, unknown>) {
    for (const key of Object.keys(labels)) {
      if (record[key] !== undefined && !visited.has(key)) {
        visited.add(key);
        rows.push({ label: labels[key], value: formatReportDataValue(record[key]) });
      }
    }
  }

  if (isRecord(value)) {
    addRowsFromRecord(value);
    for (const nestedKey of ["overview", "metrics", "dataQuality", "account", "row", "entity"]) {
      const nested = value[nestedKey];
      if (isRecord(nested)) addRowsFromRecord(nested);
    }
    if (rows.length < 8) {
      for (const [key, raw] of Object.entries(value)) {
        if (rows.length >= 12) break;
        if (visited.has(key) || isRecord(raw) || Array.isArray(raw)) continue;
        visited.add(key);
        rows.push({ label: labels[key] || key, value: formatReportDataValue(raw) });
      }
    }
  }
  return rows.slice(0, 12);
}

function stringifyReportData(value: unknown): string {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function AiReportPanel({
  detail,
  onOpenSuggestions,
  actionLabel = "查看建议中心",
  onSuggestionStatusChange,
}: {
  detail: AiReportDetail;
  onOpenSuggestions?: () => void;
  actionLabel?: string;
  onSuggestionStatusChange?: (id: string, status: string) => void | Promise<void>;
}) {
  const aiNarrative = metadataText(detail.report.metadata, "aiNarrative");
  const riskPoints = jsonArrayText(detail.report.riskPoints);
  const checklist = detail.suggestions.flatMap((suggestion) => suggestion.executionChecklist || []).slice(0, 8);
  const dataRows = collectReportDataRows(detail.report.dataBasis);
  const dataJson = stringifyReportData(detail.report.dataBasis);
  return (
    <section className="panel ai-report-panel">
      <div className="panel-heading">
        <div>
          <h2>AI 深度分析报告</h2>
          <span className="muted">{detail.entity?.label || detail.report.entityId} · {detail.report.model || "local-rules"} · {fmtDate(detail.report.createdAt)}</span>
        </div>
        <div className="row-actions">
          <span className="pill pending">P{detail.report.priority}</span>
          {onOpenSuggestions && <button className="table-btn" onClick={onOpenSuggestions}>{actionLabel}</button>}
        </div>
      </div>
      <div className="ai-report-grid">
        <article>
          <strong>结论</strong>
          <p>{detail.report.conclusion}</p>
        </article>
        <article>
          <strong>观察周期</strong>
          <p>{detail.report.observationWindow || "建议至少观察 3 天，并对比 7 天和 30 天趋势。"}</p>
        </article>
      </div>
      {aiNarrative && <pre className="ai-report-narrative">{aiNarrative}</pre>}
      <article className="ai-report-data">
        <strong>数据依据</strong>
        {dataRows.length > 0 ? (
          <div className="ai-report-data-grid">
            {dataRows.map((row) => (
              <span key={row.label}>
                <small>{row.label}</small>
                <b>{row.value}</b>
              </span>
            ))}
          </div>
        ) : <p className="muted">暂无结构化数据依据，请查看原始依据。</p>}
        {dataJson && (
          <details>
            <summary>查看原始依据</summary>
            <pre>{dataJson}</pre>
          </details>
        )}
      </article>
      <div className="ai-report-grid two">
        <article>
          <strong>建议动作</strong>
          <ul className="ai-report-suggestion-list">
            {detail.suggestions.slice(0, 6).map((suggestion) => (
              <li key={suggestion.id}>
                <div className="ai-report-suggestion-title">
                  <span><b>P{suggestion.priority}</b> {suggestion.action}</span>
                  <StatusPill status={suggestion.status} />
                </div>
                <span>{suggestion.rationale}</span>
                {onSuggestionStatusChange && (
                  <div className="row-actions ai-report-suggestion-actions">
                    {suggestion.status !== "accepted" && <button className="table-btn" onClick={() => onSuggestionStatusChange(suggestion.id, "accepted")}>接受</button>}
                    {suggestion.status !== "done" && <button className="table-btn" onClick={() => onSuggestionStatusChange(suggestion.id, "done")}>完成</button>}
                    {suggestion.status !== "rejected" && <button className="table-btn" onClick={() => onSuggestionStatusChange(suggestion.id, "rejected")}>拒绝</button>}
                    {suggestion.status !== "pending" && <button className="table-btn" onClick={() => onSuggestionStatusChange(suggestion.id, "pending")}>待处理</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </article>
        <article>
          <strong>风险提醒 / 执行清单</strong>
          <ul>
            {[...riskPoints, ...checklist].slice(0, 8).map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </article>
      </div>
    </section>
  );
}


function SyncLogTableV2({ logs, compact = false }: { logs: SyncLog[]; compact?: boolean }) {
  return (
    <table className={"dense-table sync-log-table " + (compact ? "compact" : "")}>
      <thead><tr><th>类型</th><th>状态</th><th>开始时间</th><th>结束时间</th><th>范围</th><th>抓取</th><th>保存</th><th>参数</th><th>关联对象</th><th>错误</th></tr></thead>
      <tbody>
        {logs.map((log) => <tr key={log.id}>
          <td><strong>{syncTypeLabel(log.type)}</strong><small>{log.type}</small></td>
          <td><StatusPill status={log.status} /></td>
          <td>{fmtDate(log.startedAt)}</td>
          <td>{fmtDate(log.finishedAt)}</td>
          <td>{log.rangeStart || log.rangeEnd ? formatDateOnly(log.rangeStart) + " - " + formatDateOnly(log.rangeEnd) : "-"}</td>
          <td>{log.recordsFetched}</td>
          <td>{log.recordsSaved}</td>
          <td><small>{syncMetadataSummary(log.metadata)}</small></td>
          <td><small>{log.storeId ? "store:" + log.storeId : log.adAccountId ? "account:" + log.adAccountId : "-"}</small></td>
          <td className="sync-error-cell">{log.errorMessage || ""}</td>
        </tr>)}
        {logs.length === 0 && <tr><td colSpan={10}><div className="empty-state compact"><RefreshCcw size={22} /><strong>暂无同步日志</strong><span>请先等待 Worker 自动执行，或从数据页手动触发同步。</span></div></td></tr>}
      </tbody>
    </table>
  );
}

function syncTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    store_profile: "店铺资料",
    orders: "店铺订单",
    meta_ad_accounts: "Meta 账户",
    meta_insights: "Meta Insights",
    meta_creatives: "Meta 素材",
    meta_structure: "Meta 结构",
    mapping_import: "映射导入",
  };
  return labels[type] || type;
}

function formatDateOnly(value?: string): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function PageBlock({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="page-block"><div className="page-title"><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{children}</div>;
}

function Loading() {
  return <div className="loading"><Loader2 className="spin" size={18} />加载中...</div>;
}














function FloatingCopilot() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("我会基于当前系统数据给出投放建议，不会操作 Meta 广告账户。");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [context, setContext] = useState<AiCopilotPageContext>({ page: "react-dashboard" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<CopilotLaunchDetail>).detail;
      if (detail?.context) setContext(detail.context);
      if (detail?.prompt) setMessage(detail.prompt);
      setOpen(true);
    };
    window.addEventListener("open-copilot", listener);
    return () => window.removeEventListener("open-copilot", listener);
  }, []);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const result = await api<{ answer: string; conversationId: string; model: string }>("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message, conversationId, context }),
      });
      setConversationId(result.conversationId);
      setAnswer(result.answer);
      setMessage("");
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : "AI 分析失败，请检查模型设置。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button className="ai-launcher" onClick={() => setOpen(!open)}><MessageSquareText size={22} />问 AI</button>
      {open && <section className="copilot-panel">
        <header><strong>AI Media Buyer Copilot</strong><span>只读建议</span></header>
        <div className="copilot-context">{context.adAccountId ? "当前上下文：账户分析" : "当前上下文：全局后台"}</div>
        <div className="copilot-answer">{answer}</div>
        <form onSubmit={ask}><textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="问：这个账户应该怎么优化？哪个广告需要换素材？" required /><button className="primary-btn" disabled={loading}>{loading ? "分析中..." : "发送"}</button></form>
      </section>}
    </>
  );
}

function App() {
  const [checked, setChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [page, setPage] = useState<Page>("overview");

  useEffect(() => {
    api<{ authenticated: boolean }>("/api/auth/me")
      .then((result) => setAuthenticated(result.authenticated))
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    const listener = (event: Event) => {
      const targetId = (event as CustomEvent<string>).detail;
      if (targetId) sessionStorage.setItem(ACCOUNT_ANALYSIS_TARGET_KEY, targetId);
      setPage("accountAnalysis");
    };
    window.addEventListener("open-account-analysis", listener);
    return () => window.removeEventListener("open-account-analysis", listener);
  }, []);

  useEffect(() => {
    const listener = (event: Event) => {
      const nextPage = (event as CustomEvent<Page>).detail;
      if (nextPage) setPage(nextPage);
    };
    window.addEventListener("switch-page", listener);
    return () => window.removeEventListener("switch-page", listener);
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    window.location.reload();
  }

  const content = useMemo(() => {
    if (page === "stores") return <Stores />;
    if (page === "accounts") return <Accounts />;
    if (page === "mappings") return <Mappings />;
    if (page === "storeData") return <StoreData />;
    if (page === "accountData") return <AccountData />;
    if (page === "accountStructure") return <AccountAnalysis mode="structure" />;
    if (page === "accountAnalysis") return <AccountAnalysis mode="analysis" />;
    if (page === "storeAnalysis") return <StoreAnalysisV2 />;
    if (page === "countryAnalysis") return <CountryAnalysisV2 />;
    if (page === "audienceAnalysis") return <AudienceAnalysis />;
    if (page === "creativeData") return <CreativeData />;
    if (page === "productAnalysis") return <ProductAnalysis />;
    if (page === "projectBoard") return <ProjectBoard />;
    if (page === "ownerOverview") return <OwnerOverview />;
    if (page === "aiSuggestions") return <AiSuggestions />;
    if (page === "creativeCopilot") return <CreativeCopilot />;
    if (page === "aiSettings") return <AiSettings />;
    if (page === "systemSettings") return <SystemSettingsV2 />;
    if (page === "syncLogs") return <SyncLogsV2 />;
    return <Overview />;
  }, [page]);

  if (!checked) return <Loading />;
  if (!authenticated) return <Login />;
  return <Shell page={page} setPage={setPage} onLogout={logout}>{content}</Shell>;
}

createRoot(document.getElementById("root")!).render(<App />);


