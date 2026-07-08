# R5-RCA 日期筛选与同步链路根因审计

基准 commit: `b33bdc2cad440386db1a5f571d65d9d1f1c68212`

本报告只做根因审计，不修业务逻辑、不改 schema、不写业务数据。新增脚本均为只读脚本：

- `scripts/audit/r5-rca-api-date-matrix.mjs`
- `scripts/audit/r5-rca-db-fact-matrix.mjs`
- `scripts/audit/r5-rca-sync-locks.mjs`

## 1. 审计结论摘要

| 判断项 | 结论 | 证据 |
|---|---|---|
| 日期筛选是否前端按钮问题 | 不是第一根因。DateFilter 会按业务时区生成明确 start/end。 | `src/shared/business-time.ts` 的 `getBusinessDateRange()` 对 today/yesterday/past_7/past_14/past_30 都生成不同范围；`src/components/DateFilter.tsx` 点击快捷项后把 range 写入父级 state。 |
| 是否 API 接参问题 | 不是第一根因。数据中心主要 GET API 都调用统一 `getAppliedDateRange(req.query)`。 | `src/server/routes/data-center.routes.ts` 中 `/detail`、`/audience`、`/countries`、`/products`、`/accounts-performance`、`/ad-hierarchy/*`、`/creative-insights` 均解析 startDate/endDate。 |
| 是否后端查询问题 | 局部有问题：部分 GET 页面接口会触发数据中心自动刷新，导致读接口不再是纯读，存在后台刷新竞态。 | `/api/data-center/stores` 和 `/api/data-center/accounts-performance` 调用 `ensureDataCenterFreshness({ reason: "api_request" })`；该函数会创建 `DataCenterRefreshRun` 并调用 ledger refresh。 |
| 是否事实表缺日期数据 | 本地 `prisma/dev.db` 是空事实库；VPS 需要运行脚本确认真实分布。 | 本地 `node scripts/audit/r5-rca-db-fact-matrix.mjs` 输出 FactMetaPerformance / FactAudienceBreakdown 在所有区间 rows=0。 |
| 是否 lastGoodData 跨日期复用 | 是，且是日期页面显示相同的第一优先根因。 | `src/lib/data-view-state.ts` 的 `shouldPreserveLastGoodData()` 不检查 requestKey；Audience / Country / Creative / Product 直接复用 lastGoodData；Campaign 的 date mismatch 分支也未校验 requestKey。 |
| 是否同步任务没有按当前日期拉取 | 同步接口接收并下传 startDate/endDate，但多步页面链路不是原子任务，任一步 running / FK 失败都会中断。 | Campaign 页面依次触发 `sync_meta_accounts -> sync_meta_structure -> sync_meta_insights`；每一步是独立 `/api/sync/trigger`。 |
| 同步失败的第一失败点 | 第一类是已有 running task 阻塞独立任务；第二类是结构同步 FK 父级缺失。 | `assertNoRunningTask()` 按 taskType 查 running；`SyncCenter.runTask()` 也按 taskType 阻止 running。日志中的 `sync_meta_structure is already running` / `sync_meta_insights is already running` 与此一致。 |
| 外键失败的第一失败点 | `prisma.ad.upsert()` 前没有在所有路径保证 `AdSet` 已存在。 | `sync-center.service.ts` 中只有 `ad.adset_id && ad.campaign_id` 同时存在时才 `safeEnsureAdSet()`；若 ad 有 adset_id 但 campaign_id 缺失，仍会 `prisma.ad.upsert()` 写入非空 `adsetId`。 |

第一优先修复点：禁止跨日期复用 lastGoodData。只有 `lastGoodData.requestKey === currentRequestKey` 时才允许 preserve；date mismatch 分支也必须用同一 requestKey 守护。

## 2. 页面日期链路审计

| 页面 | DateFilter 是否接入 | 请求参数 start/end | API dateRange | rows | factRows | 是否异常 |
|---|---|---|---|---:|---:|---|
| DataDetailsDashboard | 是，来自 Dashboard props | 传给 `/api/data-center/accounts-performance` | 后端 `dateRange = buildDateRange(startStr,endStr)` | 需跑 API 脚本 | `dataHealth.factRows` 已补 | 风险：GET 会触发 auto refresh，且 error 时复用 lastGoodData |
| CampaignStructureDashboard | 是 | ad-hierarchy 每级都传 start/end | 后端返回 dateRange | 需跑 API 脚本 | dataHealth.factRows | 异常：date mismatch 分支无 requestKey 守护，会跨日期显示旧数据 |
| AudienceAnalysisDashboard | 是 | `/api/data-center/audience` 传 start/end | 后端返回 dateRange | 需跑 API 脚本 | dataHealth.factRows | 异常：`shouldPreserveLastGoodData()` 无 requestKey，空结果可复用旧区间 |
| CountryAnalyticsDashboard | 是 | `/api/data-center/countries` 传 start/end | 后端返回 dateRange | 需跑 API 脚本 | 服务层无统一 factRows | 异常：空结果可复用旧区间 |
| CreativeIntelligenceDashboard | 是 | `/api/data-center/creative-insights` 传 start/end | 后端返回 dateRange | 需跑 API 脚本 | dataHealth.factRows | 异常：空结果可复用旧区间 |
| ProductIntelligenceDashboard | 是 | `/api/data-center/products` 传 start/end | 后端返回 dateRange | 需跑 API 脚本 | dataHealth.factRows 当前为 products.length | 异常：空结果可复用旧区间 |
| StoreDataDashboard | 是 | `/api/data-center/stores` 传 start/end | 后端返回 dateRange/appliedFilters | 需跑 API 脚本 | order count | 风险：GET stores 会触发 auto refresh 写账本 |
| 诊断总览 | 是 | POST `/api/diagnostics/issues` 传 start/end | 非 data-center dateRange contract | 需另跑诊断接口 | 取决于诊断引擎 | 异常源大概率来自事实表 / lastGoodData，而不是按钮 |
| 广告表现诊断 | 是 | `useDiagnosticsIssues({ startDate,endDate })` | 同上 | 需另跑诊断接口 | 同上 | 依赖 FactMetaPerformance 日期覆盖 |
| 转化漏斗诊断 | 是 | `useDiagnosticsIssues({ startDate,endDate })` | 同上 | 需另跑诊断接口 | 同上 | 依赖 Order + FactMetaPerformance 日期覆盖 |

## 3. API 日期矩阵

只读脚本：

```bash
node scripts/audit/r5-rca-api-date-matrix.mjs
```

本地执行结果：全部 `REQUEST_FAILED`，原因是本地 dev server 无法启动，`npm run dev` 报：

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'uuid' imported from src/server/routes/sync.routes.ts
```

这不是 API 脚本写入问题，而是本地依赖安装状态问题。VPS 或依赖完整环境中运行该脚本可得到真实矩阵。

本地脚本生成的请求区间如下，说明日期按钮/脚本区间本身是不同的：

| endpoint | range | request start/end | response dateRange | rowCount | factRows | spend | impressions | clicks | purchases |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| all endpoints | today | 2026-07-07..2026-07-07 | REQUEST_FAILED(local server not running) | 0 |  | 0 | 0 | 0 | 0 |
| all endpoints | yesterday | 2026-07-06..2026-07-06 | REQUEST_FAILED(local server not running) | 0 |  | 0 | 0 | 0 | 0 |
| all endpoints | past_7 | 2026-07-01..2026-07-07 | REQUEST_FAILED(local server not running) | 0 |  | 0 | 0 | 0 | 0 |
| all endpoints | past_14 | 2026-06-24..2026-07-07 | REQUEST_FAILED(local server not running) | 0 |  | 0 | 0 | 0 | 0 |
| all endpoints | past_30 | 2026-06-08..2026-07-07 | REQUEST_FAILED(local server not running) | 0 |  | 0 | 0 | 0 | 0 |

静态代码结论：上述接口在正常运行时都会把请求日期解析为 `startStr/endStr`，并通过 `buildDateRange(startStr,endStr)` 或 `appliedFilters` 回传。若 VPS API 矩阵显示 response dateRange 与 request 不一致，问题在具体 endpoint 内部覆盖了 range；当前静态扫描没有发现这种覆盖。

## 4. 数据库事实表日期矩阵

只读脚本：

```bash
node scripts/audit/r5-rca-db-fact-matrix.mjs
```

本地 `prisma/dev.db` 输出：

| table | range | rows | minDate | maxDate | spend | impressions | clicks | purchases |
|---|---|---:|---|---|---:|---:|---:|---:|
| FactMetaPerformance | today | 0 |  |  | 0.00 | 0 | 0 | 0 |
| FactAudienceBreakdown | today | 0 |  |  | 0.00 | 0 | 0 | 0 |
| FactMetaPerformance | yesterday | 0 |  |  | 0.00 | 0 | 0 | 0 |
| FactAudienceBreakdown | yesterday | 0 |  |  | 0.00 | 0 | 0 | 0 |
| FactMetaPerformance | past_7 | 0 |  |  | 0.00 | 0 | 0 | 0 |
| FactAudienceBreakdown | past_7 | 0 |  |  | 0.00 | 0 | 0 | 0 |
| FactMetaPerformance | past_14 | 0 |  |  | 0.00 | 0 | 0 | 0 |
| FactAudienceBreakdown | past_14 | 0 |  |  | 0.00 | 0 | 0 | 0 |
| FactMetaPerformance | past_30 | 0 |  |  | 0.00 | 0 | 0 | 0 |
| FactAudienceBreakdown | past_30 | 0 |  |  | 0.00 | 0 | 0 | 0 |
| AdAccount | all | 0 |  |  |  |  |  |  |
| Campaign | all | 0 |  |  |  |  |  |  |
| AdSet | all | 0 |  |  |  |  |  |  |
| Ad | all | 0 |  |  |  |  |  |  |
| AdCreative | all | 0 |  |  |  |  |  |  |

本地判断：

- 本地 today / yesterday 没有 fact rows。
- 本地 past_7 / past_14 / past_30 都是 0，无法代表 VPS 真实数据。
- VPS 必须运行同一脚本；若 VPS rows 不同但页面一样，优先修 lastGoodData；若 VPS rows 也一样，说明同步没有按日期补齐事实表。

## 5. lastGoodData / preserve 逻辑审计

| file | preserve condition | includes date key | risk | conclusion |
|---|---|---:|---|---|
| `src/lib/data-view-state.ts` | `lastGoodData && rows.length === 0 && status in DATA_VIEW_PRESERVE_STATUSES` | 否 | 高 | 通用 helper 本身不校验 requestKey，是跨日期复用的核心漏洞。 |
| `CampaignStructureDashboard.tsx` | date mismatch 直接复用 lastGoodData；empty preserve 分支校验 requestKey | 部分 | 高 | empty preserve 分支较安全，但 date mismatch 分支仍可跨日期复用。 |
| `AudienceAnalysisDashboard.tsx` | date mismatch 复用；empty preserve 复用 | 否 | 高 | 切日期后新范围为空时，会把旧范围 rows 显示到新日期。 |
| `CreativeIntelligenceDashboard.tsx` | date mismatch 复用；empty preserve 复用 | 否 | 高 | 素材页 past_7/past_14/past_30 一样可由此解释。 |
| `ProductIntelligenceDashboard.tsx` | date mismatch 复用；empty preserve 复用 | 否 | 高 | 产品页空结果会复用旧产品列表。 |
| `CountryAnalyticsDashboard.tsx` | date mismatch 复用；empty preserve 复用 | 否 | 高 | 国家页只显示旧国家/旧汇总的风险高。 |

结论：`past_7 / past_14 / past_30 页面数据显示一样` 的第一根因是 preserve 逻辑跨日期复用。即使 API 正确返回当前日期空数据，页面也会显示上一次成功数据，并用提示文案掩盖事实。

## 6. 同步任务链路审计

| 页面 | 点击同步后 task chain | 当前步骤 | 锁 taskType | 是否复用 running | 是否可能卡住 |
|---|---|---|---|---|---|
| 广告层级 | 前端顺序触发 `sync_meta_accounts -> sync_meta_structure -> sync_meta_insights` | 1/3, 2/3, 3/3 | 每个 task 独立锁 | 否 | 是。任一步已有 running 会中断链路。 |
| 受众/国家 | `sync_meta_audience` | 1/1 | `sync_meta_audience` | 否 | 是。已有 running 或 Meta breakdown 失败会直接 409/failed。 |
| 素材数据 | `sync_meta_creatives`，后端内部先 structure 再 insights | 1/1 对外，内部 2+N | creatives + structure + insights | 部分 | 是，但比广告层级安全，因为后端一次检查 creatives 依赖 taskTypes。 |
| 账户数据 | `sync_meta_accounts -> sync_meta_insights -> refresh_meta_datacenter_ledger` | 1/3,2/3,3/3 | 每个 task 独立锁 | 否 | 是。insights running 会卡在 2/3。 |
| 产品数据 | 页面刷新读 `/products`，无专属同步链 | N/A | N/A | N/A | 产品异常主要来自订单事实表/日期 preserve。 |
| StoreDataDashboard | `refresh_store_datacenter_ledger` 或 stores GET auto refresh | 读接口也可能触发 | auto_light_refresh + ledger | 是 | 是。GET 引发后台刷新导致状态不可预测。 |

同步卡住 1/3 或 1/4 的直接原因：

1. 多步页面同步链不是一个后端原子 task chain，而是多个独立 POST 串起来。
2. `/api/sync/trigger` 的 `assertNoRunningTask()` 只按当前 taskType 检查 running；广告层级页面一开始不会检查后续 `sync_meta_insights` 是否 running。
3. `SyncCenter.runTask()` 内部也按单 taskType 阻止 running，任一步未完成都会抛 `SYNC_TASK_ALREADY_RUNNING`。
4. 若结构同步中出现 FK 错误，当前 task 会 failed；但用户再次点击时，其他 task 仍可能 running，从而继续报已有任务。

## 7. SyncLog 运行态审计

只读脚本：

```bash
node scripts/audit/r5-rca-sync-locks.mjs
```

本地输出：

| metric | value |
|---|---:|
| runningTasks | 0 |
| staleRunningTasksOver30Min | 0 |
| recent failed tasks | 0 |
| recent tasks | 0 |

本地额外发现：第一次用 Prisma `syncLog.findMany()` 时失败：

```text
The column main.SyncLog.createdAt does not exist in the current database.
```

这说明本地 `dev.db` 与当前 Prisma schema 存在物理列漂移。脚本已改为 raw SELECT 只读必要列。VPS 也应运行脚本确认是否存在类似漂移；如果 VPS `SyncLog` 缺列，部分 Prisma 默认查询可能直接 P2022。

## 8. Prisma foreign key 根因审计

搜索结果：

- `src/server/services/sync-center.service.ts`:
  - `prisma.campaign.upsert`
  - `prisma.adSet.upsert`
  - `prisma.ad.upsert`
- `src/server/services/meta-hierarchy-sync.service.ts`:
  - `prisma.adAccount.upsert`
- `src/mcp/domain/meta-structure-sync.ts` 也有结构 upsert，但当前服务端主链路使用 `src/server/services/sync-center.service.ts`。

| child model | parent model | upsert file | parent guarantee | risk | conclusion |
|---|---|---|---|---|---|
| Campaign | AdAccount | `sync-center.service.ts` | `safeEnsureAdAccount(actId)` 在 campaign loop 内执行 | 中 | 如果 AdAccount 存储不是 normalized `act_` 形式，会父级缺失。 |
| AdSet | Campaign | `sync-center.service.ts` | 只有 `adset.campaign_id` 存在时 `safeEnsureCampaign()` | 高 | campaign 端点未分页且 limit=300；父 campaign 未被写入时，adset 子级会失败或抛 parent missing。 |
| Ad | AdSet | `sync-center.service.ts` | 只有 `ad.adset_id && ad.campaign_id` 同时存在时 `safeEnsureAdSet()` | 极高 | Meta ads 返回 adset_id 但 campaign_id 缺失时，仍会 `prisma.ad.upsert()`，导致 Ad.adsetId 外键失败。 |
| Ad | AdCreative | `sync-center.service.ts` | creative 缺失时 create，失败被 `.catch(() => {})` 吞掉 | 中 | creative relation 是 SetNull，通常不是 FK 第一失败点，但吞错会隐藏素材缺失。 |

第一外键失败点：`Ad -> AdSet`。代码路径是 `sync-center.service.ts` 的 `prisma.ad.upsert()`。父级保证条件过窄：只在 `adset_id` 和 `campaign_id` 都存在时保证 AdSet；但 schema 中 `Ad.adsetId` 是必填且关联 `AdSet.id`。

## 9. 受众 / 国家统计异常审计

| source | range | rows | countryCount | spend | purchases | issue |
|---|---|---:|---:|---:|---:|---|
| FactAudienceBreakdown.dimension_type=country | 由 API/script 传入 | 需 VPS 脚本 | 需 VPS 脚本 | 需 VPS 脚本 | 需 VPS 脚本 | 受众页应只看这类 Meta 受众国家数据。 |
| Order.shipping/billing country | 由 API/script 传入 | 需 VPS 脚本 | 需 VPS 脚本 | N/A | N/A | 国家页服务会同时计算订单国家与 Meta 受众国家，需要 UI 明确分区。 |
| country-analytics service | 由 API/script 传入 | 需 VPS 脚本 | 需 VPS 脚本 | 需 VPS 脚本 | 需 VPS 脚本 | 服务同时聚合 `FactAudienceBreakdown` 与 `Order`，不是单一事实源。 |

代码判断：

- 受众接口 `/api/data-center/audience` 查询 `FactAudienceBreakdown`，默认 `dimensionType=country`。
- 国家服务 `country-analytics.service.ts` 同时读取 `FactAudienceBreakdown.dimension_type=country` 和 `Order.store_local_date` 范围内的 shipping/billing country。
- “只显示 1 个国家”需要 VPS 上运行 DB 脚本确认：如果 `FactAudienceBreakdown` countryCount=1，则是事实表真实只有 1 个国家；如果 fact countryCount>1 但 UI=1，则是过滤/聚合错误。

## 10. 诊断页数据异常关联

| diagnosis page | symptom | upstream dependency | likely root cause | fix stage |
|---|---|---|---|---|
| 诊断总览 | 数字或对象名称异常 | `/api/diagnostics/issues` + rule diagnostic engine | 上游事实表日期覆盖不足或诊断 evidence 原始字段未映射 | R5 后续诊断 contract 修复 |
| 广告表现诊断 | “Meta 19 265 246” 类展示 | FactMetaPerformance + AdAccount | 不是 DateFilter 按钮问题，优先检查事实表日期矩阵与 issue entity label | R5 后续 |
| 转化漏斗诊断 | evidence 快照像 raw JSON | `DiagnosticIssueCard` 展开区 `JSON.stringify(issue.evidence)` | 当前设计直接展示 evidence JSON；不是同步根因，但需要展示层格式化 | R5 UI/diagnosis backlog |
| 问 AI | 上下文卡展示 raw JSON | `open-ai-context` context card `JSON.stringify(context)` | Copilot 当前用于审计透明，不是业务建议渲染；需后续抽象业务摘要 | R5 UI/AI contract |
| metaPurchase 映射 | 中文映射不完整 | `business-labels.ts` + evidence metrics | evidence key 与 label map 未完全统一 | R5 diagnosis label pass |

## 11. 根因优先级

P0 根因：

1. `lastGoodData` preserve 缺少 requestKey 守护，是 past_7 / past_14 / past_30 页面显示一样的第一优先修复点。
2. 广告层级/账户页多步同步链由前端串多个独立 `/api/sync/trigger`，不是后端原子链路；running lock 会让链路卡在 1/3、2/3 或 1/4。
3. `sync-center.service.ts` 的 `prisma.ad.upsert()` 父级保证不完整，`Ad.adsetId -> AdSet.id` 是 FK 第一失败点。

P1 根因：

1. `/api/data-center/stores` 与 `/api/data-center/accounts-performance` 的 GET 读接口会触发 `ensureDataCenterFreshness()` 写入/刷新账本，造成日期矩阵和页面读结果有竞态。
2. 本地 `dev.db` 与 Prisma schema 已出现 SyncLog 物理列漂移；VPS 需要确认是否也存在 schema/db 漂移。
3. 国家页同时包含 Meta 受众国家和订单国家两套事实源；若标题/筛选混用，会让“国家数据异常”表现成聚合错误。

## 本轮命令证据

```bash
git rev-parse HEAD
# b33bdc2cad440386db1a5f571d65d9d1f1c68212

git status --short
# clean before audit files

node scripts/audit/r5-rca-db-fact-matrix.mjs
# local dev.db: fact rows all 0

node scripts/audit/r5-rca-sync-locks.mjs
# local dev.db: runningTasks=0, staleRunningTasksOver30Min=0

node scripts/audit/r5-rca-api-date-matrix.mjs
# local API unavailable because dev server failed to start: missing uuid dependency

rg -n "update|delete|upsert|create\(" scripts\audit
# no matches
```
