# R5-DATA-PAGE-CODE-CLOSURE-CF-EVIDENCE

## 1. 任务信息

| Item | Value |
| --- | --- |
| 任务编号 | R5-DATA-PAGE-CODE-CLOSURE-CF-EVIDENCE |
| 执行日期 | 2026-07-13 |
| 执行者 | Codex |
| 环境 | Windows PowerShell, local repository |
| branch | `test/r5-data-page-code-closure-cf-evidence` |
| base | `ab8dad17138b489eb984ee93914f2e3062d4ef1d` |
| evidence head base | `8e6b0b4b44747d225195b653fbf82b1a7b724517` |

本任务只补强 evidence/test，不执行正式 API 矩阵、Browser、VPS、R6 或 Production。

## 2. 基线核对

| Item | Value |
| --- | --- |
| 代码基线 | `8e6b0b4b44747d225195b653fbf82b1a7b724517` |
| compare base | `ab8dad17138b489eb984ee93914f2e3062d4ef1d` |
| ahead_by | `1` |
| behind_by | `0` |
| commit message | `fix: close countries store scope and summary consistency` |
| branch 创建后 HEAD | `8e6b0b4b44747d225195b653fbf82b1a7b724517` |
| branch 创建后 working tree | clean |

`git fetch origin` 在本地环境中失败：

```text
fatal: unable to access 'https://github.com/newbie5522/meta-mcp2.0.git/': Empty reply from server
```

本地对象库可读取指定基线：

```text
git cat-file -t 8e6b0b4b44747d225195b653fbf82b1a7b724517
commit
```

上一轮变更文件：

```text
M docs/page-audit-report.md
M src/components/AudienceAnalysisDashboard.tsx
M src/server/routes/data-center.routes.ts
A src/server/services/country-analytics.logic.test.ts
A src/server/services/country-analytics.logic.ts
M src/server/services/country-analytics.service.ts
M src/server/services/order-fact.service.ts
```

## 3. 授权文件核对

| 文件 | 核对结果 |
| --- | --- |
| `src/server/services/country-analytics.logic.ts` | 符合正式授权 |
| `src/server/services/country-analytics.logic.test.ts` | 符合正式授权 |

核对明细：

| 核对项 | `country-analytics.logic.ts` | `country-analytics.logic.test.ts` |
| --- | --- | --- |
| 是否在上一轮允许清单内 | 是 | 是 |
| 是否只承载纯逻辑和测试 | 是，纯函数，无 Prisma | 是，Vitest 测试 |
| 是否导入 Prisma | 否 | 否 |
| 是否访问数据库 | 否 | 否 |
| 是否调用网络/API | 否 | 否 |
| 是否写文件或业务数据 | 否 | 否 |
| 是否成为生产 fallback 主链路 | 否 |
| 是否引入 mock/demo 主链路 | 否 |
| 是否修改 schema 或依赖 | 否 |
| 是否被生产 service 正常复用 | 是，复用纯函数；不形成替代数据源 |
| 测试 fixture 是否只在测试使用 | 不适用 | 是 |

grep 核对：

```text
rg -n "Prisma|prisma|fetch\(|axios|http://|https://|fs\.|writeFile|appendFile|create\(|update\(|upsert\(|delete\(|deleteMany|schema|migrate|mock|demo|fallback" src/server/services/country-analytics.logic.ts src/server/services/country-analytics.logic.test.ts
<NO_MATCH>
```

## 4. 共享契约测试

新增测试文件：

```text
src/server/services/order-fact.service.test.ts
```

测试直接覆盖真实公共函数：

```text
isPaymentStatusExcluded
normalizeStoreOrderFacts
getStoreOrderFacts
getStoreOrderSummary
```

| 契约项 | 测试名称 | 输入 | 预期 | 实际 | 判定 |
| --- | --- | --- | --- | --- | --- |
| payment status | `excludes unpaid statuses from shared order facts` | `waiting/unpaid/pending/cancelled/voided` 与 `paid/completed/fulfilled/null/""/"  PAID  "` | 排除未支付/取消状态；保留当前 helper 允许状态 | `getStoreOrderFacts` 返回 6 条允许状态订单；排除状态不返回 | PASS |
| orderId deduplication | `deduplicates line rows by real orderId` | 同 `orderId`、不同 DB `id`、两条 line | 只归一为 1 个订单；`orderTotal` 只计一次；无 fallback warning | `orders.length=1`、`revenue=120`、无 `ORDER_DEDUP_FALLBACK_USED` | PASS |
| database id fallback warning | `warns when database id fallback is used` | `orderId=null`、`id=db-fallback-1` | 不丢订单；使用 DB id 临时 fallback；返回 warning | `usedFallbackKey=true`，warnings 包含 `ORDER_DEDUP_FALLBACK_USED` | PASS |
| refund amount available | `uses available refund amount without inferring a full refund` | refund=true、真实 `refundAmount=25`、整单 `orderTotal=100` | 使用真实退款金额；不按全额退款推断 | `refundAmount=25`，不等于 `100`，无 unavailable warning | PASS |
| refund amount unavailable | `does not infer full refund when refund amount is unavailable` | refund=true、无可靠 refund amount、`orderTotal=150` | 不伪造退款金额；返回 unavailable warning | `refundAmount=null`，不等于 `150`，warnings 包含 `REFUND_AMOUNT_UNAVAILABLE` | PASS |
| multi-line revenue with orderTotal | `uses orderTotal once for multi-line revenue when orderTotal is available` | 同 `orderId` 两行，均有 `orderTotal=200` | revenue 只计一次整单金额 | `revenue=200` | PASS |
| multi-line revenue without orderTotal | `sums line revenue only when orderTotal is unavailable` | 同 `orderId` 两行，无 `orderTotal`，line revenue 45/55 | 按 line revenue 聚合，不只取第一行 | `revenue=100` | PASS |
| profit 0 | `preserves real zero profit` | `profit=0` | `0` 为真实值，不当作缺失 | `profit=0`，无 `PROFIT_UNAVAILABLE` | PASS |
| profit unavailable | `keeps profit unavailable instead of estimating it` | `profit=null` | 不估算利润，保持 null 并 warning | `profit=null`，warnings 包含 `PROFIT_UNAVAILABLE` | PASS |
| store_local_date | `uses store_local_date by default and keeps legacy createdAt fallback disabled` | `getStoreOrderFacts({startDate,endDate})` | where 使用 `store_local_date.gte/lte`，不生成 `createdAt` fallback | where 中只有 `store_local_date`；无 `OR` 与 `createdAt` | PASS |
| storeId 范围 | `scopes getStoreOrderFacts to requested storeId and ignores all or undefined store ids` | `storeId=all/undefined/"undefined"/"2"` | 前三者不加店铺条件；单店使用 Number | 前三者 `where.storeId` 未定义；`"2"` 转为 `2` | PASS |
| getStoreOrderFacts | 多个测试组合覆盖 | Prisma `findMany` mock 返回订单数组 | 日期、storeId、payment status 均按共享契约处理；不写库 | 只调用 `findMany` mock；返回范围符合断言 | PASS |
| getStoreOrderSummary | `summarizes shared order facts with payment filtering, deduplication, refunds, and AOV` | 两条同订单 line、一个正常订单、一个 pending 订单 | summary 与共享 facts 范围一致，排除 pending，去重后统计 | `ordersCount=2`、`totalSales=150`、`aov=75`、`refundAmount=10` | PASS |
| legacy fallback explicit | `counts explicit legacy fallback rows separately when fallback is requested` | `includeLegacyCreatedAtFallback=true` 且 `store_local_date=null` | 显式 fallback 时统计 legacy 项，不作为默认主链路 | `legacyFallbackOrdersCount=1`、`legacyFallbackRevenue=70` | PASS |

Prisma mock 解释：

```text
vi.mock("../../db/index.js")
findMany 为只读 mock
无 create/update/upsert/delete/deleteMany 业务写入
普通测试 fixture 字段中的 createdAt 只是对象字段，不是 Prisma 写库
```

## 5. 测试命令与结果

| 命令 | exit code | 结果 |
| --- | ---: | --- |
| `npm.cmd run lint` | 0 | PASS |
| `npm.cmd run build` | 0 | PASS，存在 Vite chunk size 与 dynamic/static import warning |
| `npx.cmd vitest run src/server/services/country-analytics.logic.test.ts` | 0 | 1 file, 8 tests passed |
| `npx.cmd vitest run src/server/services/order-fact.service.test.ts` | 0 | 1 file, 13 tests passed |
| `npx.cmd vitest run src/server/services/country-analytics.logic.test.ts src/server/services/order-fact.service.test.ts` | 0 | 2 files, 21 tests passed |

Vitest 均出现 Node deprecation warning：

```text
[DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
```

该 warning 未导致测试失败。

## 6. Smoke 环境

| Item | Value |
| --- | --- |
| Node | `v26.4.0` |
| npm | `11.17.0` |
| git | `git version 2.54.0.windows.1` |
| OS | Windows_NT / PowerShell |
| cwd | `D:\Backup\我的文档\meta2.0\meta-mcp2.0` |
| UTC time captured | `2026-07-13T11:31:56Z` |
| `.env` | not present in repo root |
| DATABASE_URL env name | not present in captured environment-name list |
| API endpoint | not configured for smoke; `smoke:data` is static read-only source check |

Captured environment variable names only:

```text
ALLUSERSPROFILE
APPDATA
ChocolateyInstall
ChocolateyLastPathUpdate
CODEX_CI
CODEX_INTERNAL_ORIGINATOR_OVERRIDE
CODEX_PERMISSION_PROFILE
CODEX_SANDBOX_NETWORK_DISABLED
CODEX_SHELL
CODEX_THREAD_ID
COLORTERM
CommonProgramFiles
CommonProgramFiles(x86)
CommonProgramW6432
COMPUTERNAME
ComSpec
DISABLE_AUTO_UPDATE
DriverData
GH_PAGER
GIT_CONFIG_COUNT
GIT_CONFIG_KEY_0
GIT_CONFIG_VALUE_0
GIT_PAGER
HOMEDRIVE
HOMEPATH
LANG
LC_ALL
LC_CTYPE
LESS
LOCALAPPDATA
LOG_FORMAT
LOGONSERVER
NO_COLOR
NUMBER_OF_PROCESSORS
OneDrive
OS
PAGER
Path
PATH
PATHEXT
PROCESSOR_ARCHITECTURE
PROCESSOR_IDENTIFIER
PROCESSOR_LEVEL
PROCESSOR_REVISION
ProgramData
ProgramFiles
ProgramFiles(x86)
ProgramW6432
PSModulePath
PUBLIC
RUST_LOG
SHELL
SystemDrive
SystemRoot
TEMP
TERM
TMP
USERDOMAIN
USERDOMAIN_ROAMINGPROFILE
USERNAME
USERPROFILE
windir
ZES_ENABLE_SYSMAN
ZSH_TMUX_AUTOSTART
ZSH_TMUX_AUTOSTARTED
```

Dependency install note:

```text
npm.cmd ci in base worktree failed because package.json and package-lock.json are not in sync:
Missing: @types/uuid@9.0.8 from lock file
Missing: uuid@9.0.1 from lock file
```

因此严格 `npm ci` 环境安装未完成。后续 base/head smoke 使用同一机器、同一现有依赖环境连续执行。该事实限制归因强度，需 03 重点复验。

## 7. Base Smoke

| Item | Value |
| --- | --- |
| commit | `ab8dad17138b489eb984ee93914f2e3062d4ef1d` |
| command | `npm.cmd run smoke:data` |
| exit code | `1` |
| total checks | 15 |
| passed | 13 |
| warnings | 0 |
| failed | 2 |
| raw log | `docs/evidence/R5-DATA-PAGE-CODE-CLOSURE-CF-EVIDENCE-base-smoke-data.log` |

失败项目：

```text
Unmapped AdAccount can be written - unmapped AdAccount write path is not statically proven
Dangerous sync endpoints require ENABLE_MANUAL_SYNC - dangerous sync routes are not fully protected by ENABLE_MANUAL_SYNC
```

## 8. Head Smoke

| Item | Value |
| --- | --- |
| commit | `8e6b0b4b44747d225195b653fbf82b1a7b724517` |
| command | `npm.cmd run smoke:data` |
| exit code | `1` |
| total checks | 15 |
| passed | 13 |
| warnings | 0 |
| failed | 2 |
| raw log | `docs/evidence/R5-DATA-PAGE-CODE-CLOSURE-CF-EVIDENCE-head-smoke-data.log` |

失败项目：

```text
Unmapped AdAccount can be written - unmapped AdAccount write path is not statically proven
Dangerous sync endpoints require ENABLE_MANUAL_SYNC - dangerous sync routes are not fully protected by ENABLE_MANUAL_SYNC
```

## 9. Base/Head 差异

| 检查项 | Base | Head | 差异 | 判定 |
| --- | ---: | ---: | --- | --- |
| exit code | 1 | 1 | 无 | 同样失败 |
| 失败数量 | 2 | 2 | 无 | head 未扩大 |
| 失败项目集合 | 2 项 | 2 项 | 无 | 完全一致 |
| 新增失败 | N/A | 0 | 无 | head 未新增 |
| 消失失败 | N/A | 0 | 无 | head 未减少 |
| 同名失败错误内容变化 | 原错误内容 | 同原错误内容 | 无 | 一致 |
| 超时或连接失败 | 否 | 否 | 无 | 无超时 |
| 输出结构变化 | 相同 summary 格式 | 相同 summary 格式 | 无 | 一致 |

逐项回答：

1. 失败是否在 base 已存在？是。
2. head 是否新增失败？否。
3. head 是否扩大失败？否。
4. head 是否改变同一失败的错误性质？否。
5. head 是否减少失败？否。
6. 环境是否足以支持归因？部分支持；但 `npm ci` 未按严格要求完成。
7. 是否能证明失败与 `8e6b0b4` commit 无关？严格口径：无法完全证明与本 commit 无关；smoke 输出证据显示 base 已存在且 head 未扩大。

## 10. 归因结论

```text
无法证明与本 commit 无关
```

说明：base/head smoke 输出完全一致，支持“head 未新增或扩大 smoke 失败”；但 base worktree 的 `npm ci` 被 lock 不一致阻断，本次没有完成指令要求的严格依赖安装闭环，因此不写“可证明为 base 已存在且 head 未扩大”的最终归因。

## 11. 长期规则边界

```text
payment status 长期业务规则：待确认
refund 长期业务规则：待确认
canonical deduplication 长期业务规则：待确认
```

本测试只锁定当前共享 helper 行为，不将其升级为长期业务决定。

## 12. 未执行项目

```text
正式 API 矩阵：NOT RUN
Browser：NOT RUN
VPS：NOT RUN
R6：BLOCKED
Production：NOT RUN
```

## 13. Grep 与范围核对

测试覆盖 grep：

```text
rg -n "isPaymentStatusExcluded|getStoreOrderFacts|getStoreOrderSummary|orderId|dedup|fallback|refund|profit|store_local_date|storeId|includeLegacyCreatedAtFallback" src/server/services/order-fact.service.test.ts
```

结果：命中均为导入、测试名称、fixture 和真实 `expect` 断言，不只是注释。

Prisma mock grep：

```text
rg -n "vi\.mock|findMany|create|update|upsert|delete|deleteMany" src/server/services/order-fact.service.test.ts
```

结果：仅命中 `vi.mock`、`findMany` 和普通字段 `createdAt`；无 Prisma 写库调用。

功能代码零改动：

```text
git diff --name-only 8e6b0b4b44747d225195b653fbf82b1a7b724517...HEAD -- src/server/services/order-fact.service.ts src/server/services/country-analytics.logic.ts src/server/services/country-analytics.logic.test.ts src/server/services/country-analytics.service.ts src/server/routes/data-center.routes.ts src/components/AudienceAnalysisDashboard.tsx
<NO_MATCH>
```

永久禁止文件：

```text
git diff --name-only 8e6b0b4b44747d225195b653fbf82b1a7b724517...HEAD -- prisma/schema.prisma prisma/migrations Dockerfile docker-compose.yml deploy.sh repo repo_ref repo_reference
<NO_MATCH>
```

治理文档：

```text
git diff --name-only 8e6b0b4b44747d225195b653fbf82b1a7b724517...HEAD -- docs/WORKFLOW.md docs/PROJECT_MASTER_PLAN.md docs/PROJECT_STATUS.md docs/ROADMAP.md docs/DECISIONS.md docs/PROJECT_CHAT_WINDOWS.md
<NO_MATCH>
```

禁止测试假通过：

```text
rg -n "expect\(true\)\.toBe\(true\)|\.skip\(|describe\.skip|it\.skip|test\.skip|todo\(" src/server/services/order-fact.service.test.ts
<NO_MATCH>
```

## 14. 执行者状态声明

```text
Evidence/test commit 已提交后生效
测试和 smoke 证据已保存
等待 03 独立审计
```

不得由本报告声明：

```text
Code complete：PASS
API 门禁：OPEN
API complete：PASS
Browser complete：PASS
VPS complete：PASS
Production complete：PASS
R5 完成
进入 R6
```

## 15. 需要 03 重点复验

1. `npm ci` 因 base lock 不一致失败后，本次 smoke 是否足以作为 base/head 归因证据。
2. `order-fact.service.test.ts` 是否完整覆盖共享契约，且未复制生产实现。
3. `findMany` mock 是否仅为只读边界 mock。
4. `.log` 文件因 `.gitignore` 需强制加入，是否只包含 smoke stdout/stderr 和 exit code。
5. base/head smoke 失败项是否仍可由后续功能任务处理，而不阻断本 evidence/test commit 的提交。
