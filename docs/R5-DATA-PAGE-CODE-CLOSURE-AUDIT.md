## 1. 任务信息

```text
任务编号：R5-DATA-PAGE-CODE-CLOSURE-AUDIT
任务性质：独立代码收口审计
当前阶段：R5
修改代码：禁止
新增功能：禁止
```

## 2. 审计目标

对最新功能代码 commit 进行正式补验收，确认：

* Audience Meta 指标命名是否完整；
* Countries store-only scope 是否完整；
* 是否产生范围、汇总或错误状态回归；
* 是否仍遗漏 R5/CF3 核心问题；
* 是否具备进入 API 验收的条件。

## 3. 审计基线

```text
仓库：newbie5522/meta-mcp2.0
branch：main
base：4e76d3785b0d357ec614ff2acfc3e34ba4cff64e
head：c417aadc724b56c09f5d3017e1915ebee20ee6f1
ahead_by：1
behind_by：0
```

实际改动文件：

* `docs/page-audit-report.md`
* `src/components/AudienceAnalysisDashboard.tsx`
* `src/server/routes/data-center.routes.ts`
* `src/server/services/country-analytics.service.ts`

## 4. 必须读取

1. `docs/WORKFLOW.md`
2. `docs/PROJECT_MASTER_PLAN.md`
3. `docs/PROJECT_STATUS.md`
4. `docs/ROADMAP.md`
5. `docs/DECISIONS.md`
6. c417 对应任务和开发说明
7. `4e76d378... → c417aadc...` compare
8. 4 个实际改动文件
9. 相关审计报告和 Sources

## 5. 审计步骤

### 5.1 指令和 Commit 对齐

确认：

* base/head；
* `ahead_by`、`behind_by`；
* commit message；
* 实际变更文件；
* 遗漏文件；
* 额外文件；
* 新增文件；
* 禁止文件；
* 是否基于正确 base；
* 是否只完成限定补丁。

### 5.2 逐文件审计

#### `docs/page-audit-report.md`

检查：

* 是否准确声明限定范围；
* 是否明确未完成 API、Browser、VPS；
* 是否存在把代码补丁写成完整 CF3 的表述；
* 文档是否与实际代码一致。

#### `src/components/AudienceAnalysisDashboard.tsx`

检查：

* 购买相关指标是否明确标识为 Meta；
* tooltip、chart、table、KPI 和说明文案是否统一；
* 是否仍存在模糊的“购买数”“购买价值”；
* 是否误把 Store orders/revenue 改成 Meta 指标；
* 是否影响日期、账户、empty、error 或 lastGoodData。

#### `src/server/routes/data-center.routes.ts`

检查：

* Countries `visibleCountryRows` 是否只以 Store orders/revenue 保留国家；
* `summary` 是否从相同 `visible rows` 汇总；
* `dataScope` 是否准确；
* 日期、`storeId`、mapping 范围是否一致；
* catch、empty、error 是否真实；
* GET 是否写库。

#### `src/server/services/country-analytics.service.ts`

检查：

* store-only 过滤是否只使用店铺订单和收入；
* Meta-only 国家是否排除出 Countries 主列表；
* Meta 数据是否只作为已匹配国家的附属指标；
* 日期是否使用 `Order.store_local_date`；
* `storeId` 是否贯通；
* summary/rows 是否同口径；
* 是否误删有订单但收入为零的合法数据。

### 5.3 逐问题检查

必须逐项确认：

* Audience 指标命名；
* Countries store-only scope；
* CF3 核心遗漏；
* 日期；
* `storeId`；
* `accountId`；
* `summary`/`visible rows`；
* Meta/店铺分离；
* catch；
* empty；
* `RUNNING`；
* `NO_NEW_DATA`；
* `PARTIAL_SUCCESS`；
* true error；
* lastGoodData；
* API error 是否包装成无数据；
* 无数据是否包装成失败。

c417 未直接修改的链路，也必须检查是否受到本轮变更影响；不得把“未修改”自动视为通过。

### 5.4 grep 审计

#### 正向关键代码

检查：

* `Meta购买数`
* `Meta转化价值`
* `平均Meta购买成本`
* Countries Store order/revenue 过滤
* `Order.store_local_date`
* `storeId`
* `accountId`
* summary 计算
* `RUNNING`
* `NO_NEW_DATA`
* `PARTIAL_SUCCESS`
* lastGoodData
* requestKey

#### 禁止和风险关键词

检查：

* `mock`
* `demo`
* `fallback`
* `legacy`
* `display:none`
* `deleteMany`
* GET 路由中的 create/update/upsert/delete
* `issueId`
* `ACC_ACT`
* `acc_act`
* `STORE_1`
* `store_1`
* `data_health`
* `mapping`

每个命中必须说明：

* 文件和位置；
* 上下文；
* 是否正常；
* 是否违反规则；
* 是否阻断。

### 5.5 关键逻辑检查

重点确认：

* Countries service 和 route 的过滤是否一致；
* Countries summary 是否来自最终 visible rows；
* store-only 过滤是否保留有订单但零收入的数据；
* Meta-only 国家是否仍可在 Audience country tab 分析；
* Audience 所有购买指标是否统一命名；
* c417 是否只修改限定范围；
* 是否修改永久禁止文件；
* 是否存在 GET 写库；
* 是否存在同步前 `deleteMany`；
* 是否存在服务器热修证据。

## 6. 审计输出要求

必须输出：

1. PASS / PARTIAL / FAIL；
2. base/head/ahead/behind；
3. 变更文件；
4. 遗漏、额外和禁止文件；
5. 逐文件结论；
6. 逐问题结论；
7. grep 命令、结果和上下文；
8. 关键逻辑结论；
9. P0/P1/P2；
10. `Code complete`；
11. 未运行项；
12. 是否允许进入 API；
13. 是否需要生成 R5 补漏开发任务；
14. Project Docs 或 R5 Backlog；
15. 正式文档更新建议。

## 7. 审计后处理

### 核心问题已完成

条件：

* 无 P0；
* Audience 和 Countries 核心要求通过；
* 未触发永久失败标准；
* 日期、范围、summary/rows 和 Meta/Store 未出现核心回归。

处理：

```text
Code complete：PASS
下一步：进入 API 与数据一致性验收
```

### 存在 P0 或核心漏点

处理：

```text
Code complete：FAIL 或 PARTIAL
下一步：由 02｜开发指令生成 R5 补漏开发任务
```

不得直接进入 API 主验收。

### 只有非主链路小问题

条件：

* 不影响真实数据；
* 不影响日期、范围、summary/rows、Meta/Store；
* 不触发禁止项；
* 不影响 API 主验收。

处理：

```text
登记：Project Docs Backlog 或 R5 Backlog
Code complete：按正式证据判 PASS 或非阻断 PARTIAL
API 门禁：可开放
```

## 8. 禁止事项

* 不修改代码；
* 不新增功能；
* 不生成 R6 任务；
* 不部署 VPS；
* 不执行 Production；
* 不把 lint/build 当最终结论；
* 不把 c417 说成完整 CF3；
* 不把治理文档 commit 当功能代码；
* 不因非核心文档小问题阻断主线。
