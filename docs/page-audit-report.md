# Page Trust Audit Report

Task: R0-R3 full-site page trust repair.

Scope: `src/components`, with no changes to `repo/`, `repo_ref/`, `repo_reference/`, Prisma schema, Docker, compose, deploy, migrations, or database provider.

## Page Inventory

| Area | tabId / route | Component | Data Center | Diagnosis | Config | Result / Action |
| --- | --- | --- | --- | --- | --- | --- |
| Data Center | `overview` | `src/components/OverviewDashboard.tsx` | Yes | No | No | Removed amber-only decorative emphasis from product ranking. |
| Data Center | `data-accounts` | `src/components/DataDetailsDashboard.tsx` | Yes | No | No | Converted empty fact state from yellow warning box to neutral API-driven state. |
| Data Center | `data-store` | `src/components/StoreDataDashboard.tsx` | Yes | No | No | Converted empty orders, mapping badges, reconciliation states, and mismatch rows to neutral/real error state colors. |
| Data Center | `data-campaigns` | `src/components/CampaignStructureDashboard.tsx` | Yes | No | No | Structure-without-facts state is neutral; sync button already triggers `sync_meta_structure` then `sync_meta_insights`. |
| Data Center | `data-audience` | `src/components/AudienceAnalysisDashboard.tsx` | Yes | No | No | Removed static Region guidance box; `MISSING_META_BREAKDOWN` now renders neutral empty state. |
| Data Center | `data-creatives` | `src/components/CreativeIntelligenceDashboard.tsx` | Yes | No | No | Removed yellow false-health styling; no static creative diagnosis notice remains. |
| Data Center | `data-products` | `src/components/ProductIntelligenceDashboard.tsx` | Yes | No | No | Scanned; no hard keyword hit requiring code change. |
| Data Center | `data-countries` | `src/components/CountryAnalyticsDashboard.tsx` | Yes | No | No | Deleted fixed country governance yellow explanation; order-country unavailable notice remains dynamic and neutral. |
| AI Workbench | `ai-analysis` | `src/components/AIAnalysisCenter.tsx` | No | Yes | No | Converted dynamic data-health notice cards and medium priority badge to neutral state styling. |
| Diagnosis | `diag-overview` | `src/components/diagnosis/DiagnosisOverviewPage.tsx` | No | Yes | No | Uses global date range, compact AI payload max 10 issues, no data-health/debug card display. |
| Diagnosis | `diag-ad` | `src/components/diagnosis/AdPerformanceDiagnosisPage.tsx` | No | Yes | No | Uses global date range and `actionableIssues`; no internal date picker, HEALTHY, debug, or data-health display. |
| Diagnosis | `diag-funnel` | `src/components/diagnosis/FunnelDiagnosisPage.tsx` | No | Yes | No | Uses global date range; removed static yellow explanation/date controls. |
| Diagnosis | `diag-store` | `src/components/diagnosis/StoreDiagnosisPage.tsx` | No | Yes | No | Uses global date range; removed static yellow explanation/date controls. |
| Diagnosis | `diag-creative` | `src/components/diagnosis/CreativeFatigueDiagnosisPage.tsx` | No | Yes | No | Uses global date range; yellow stats removed. |
| Diagnosis | `diag-product` | `src/components/diagnosis/ProductDiagnosisPage.tsx` | No | Yes | No | Uses global date range; static information box removed. |
| Diagnosis | `diag-health` | `src/components/diagnosis/DataHealthDiagnosisPage.tsx` | No | Yes | No | Dedicated `data_health_notice` page only; global date range; no debug issues. |
| Diagnosis Hook | shared hook | `src/components/diagnosis/useDiagnosticsIssues.ts` | No | Yes | No | Defaults: `includeDebug=false`, `includeHealthy=false`, `categories=["production_suggestion"]`; Data Health page opts in to `data_health_notice`. |
| Suggestions | `sugg-cards` | `src/components/SuggestionsDashboard.tsx` | No | Yes | No | Dynamic offline-rule indicator no longer yellow; priority styling no longer creates amber page blocks. |
| Prescription | `rx-pending/rx-health/rx-accepted` | `src/components/prescription/PrescriptionCenterPage.tsx` | No | Yes | No | Uses global date range; debug tab removed from visible filters; static yellow notice removed. |
| Prescription | `rx-review` | `src/components/prescription/PrescriptionReviewPage.tsx` | No | Yes | No | Uses global date range; static backtest explanation banner removed. |
| Config | `meta-config` | `src/components/MetaConfigPage.tsx` | No | No | Yes | Dynamic token/permission/account states retained; token remains masked. |
| Config | `ai-config` | `src/components/AiConfigPage.tsx` | No | No | Yes | Removed fixed security advisory yellow box; provider safety note now neutral. |
| Config | `team-config` | `src/components/TeamConfigPage.tsx` | No | No | Yes | Dynamic edited-owner highlight retained. |
| Config | `sync-center` | `src/components/SyncCenterPage.tsx` | No | No | Yes | Dynamic `partial_data` sync status retained. |
| Config | `stores` | `src/components/StoresDashboard.tsx` | No | No | Yes | Dynamic API binding and timezone warning states retained. |
| Route Shell | root tabs | `src/components/Dashboard.tsx` | No | No | No | Global `startDate` / `endDate` passed into diagnosis and prescription pages. |
| App Shell | root | `src/App.tsx` | No | No | No | Scanned; no change required. |

## Required Grep Scan Results

Commands were run with Git for Windows grep:

```text
grep -R "bg-amber" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "bg-yellow" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "border-amber" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "border-yellow" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "text-amber" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "text-yellow" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "当前页面仅展示真实诊断结果" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "数据健康度：健康" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "素材洞察诊断状态" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "HEALTHY" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "includeDebug: true" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "type=\"date\"" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "HTTP error 413" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "同步刷新看板" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "刷新 Meta 数据" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "同步广告结构与成效" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
grep -R "bg-amber\|bg-yellow\|border-amber\|border-yellow" src/components --exclude-dir=repo --exclude-dir=repo_ref --exclude-dir=repo_reference
```

Hard keyword results:

| Pattern | Result |
| --- | --- |
| `bg-yellow` | `<NO_MATCH>` |
| `border-yellow` | `<NO_MATCH>` |
| `text-yellow` | `<NO_MATCH>` |
| `当前页面仅展示真实诊断结果` | `<NO_MATCH>` |
| `数据健康度：健康` | `<NO_MATCH>` |
| `素材洞察诊断状态` | `<NO_MATCH>` |
| `HEALTHY` | `<NO_MATCH>` |
| `includeDebug: true` | `<NO_MATCH>` |
| `type="date"` | `<NO_MATCH>` |
| `HTTP error 413` | `<NO_MATCH>` |
| `同步刷新看板` | `<NO_MATCH>` |
| `刷新 Meta 数据` | `<NO_MATCH>` |
| `同步广告结构与成效` | `<NO_MATCH>` |

Remaining amber scan hits are limited to config or operational state components:

| File | Reason | Real state dependency |
| --- | --- | --- |
| `src/components/MetaConfigPage.tsx` | Token already configured input, missing token permissions, no API accounts after token test, local fallback account notice. | `isEditingToken`, `testResult.hasAdsRead`, `testResult.hasBusinessManagement`, `testResult.apiAccessStatus`, `accounts.length`, `accounts.some(a => a.isFallbackDbCopy)`. |
| `src/components/StoresDashboard.tsx` | Store API credential not connected and timezone diagnostics warnings. | `apiBound`, `store.timezoneDiagnostics.warnings.length`. |
| `src/components/SyncCenterPage.tsx` | Partial sync state badge. | `status === "partial_data"`. |
| `src/components/TeamConfigPage.tsx` | Edited owner mapping differs from persisted owner. | `editedMappings[item.accountId] !== undefined && editedMappings[item.accountId] !== item.owner`. |

No data center, diagnosis, suggestions, prescription, overview, or AI workbench page has remaining `bg-amber`, `bg-yellow`, `border-amber`, or `border-yellow` page-display logic.

## AI 413 Risk

`DiagnosisOverviewPage` no longer sends full `issues` to `/api/ai/explain-dashboard`.

The AI summary payload sends at most 10 `compactIssues` and excludes heavy fields such as `evidence`, `entityRefs`, `limitations`, `validationMetrics`, and raw issue objects. The AI summary button is disabled when there is no actionable production suggestion.

## Diagnosis Contract

`Dashboard.tsx` passes global `startDate` and `endDate` into diagnosis and prescription pages.

`useDiagnosticsIssues.ts` defaults:

```text
includeDebug=false
includeHealthy=false
categories=["production_suggestion"]
```

`DataHealthDiagnosisPage` is the only diagnosis page that opts into:

```text
categories=["data_health_notice"]
includeDebug=false
includeHealthy=false
```

## Data Center Empty State Contract

| Page | Empty / degraded state behavior |
| --- | --- |
| Campaign Structure | `EMPTY_STRUCTURE` and `STRUCTURE_WITHOUT_FACTS` are displayed as neutral status states; sync button triggers structure and insights tasks. |
| Audience Analysis | `MISSING_META_BREAKDOWN` shows neutral no-breakdown state; Meta audience country and order shipping/billing country remain separated. |
| Creative Intelligence | Missing creative facts or structure-without-facts is neutral and not labeled healthy. |
| Data Details | No current-period `FactMetaPerformance` renders a neutral empty fact state. |
| Store Data | No current-period orders renders a neutral empty orders state; reconciliation differences remain data-driven. |
| Country Analytics | Static governance banner removed; dynamic order-country unavailable state remains tied to `data.dataHealth.orderCountryAvailable`. |
| Product Intelligence | Scanned without hard keyword hits; no code change required. |

## Verification

`npm run lint` passed through `cmd /c npm run lint`.

`npm run build` passed through `cmd /c npm run build`.

## R4 Final Cleanup

`AdPerformanceDiagnosisPage` now deduplicates by `issueId` before display. The page still filters to actionable production suggestions only, so it does not display `HEALTHY`, `data_health_notice`, or `debug_invalid` as ad performance recommendations.

Deduped grouping priority:

1. `delivery`
2. `creative`
3. `outcome`
4. `budget/audience`

Final R4 grep results:

| Pattern | Result |
| --- | --- |
| `当前页面仅展示真实诊断结果` | `<NO_MATCH>` |
| `数据健康度：健康` | `<NO_MATCH>` |
| `素材洞察诊断状态` | `<NO_MATCH>` |
| `HEALTHY` | `<NO_MATCH>` |
| `includeDebug: true` | `<NO_MATCH>` |
| `HTTP error 413` | `<NO_MATCH>` |
| `同步刷新看板` | `<NO_MATCH>` |
| `刷新 Meta 数据` | `<NO_MATCH>` |
| `同步广告结构与成效` | `<NO_MATCH>` |

Remaining `bg-amber` / `border-amber` hits are still limited to dynamic config or operational states:

| File | Reason |
| --- | --- |
| `src/components/MetaConfigPage.tsx` | Token configured read-only state, real permission warning, no-account result, or local fallback account notice. |
| `src/components/StoresDashboard.tsx` | Store API not connected or timezone diagnostics warnings. |
| `src/components/SyncCenterPage.tsx` | `partial_data` sync status badge. |
| `src/components/TeamConfigPage.tsx` | Owner edit differs from persisted value. |

Verification:

| Command | Result |
| --- | --- |
| `cmd /c npm run lint` | Passed |
| `cmd /c npm run build` | Passed |

This commit is ready for server-side full verification, not final production sign-off.

## R5-UX-SCOPE-SYNC-CF Clean UI and Data Scope

### Cause

R5 unified verification showed that the date filters were mostly usable, but data-center pages still had noisy always-on explanation panels, unclear metric scopes, and sync buttons that treated RUNNING or NO_NEW_DATA as user-facing failures.

### Scope Fixed

- Reduced `DataViewTraceBar` to a compact one-line scope label by default; the full trace only renders with `debug={true}`.
- Kept the account data page focused on the data health alert and added filtered account metric totals.
- Split audience metrics into Meta audience facts and store-order facts so Meta purchases are not presented as store orders.
- Filtered country analytics to countries with real order or Meta activity instead of returning a padded country list.
- Clarified creative KPIs as creative Meta performance metrics.
- Clarified store and product KPIs as store/product order metrics.
- Normalized RUNNING, NO_NEW_DATA, and PARTIAL_SUCCESS sync results so they no longer appear as failed syncs.
- Added `dataScope` metadata to data-center responses used by detail, audience, countries, products, stores, accounts performance, hierarchy, and creative views.

### Verification Criteria

- Normal data-center pages should not show large debug/source/trace panels.
- The account data page now has account totals based on the currently filtered account list.
- Audience pages expose separate Meta and store summaries.
- Country rows only include countries with data in the selected range.
- Ad hierarchy, audience, and creative sync buttons use view-level sync tasks and treat RUNNING / NO_NEW_DATA as neutral states.
- Product sync behavior remains on the existing `sync_view_products` path.

## R5-ROOT-FIX-CF Date State Completion

### 修复原因

9f23984 已实现 requestKey preserve 和 view sync，但 catch / empty response 分支仍存在直接复用 lastGoodData 的漏口，广告层级同步 UI 仍伪造旧三步状态。

### 修复范围

- data-view-state 新增 getSafeLastGoodData / canUseLastGoodData。
- 所有数据中心页面 catch / empty / mismatch 分支 requestKey 守护。
- 广告层级同步前端移除 structureResult / insightsResult 伪造状态。
- 全站数据中心同步按钮只调用 sync_view_xxx；SyncCenterPage 作为同步工具页保留底层任务入口。

### 验收

- grep set.*lastGoodData 无直接回填。
- grep sync_meta_structure / sync_meta_insights 在数据中心业务页面无直接调用。
- npm run lint PASS。
- npm run build PASS。

## R5-ROOT-FIX Date State and Atomic Sync

- Added request-key guarded last-good-data preservation through `buildDataViewRequestKey`, `makeLastGoodData`, and the four-argument `shouldPreserveLastGoodData`.
- Updated data center pages so old successful rows are preserved only for the same page/date/filter request key.
- Replaced frontend data-center sync buttons with view-level atomic tasks: `sync_view_ad_hierarchy`, `sync_view_audience`, `sync_view_creatives`, and `sync_view_account_data`.
- Added server-side view sync task types that execute the required structure/fact/ledger chain under one chainId.
- Removed GET-triggered data-center freshness refresh calls from data-center read APIs.
- Hardened Meta structure sync parent creation so missing Campaign / AdSet parents are skeleton-upserted before child rows, while malformed ads without `adset_id` are skipped and counted.

## R5-ROOT-FIX Data Scope Trace

- `dataHealth.queryDebug` now exposes `source`, `scope`, `includeUnmapped`, `includeZeroSpend`, `mappedOnly`, `storeId`, `accountId`, `factRows`, and `structureRows` for the main data-center APIs.
- `DataViewTraceBar` displays the current data scope, whether unmapped accounts are included, and whether zero-spend objects are included.
- Data center pages now show scope metadata alongside row/fact/structure counts so same-date metric differences can be traced to source and filter scope rather than guessed.

## R5-UIE-V2 Unified Frontend Experience Pass

### Modified Files And Scope

| File | Change |
| --- | --- |
| `src/components/common/DataViewTraceBar.tsx` | Added a shared trace strip for current filter range, API response range, timezone, row counts, fact rows, structure rows, level, status, and source. |
| `src/components/CampaignStructureDashboard.tsx` | Added the trace strip, preserved last good rows on range mismatch, kept hierarchy sync progress visible, removed raw technical source labels from the default UI, and kept AI context dispatch. |
| `src/components/AudienceAnalysisDashboard.tsx` | Added the trace strip, clarified missing audience breakdown states, kept low-sample notices dynamic, and replaced default technical source wording with business-readable labels. |
| `src/components/CountryAnalyticsDashboard.tsx` | Added the trace strip, clarified country low-sample / missing-source states, and changed default source labels to business wording. |
| `src/components/DataDetailsDashboard.tsx` | Added the trace strip above account performance tables and fixed the default source label to business wording while keeping raw IDs for requests. |
| `src/components/ProductIntelligenceDashboard.tsx` | Added the trace strip, retained current-range guarding, and replaced technical attribution wording with business labels. |
| `src/components/StoreDataDashboard.tsx` | Added the trace strip for store/order rows and preserved refresh as read-only page data reload. |
| `src/components/CreativeIntelligenceDashboard.tsx` | Converted the creative page into an operations workspace with ops buckets, account names, default opsScore sorting, detail drawer context, and “问 AI 分析该素材”. |
| `src/server/services/creative-insights.service.ts` | Added accountName/accountNames/fb_account_name and opsBucket/opsScore/recommendedAction/diagnosisReason to creative rows; exposed performance/structure row counts in diagnostics. |
| `src/components/AICopilotWindow.tsx` | Added the `open-ai-context` listener, active context card, prompt prefill, message state, and neutral send behavior when no general copilot backend is attached. |
| `src/components/diagnosis/DiagnosticIssueCard.tsx` | Added “查看证据” and “问 AI”; default card UI no longer exposes raw issue IDs, while expanded evidence/debug still remains available. |
| `src/lib/business-labels.ts` | Completed severity/entity/funnel labels and changed fallback labels away from raw underscore keys. |
| `src/lib/sync-trigger.ts` | Normalized sync result/error mapping for SUCCESS, NO_NEW_DATA, PARTIAL, RUNNING, and FAILED; RUNNING now maps to visible progress instead of failure. |
| `src/server/routes/sync.routes.ts` | Added shared `buildProgress` response fields for sync task responses and 409 running-task responses. |
| `src/server/routes/data-center.routes.ts` | Added `dataHealth` to account performance and enriched creative data health with factRows/structureRows/dateRange. |

### Sync Progress Contract

`SyncStatusPanel`, `sync-trigger.ts`, and `sync.routes.ts` now share these fields:

- `progressPercent`
- `currentStep / totalSteps`
- `processedAccounts / totalAccounts`
- `processedDimensions / totalDimensions`
- `runningTask`
- `chainId`
- `taskIds`
- `recordsFetched / recordsSaved / recordsUpdated`
- `failedAccounts`

RUNNING / 409 responses are mapped to a visible running panel with 15% fallback progress, not an error state.

### DataViewTraceBar Coverage

Covered pages:

- Campaign structure
- Audience analysis
- Creative intelligence
- Product intelligence
- Country analytics
- Account data details
- Store data dashboard

The trace bar exposes current range and response range side by side, which makes date filter mismatches visible instead of silently showing old rows.

### Creative Workspace

The creative page now has:

- accountName / clean account display
- opsBucket tabs
- opsScore-first sorting
- recommended action and diagnosis reason
- detail drawer with operations summary
- “问 AI 分析该素材” dispatching `open-ai-context`

The old “生成离线规则诊断” primary-action wording is removed.

### AI Copilot And Diagnosis

- `AICopilotWindow` listens for `open-ai-context` and opens with a context card plus prefilled prompt.
- Creative, campaign structure, and diagnosis cards dispatch `open-ai-context`.
- Diagnosis pages route business issues through `DiagnosticIssueCard`.
- `DiagnosticIssueCard` exposes evidence on demand and adds “问 AI”.
- `business-labels.ts` centralizes Chinese labels for problem stage, optimization area, funnel stage, severity, and entity type.

### Grep Cleanup Summary

Fixed / removed from default UI:

- `未命名 Meta 账号`
- `生成离线规则诊断`
- `{iss.issueId}` default display
- `ACC_ACT`, `acc_act`, `STORE_1`, `store_1`
- `FactMetaPerformance`, `Strict Attribution Barrier`, `Deterministic Trace` in frontend component UI

Retained as debug or backend contract only:

- API/source fields such as `dataSourceExplain`, `primarySource`, and source table names may remain in server responses and explicit evidence/debug drawers.
- `issueId` remains as React keys or expanded debug context, not default visible card text.

### Verification

| Command | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run build` | PASS |

Hard grep highlights:

- `progressPercent` appears in `SyncStatusPanel`, `sync-trigger.ts`, and `sync.routes.ts`.
- `DataViewTraceBar` appears across the required data center pages.
- `open-ai-context` appears in trigger components and `AICopilotWindow`.
- Removed-string grep returned no frontend component matches for the prohibited default UI patterns.

## R5-CF Code Fix

### PayloadTooLargeError

- `src/server.ts` now registers `express.json({ limit: "2mb" })`.
- `express.urlencoded` also uses the same `2mb` limit.
- This only prevents pre-route raw body rejection; AI payloads remain compact and should not send full raw objects.

### Audience Sync Closure

- `sync_meta_audience` now treats a successful Meta API response with zero audience rows as `NO_NEW_DATA`, not `FAILED`.
- `syncMetaAudience` now includes unmapped active accounts by default so unbound spend accounts can still feed audience/country facts.
- `META_AUDIENCE_SYNC_FAILED` no longer emits an empty message; hard failures include failed account details or a fallback reason/message.
- Audience sync metadata includes status, reason, message, requested dimensions, synced dimensions, failed accounts, and target account count.
- `AudienceAnalysisDashboard` renders READY / NO_NEW_DATA / FAILED / RUNNING as one dynamic state block and preserves previous good rows when the current cycle is not ready.

### Running Task Classification

- `SYNC_TASK_ALREADY_RUNNING` is returned as HTTP 409 with `status: "RUNNING"` and `error: "SYNC_ALREADY_RUNNING"`.
- `sync_meta_creatives` checks dependent `sync_meta_structure` and `sync_meta_insights` running locks before launching.
- Stale running tasks older than 30 minutes are marked failed with `STALE_RUNNING_TASK_TIMEOUT` before a new task proceeds.
- `SyncStatusPanel` can display chain id, running task type, task id, and startedAt.

### Date Contract

- Business shortcuts now use Los Angeles dates and include LA today for today, past 7/14/30 days, this week, and this month.
- Data Center responses echo `appliedFilters` and `dateRange` with `timezone: "America/Los_Angeles"`.
- Campaign structure, audience, creative, product, and country pages verify response date ranges before replacing current view data.

### Refresh Safety

- Added `src/lib/data-view-state.ts` for shared date-range matching and last-good-data preservation.
- Campaign structure, audience, creative, product, and country pages keep `lastGoodData`.
- Empty responses with `SYNC_RUNNING`, `NO_NEW_DATA`, `STRUCTURE_WITHOUT_FACTS`, `MISSING_META_BREAKDOWN`, `META_BREAKDOWN_NOT_READY`, `EMPTY_FACTS`, `EMPTY`, or `EMPTY_STRUCTURE` do not overwrite existing good data.
- Legacy refresh catch paths in account, monitoring, and dashboard views no longer clear data with `setData([])`.

### Notice Cleanup

- Normal populated views do not show permanent explanatory status boxes.
- No-data or degraded states render at most one dynamic status notice per target page.
- The obsolete hidden audience notice block was removed.

### Diagnostic Readability

- Added `src/lib/business-labels.ts` for Chinese labels.
- Diagnosis overview and issue cards show Chinese business labels by default.
- Raw technical keys and `issueId` stay out of default diagnosis cards; `issueId` is only shown in expanded debug details.
- Data health diagnosis no longer displays `issueId` as a default badge.
- Funnel diagnosis section titles no longer include raw enum keys such as `product_page_intent` or `checkout_payment`.

### AI Context Entry

- `CampaignStructureDashboard` information action now dispatches `open-ai-context` with level, account, campaign/adset/ad ids, key metrics, and current date range.
- Clipboard copy remains as a fallback.
- R5 backlog: verify the global AI drawer listener consumes `open-ai-context` in VPS/browser smoke testing.

### R5-CF Grep Results

| Pattern | Result |
| --- | --- |
| `express.json` | `express.json({ limit: "2mb" })` found |
| `META_AUDIENCE_SYNC_FAILED:` | Found only with non-empty `failureDetail` fallback |
| `includeUnmapped: false` in `sync-center.service.ts` | `<NO_MATCH>` |
| `NO_AUDIENCE_BREAKDOWN_ROWS_FROM_META_API` | Found in audience sync service |
| `SYNC_TASK_ALREADY_RUNNING` | Found in running-lock detection |
| `STALE_RUNNING_TASK_TIMEOUT` | Found in stale task handling |
| `setData([]) / setProducts([]) / setCreatives([])` | `<NO_MATCH>` |
| `数据源健康缺失提醒` | `<NO_MATCH>` |
| `{iss.issueId}` in diagnosis pages | `<NO_MATCH>` |
| `ACC_ACT / acc_act / STORE_1 / store_1` in diagnosis pages | `<NO_MATCH>` |
| `open-ai-context` | Found in `CampaignStructureDashboard.tsx` |

### R5-CF Verification

| Command | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run build` | Passed |

This is a local repository implementation and build verification record. It is not a substitute for VPS real-data smoke testing.

## R5-CF2 Visible Frontend Fix

### Ad Hierarchy Date Linkage

- Modified `src/components/CampaignStructureDashboard.tsx`.
- Account level continues to read `/api/data-center/ad-hierarchy/accounts`.
- Campaign, AdSet, and Ad levels now read `/api/data-center/ad-hierarchy/campaigns`, `/api/data-center/ad-hierarchy/adsets`, and `/api/data-center/ad-hierarchy/ads` instead of the broad structure endpoint.
- Requests include `startDate`, `endDate`, `includeZeroSpend`, account/campaign/adset ids, and a visible `_requestKey`.
- The page shows a status strip with current selected range, API returned range, row count, fact rows, structure rows, health status, and hierarchy level.
- Date switches do not reuse old `lastGoodData` for a new date key unless the API returns a mismatched date range.

API verification commands for VPS:

```text
curl -s "http://127.0.0.1:3000/api/data-center/ad-hierarchy/accounts?startDate=2026-07-07&endDate=2026-07-07&includeZeroSpend=true" | head -c 2000
curl -s "http://127.0.0.1:3000/api/data-center/ad-hierarchy/accounts?startDate=2026-07-01&endDate=2026-07-07&includeZeroSpend=true" | head -c 2000
```

Both responses should show different `dateRange` values and visible `dataHealth.factRows`.

### Sync Progress Percent

- Modified `src/components/common/SyncStatusPanel.tsx`.
- Modified `src/lib/sync-trigger.ts`.
- Modified `src/server/routes/sync.routes.ts`.
- `SyncPanelStatus` now supports `progressPercent`, `currentStep`, `totalSteps`, `stepLabel`, account progress, dimension progress, `startedAt`, and `finishedAt`.
- The panel renders a visible progress bar, step count, account progress, dimension progress, `chainId`, `runningTask`, task ids, and fetched/saved/updated counters.
- Sync responses now include task-level progress for `sync_meta_accounts`, `sync_meta_structure`, `sync_meta_insights`, `sync_meta_audience`, `sync_meta_creatives`, store order sync, and ledger refresh tasks.
- RUNNING conflicts return `progressPercent: 15`, `stepLabel: "已有同步任务正在运行"`, and `runningTask`.

### Creative Account Names

- Modified `src/server/services/creative-insights.service.ts`.
- Modified `src/components/CreativeIntelligenceDashboard.tsx`.
- Creative aggregation now returns `accountName`, `accountNames`, and `fb_account_name` from `AdAccount.fb_account_name`.
- Creative tables and the detail drawer pass `name` into `MetaAccountDisplay`.
- If the account id exists but no name is stored, the page shows `账户名称未同步` instead of `未命名 Meta 账号`.

API verification command for VPS:

```text
curl -s "http://127.0.0.1:3000/api/data-center/creative-insights?startDate=2026-07-01&endDate=2026-07-07&pageSize=5&includeZeroSpend=true" | head -c 3000
```

The response should include `accountId` plus `accountName` or `fb_account_name`.

### Audience And Country Status

- Modified `src/components/AudienceAnalysisDashboard.tsx`.
- Modified `src/components/CountryAnalyticsDashboard.tsx`.
- Modified `/api/data-center/audience` in `src/server/routes/data-center.routes.ts`.
- Audience requests include selected account and dimension type.
- Audience API `dataHealth` now includes `factRows` and `dateRange`.
- Audience page shows current selected range, returned range, current dimension, row count, health status, and fact rows.
- RUNNING audience sync is shown as waiting/running, not as a failed sync.
- NO_NEW_DATA remains neutral.
- If country samples are too small, the page shows one neutral sample-size notice.
- Country page shows the same visible date/range/row/status strip.

### Product Visible Range State

- Modified `src/server/routes/data-center.routes.ts`.
- Modified `src/components/ProductIntelligenceDashboard.tsx`.
- `/api/data-center/products` now includes a `dataHealth` block with status, fact rows, date range, and source.
- Product page shows current selected range, returned range, row count, and health status.

### AI Entry

- `CampaignStructureDashboard` already dispatches `open-ai-context`.
- `CreativeIntelligenceDashboard` now dispatches `open-ai-context` from the primary row action `问 AI 分析该素材`.
- The creative prompt includes account, campaign, adset, ad, spend, impressions, purchases, ROAS, CTR, CPC, CPM, frequency, and current date range.
- Clipboard copy remains as fallback.

### R5-CF2 Verification

| Command | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run build` | Passed |

This is a GitHub code-layer fix. VPS still needs pull, build, restart, and screenshot/curl verification.

## R5 Data Trust Recovery

### Runtime Error Fix

- `isDemoDataEnabled` is now defined in `src/server/routes/data-center.routes.ts`.
- `/api/data-center/detail` no longer depends on an undefined runtime helper.
- Routine `dataSourceExplain` fields no longer present legacy/fallback as a normal trusted source; legacy fallback flags are only exposed under `debug` outside production.

### Meta Sync Chain

| Page | Sync chain |
| --- | --- |
| `DataDetailsDashboard` | `sync_meta_accounts -> sync_meta_insights -> refresh_meta_datacenter_ledger -> loadData` |
| `CampaignStructureDashboard` | `sync_meta_accounts -> sync_meta_structure -> sync_meta_insights -> fetchData` |
| `AudienceAnalysisDashboard` | `sync_meta_audience -> fetchAudienceInsights` |
| `CreativeIntelligenceDashboard` | `sync_meta_creatives -> fetchCreatives` |

### Safe Fact Write

- `meta-realtime-sync.service.ts` no longer calls `cleanMetaAccountFactsForRange` before fetching fresh Meta API rows.
- Empty Meta API responses are recorded as `NO_NEW_DATA_FROM_META_API` in `failedAccounts` and do not delete existing facts.
- `cleanMetaAccountFactsForRange` remains documented as a dangerous maintenance helper and is not part of the realtime fetch-before-write path.

### Refresh Is Readonly

- Data Center page refresh flows call local read APIs only.
- `GET /api/data-center/stores/:storeId/reconciliation` no longer triggers store sync or ledger refresh.
- Frontend code no longer calls legacy sync endpoints such as `/sync/rebuild`, `/sync/data-center/refresh*`, `/sync/meta-realtime`, or `/sync/meta-audience-breakdown`.

### Sync Observability

- Added `SyncStatusPanel` for account, hierarchy, audience, and creative pages.
- Sync receipts show `chainId`, `taskIds`, fetched/saved/updated counts, target account count, and failed account details when present.
- `/api/sync/trigger` returns richer receipts for Meta accounts, structure, insights, creatives, audience, and ledger refresh tasks, including 409 `SYNC_ALREADY_RUNNING` details.

### Notices

- Audience and creative pages keep normal data views free of persistent explanatory boxes.
- Empty or unhealthy states render a single dynamic status notice only when the current result set is empty and health status is not `READY`/`OK`.
- Failed read refreshes preserve the last good local dataset instead of clearing the page to zero.

### Diagnostic Usability

- Added `DiagnosticIssueCard` and wired it into diagnosis overview and business diagnosis pages.
- Default diagnosis cards no longer show raw `issueId`.
- Account objects render account name plus cleaned numeric Meta account id; store objects render store name plus store id.
- `unmapped_spend_account` now belongs to `data_health_notice` with mapping/data-health metadata and is filtered out of business recommendation pages by default.

### AI Summary

- When AI safety/explain assistance is disabled, `AiDashboardSummaryCard` shows a neutral disabled state.
- AI summary failure does not block rule-based diagnosis results.

### Hard Grep Results

| Pattern | Result |
| --- | --- |
| `isDemoDataEnabled` in `data-center.routes.ts` | Found definition and usage |
| `cleanMetaAccountFactsForRange` in `meta-realtime-sync.service.ts` | `<NO_MATCH>` |
| `issue: item` in `src/components` | `<NO_MATCH>` |
| `{iss.issueId}` in `src/components/diagnosis` | `<NO_MATCH>` |
| `ACC_ACT/acc_act/STORE_1/store_1` in `src/components/diagnosis` | `<NO_MATCH>` |
| `活动账户未关联任何独立站店铺` | Backend data-health rule only |
| `数据源健康缺失提醒` in `src/components` | `<NO_MATCH>` |
| legacy frontend sync endpoints | `<NO_MATCH>` |

### Verification

| Command | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run build` | Passed |

This is a local repository implementation and build verification record. It is not a substitute for VPS real-data smoke testing.

## R4-B Account Display Format

Added `src/components/common/MetaAccountDisplay.tsx`.

Unified display contract:

```text
line 1: account name, or 未命名 Meta 账号
line 2: account id without act_ prefix
```

The display helpers do not mutate source values. Copy targets, navigation, query params, API payloads, sync tasks, and backend storage continue using the original `accountId` / `fb_account_id`.

Search helper:

```text
metaAccountSearchText(name, accountId)
```

It indexes account name, original ID, clean numeric ID, and `act_` ID form, so search supports account name, numeric ID, and `act_` ID even when the stored value uses only one form.

Completed pages:

| Page | Component / helper use |
| --- | --- |
| Account data table | `src/components/DataDetailsDashboard.tsx` uses `MetaAccountDisplay`; hierarchy navigation still uses raw `row.fb_account_id`. |
| Ad hierarchy account level | `src/components/CampaignStructureDashboard.tsx` merges account name and ID into one account column; drill-down and sync payloads still use raw `row.fb_account_id` / `selectedAccount`. |
| Audience account filter | `src/components/AudienceAnalysisDashboard.tsx` uses `metaAccountOptionLabel`; select value remains raw `fb_account_id`. |
| Creative account filter and tables | `src/components/CreativeIntelligenceDashboard.tsx` uses clean account display; filter value and hierarchy navigation still use original account ID rules. |
| AI analysis center | `src/components/AIAnalysisCenter.tsx` uses unified account display in cards and account select labels; manual analysis payload still uses selected raw account ID. |
| Meta config account list | `src/components/MetaConfigPage.tsx` merges account ID and name columns into one account display column. |
| Team mapping | `src/components/TeamConfigPage.tsx` merges account name and ID into one account display column. |
| Store details mapping | `src/components/StoreDetailsPage.tsx` uses unified account display in add mapping and bound mapping lists. |
| Account details account switcher | `src/components/AccountDetailsPage.tsx` uses unified display in current account trigger and account list. |
| Monitoring account table | `src/components/MonitoringDashboard.tsx` merges account name and ID into one account display column. |
| Store data unmapped spend table | `src/components/StoreDataDashboard.tsx` uses unified account display for unmapped spend accounts. |

R5 backlog:

| Area | Reason |
| --- | --- |
| Diagnosis issue cards | Current diagnosis pages do not directly render account entity ID/name pairs after R4 cleanup; if future account-level issue cards are reintroduced, they should use `MetaAccountDisplay`. |
| Country analytics account-count drilldown | Current UI shows account counts, not account identities; if account IDs are expanded later, use `MetaAccountDisplay`. |

## R4 Final Verification

### R4-C Data Center Empty State Review

| Page | Status | Notes |
| --- | --- | --- |
| DataDetailsDashboard | PASS | 当前日期范围无 FactMetaPerformance 时显示真实空状态；刷新页面数据只调用 `loadData`，同步数据才触发同步入口。 |
| StoreDataDashboard | PASS | 当前日期范围无订单时显示真实空状态；未绑定账户消耗仅作为数据健康提醒。 |
| CampaignStructureDashboard | UPDATED | 区分结构缺失、成效缺失、筛选隐藏；同步按钮仍触发 `sync_meta_structure` + `sync_meta_insights`。 |
| AudienceAnalysisDashboard | UPDATED | Meta 受众国家与订单国家分离；`MISSING_META_BREAKDOWN` 显示真实缺失状态。 |
| CreativeIntelligenceDashboard | PASS | 无素材表现 / 结构有成效无状态清晰，未显示假健康。 |
| ProductIntelligenceDashboard | UPDATED | 当前周期无订单不冒充旧周期产品数据。 |
| CountryAnalyticsDashboard | UPDATED | 国家维度空状态清晰，来源区分。 |

### R4-D AI Payload Boundary

- `DiagnosisOverviewPage` explain-dashboard uses compact issues.
- `PrescriptionCenterPage` explain-issue uses `compactIssueForAi`.
- `PrescriptionReviewPage` explain-review uses `compactIssueForAi`.
- `AiExplainButton` and `AiExplanationPanel` were inspected; they only render UI / response state and do not send full issue payloads.
- No AI request should send full `issue` objects.
- No AI request should send `evidence`, `entityRefs`, `limitations`, or `validationMetrics`.

Search results:

| Pattern | Result |
| --- | --- |
| `/api/ai/explain-issue` | Checked |
| `/api/ai/explain-dashboard` | Checked |
| `/api/ai/explain-review` | Checked and compacted |
| `issue: item` | `<NO_MATCH>` |
| `issue: matchedIssue` | `<NO_MATCH>` |
| `evidence` in AI request payload | `<NO_MATCH>` |
| `entityRefs` in AI request payload | `<NO_MATCH>` |
| `validationMetrics` in AI request payload | `<NO_MATCH>` |

### R4-B Regression Check

- `MetaAccountDisplay` retained.
- Account display remains:
  - line 1: account name
  - line 2: account id without `act_`
- Search supports account name, numeric id, and `act_` id.
- Navigation, sync payloads, query params, and backend storage continue using original account id.

### Final Grep Results

| Pattern | Result |
| --- | --- |
| `当前页面仅展示真实诊断结果` | `<NO_MATCH>` |
| `数据健康度：健康` | `<NO_MATCH>` |
| `素材洞察诊断状态` | `<NO_MATCH>` |
| `HEALTHY` | `<NO_MATCH>` |
| `includeDebug: true` | `<NO_MATCH>` |
| `HTTP error 413` | `<NO_MATCH>` |
| `issue: item` | `<NO_MATCH>` |
| `同步刷新看板` | `<NO_MATCH>` |
| `刷新 Meta 数据` | `<NO_MATCH>` |
| `同步广告结构与成效` | `<NO_MATCH>` |

Remaining amber/yellow classes:
Only dynamic config or operational states remain:

| File | Reason |
| --- | --- |
| `src/components/MetaConfigPage.tsx` | Token configured read-only state, real permission warning, no-account result, or local fallback account notice. |
| `src/components/StoresDashboard.tsx` | Store API not connected or timezone diagnostics warnings. |
| `src/components/SyncCenterPage.tsx` | `partial_data` sync status badge. |
| `src/components/TeamConfigPage.tsx` | Owner edit differs from persisted value. |

### Verification

| Command | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run build` | Passed |

This commit is ready for server-side full verification, not final production sign-off.
