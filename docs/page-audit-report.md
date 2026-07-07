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
