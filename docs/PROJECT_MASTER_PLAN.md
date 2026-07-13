# Meta MCP 2.0 项目总体方案

版本：V1.0-Recovery
状态：生效前待提交
文档路径：`docs/PROJECT_MASTER_PLAN.md`
文档定位：Meta MCP 2.0 唯一长期项目总方案
维护主体：项目总控
最后更新：2026-07-13

---

# 1. 项目背景和最终目标

Meta MCP 2.0 用于解决 Meta 广告数据、店铺订单、商品和经营分析数据分散、日期与店铺范围不一致、不同页面无法直接对账、同步状态难以判断，以及代码完成与真实验收混写的问题。

项目最终目标是建立统一的业务分析平台，统一管理和分析：

* Meta 广告数据；
* Store 店铺订单与收入；
* Products 商品与订单明细；
* Audience；
* Countries；
* Campaign；
* Creative；
* Sync；
* Data Center；
* Audit；
* Project Docs。

最终所有业务页面和接口必须实现：

* 日期范围一致；
* `storeId` 范围一致；
* `summary` 与 `visible rows` 一致；
* 业务指标定义一致；
* Meta 数据与店铺订单明确分离；
* 同步状态正确；
* 页面展示与真实业务口径一致；
* 真实数据能够通过 Code、API、Browser、VPS 和 Production 分层验收。

店铺订单默认日期字段为：

```text
Order.store_local_date
```

---

# 2. 核心业务原则

## 2.1 日期一致

请求日期、实际应用日期、数据库日期字段、业务时区和页面显示日期必须一致。店铺订单默认使用 `Order.store_local_date`。

## 2.2 范围一致

所有 Store、Products、Countries、Audience 及相关汇总必须明确 `storeId`；Meta 模块必须明确 `accountId`。不得跨日期、`storeId` 或 `accountId` 复用数据。

## 2.3 汇总一致

`summary` 必须与当前业务范围内的 `visible rows` 使用相同日期、店铺、账户、数据源、过滤、支付、退款和去重规则。

## 2.4 数据源分离

Meta spend、Meta purchases 和 Meta purchase value 属于 Meta attribution 数据；Store orders 和 Store revenue 属于店铺订单数据。二者不得互相替代或混写。

## 2.5 状态真实

`RUNNING` 为中性状态，`NO_NEW_DATA` 为中性或成功状态，`PARTIAL_SUCCESS` 为 warning，true error 必须保持 error。

## 2.6 真实数据优先

禁止 mock、demo、fallback、legacy 主链路；禁止用旧周期数据、估算利润或错误兜底数据冒充当前真实数据。

## 2.7 分层完成

必须分别记录：

* `Code complete`
* `API complete`
* `Browser complete`
* `VPS complete`
* `Production complete`

commit、lint、build 或工具自报 PASS 不能代替真实验收。

---

# 3. 总体架构与正式模块

| 模块           | 核心职责                                  |
| ------------ | ------------------------------------- |
| Audience     | Meta 受众维度分析，并明确区分 Meta 指标与店铺订单指标      |
| Countries    | 店铺订单国家分析，国家范围以真实店铺订单或收入为准             |
| Campaign     | Meta Campaign 层级结构和表现分析               |
| Creative     | Meta 素材表现及素材与广告结构关系                   |
| Store        | 店铺订单、收入、AOV 和 all-store/per-store 分析  |
| Products     | 商品、订单明细、商品收入及真实成本与利润口径                |
| Sync         | 数据同步任务、范围、状态、增量同步和日志                  |
| Data Center  | 跨模块业务展示、日期范围、数据来源和同步入口                |
| Audit        | Code、API、日期、范围、summary/rows 和跨页面一致性审计 |
| Project Docs | 长期规则、总体方案、当前状态、路线图、重大决定和项目恢复          |

---

# 4. 模块之间的关系

1. Sync 将 Meta、店铺订单、商品和映射数据同步到系统。
2. Store、Products 和 Countries 共享统一的店铺订单业务规则。
3. Audience、Campaign 和 Creative 使用 Meta 数据，并明确 Meta attribution 口径。
4. Data Center 负责组合展示各模块结果，但不得改变各模块的数据源和业务定义。
5. Audit 对模块间日期、`storeId`、`accountId`、`summary`、`rows` 和状态语义进行独立检查。
6. Project Docs 负责记录长期方案、当前状态、阶段关系和重大决定，不替代代码或真实验收。

---

# 5. 主阶段总体定位

| 阶段 | 总体定位                            | 当前状态    |
| -- | ------------------------------- | ------- |
| R1 | 历史阶段目标和完成范围待根据可靠证据恢复            | 待确认     |
| R2 | 历史阶段目标和完成范围待根据可靠证据恢复            | 待确认     |
| R3 | 历史阶段目标和完成范围待根据可靠证据恢复            | 待确认     |
| R4 | 历史阶段目标和完成范围待根据可靠证据恢复            | 待确认     |
| R5 | 数据可信度、业务范围、同步状态、页面口径及真实验收闭环     | PARTIAL |
| R6 | 在 R5 统一可信基线完成后的下一阶段能力扩展，详细范围待确认 | BLOCKED |

当前主阶段为：

```text
R5
```

当前不得进入 R6，也不得声明 Production。

---

# 6. 项目完成度

## 6.1 Project Overall

```text
Project Overall：PARTIAL
```

## 6.2 Module Overall

| 模块           | Module Overall | 说明                                    |
| ------------ | -------------- | ------------------------------------- |
| Audience     | PARTIAL        | 最新指标命名补丁已提交，正式代码、API 和 Browser 验收未完成  |
| Countries    | PARTIAL        | store-only scope 补丁已提交，正式代码与真实数据验收未完成 |
| Campaign     | PARTIAL        | 模块已存在，但当前完整验收证据待恢复和补齐                 |
| Creative     | PARTIAL        | 模块已存在，真实 API 与 Browser 验收未闭环          |
| Store        | PARTIAL        | canonical query、支付、退款和去重规则尚未闭环        |
| Products     | PARTIAL        | `storeId`、订单口径和利润真实性风险尚未关闭            |
| Sync         | PARTIAL        | 同步链路已有基础，状态语义和真实页面验收未闭环               |
| Data Center  | PARTIAL        | 跨页面范围和汇总一致性仍需收口                       |
| Audit        | PARTIAL        | 已有审计基础，但存在 `FETCH_ERROR`、UTC 日期和矩阵不足  |
| Project Docs | PARTIAL        | WORKFLOW 已提交，其余治理文档本轮恢复、待提交           |

## 6.3 Stage Overall

```text
R5 Stage Overall：PARTIAL
```

---

# 7. 当前长期阻断项

当前长期阻断项沿用 `PROJECT_STATUS.md`：

* 缺少已验收通过的 canonical store-order query；
* payment status 规则未统一；
* refund 规则未统一；
* deduplication 规则未统一；
* Audience、Countries、Store、Products 的订单口径未完全统一；
* fabricated profit 风险未关闭；
* Products `storeId` 风险未关闭；
* Audit 遇到 `FETCH_ERROR` 时未形成可靠硬失败；
* Audit 默认 UTC 日期与业务日期可能不一致；
* 缺少 all-store/per-store 验收矩阵；
* 缺少 today/yesterday/7/14/30 日期矩阵；
* 最新功能 commit 尚未完成正式独立代码补验收；
* API、Browser、VPS 和 Production 尚未完成。

---

# 8. 当前阶段完成情况

当前治理基线：

* `docs/WORKFLOW.md` V2.0 已提交；
* `PROJECT_MASTER_PLAN.md`、`PROJECT_STATUS.md`、`ROADMAP.md`、`DECISIONS.md` 本轮恢复，待 GitHub 正式提交；
* 当前治理文档 head 为 `0399cd3a591ca2bca8c7080c02e548e8d9b918d6`；
* 当前待补验收功能 commit 为 `c417aadc724b56c09f5d3017e1915ebee20ee6f1`；
* 代码审计 base 为 `4e76d3785b0d357ec614ff2acfc3e34ba4cff64e`；
* compare 关系为 `ahead_by: 1`、`behind_by: 0`。

当前最新功能补丁只包含：

* Audience Meta 指标命名收紧；
* Countries store-only scope。

其状态为：

```text
已提交，正式代码验收待执行
```

不得将其视为完整 CF3、R5 完成或真实验收完成。

---

# 9. R5 收口条件

R5 只有在以下条件全部满足后才能收口：

1. 对最新功能 commit 完成独立代码闭环审计；
2. 核心业务问题无未解决 P0；
3. 日期、`storeId`、`accountId` 范围规则完成代码和 API 验证；
4. `summary` 与 `visible rows` 同口径；
5. Meta 数据与店铺订单明确分离；
6. payment、refund 和 deduplication 规则统一；
7. lastGoodData 不跨日期、店铺或账户复用；
8. 同步状态语义正确；
9. Audit 能对 `FETCH_ERROR` 形成失败结论，并使用正确业务日期；
10. all-store/per-store 和多日期矩阵完成；
11. `Code complete: PASS`；
12. `API complete: PASS`；
13. `Browser complete: PASS`；
14. `VPS complete: PASS`；
15. 正式文档和验收 Sources 已同步；
16. 项目总控正式开放下一阶段门禁。

---

# 10. R6 进入条件

进入 R6 必须同时满足：

* R5 Stage Overall 为 PASS；
* R5 所有强制门禁完成；
* 无未解决 P0；
* `PROJECT_MASTER_PLAN.md` 已确认 R6 总体方案；
* `ROADMAP.md` 已确认 R6 正式范围；
* `PROJECT_STATUS.md` 明确允许进入 R6；
* 项目总控正式宣布阶段切换。

当前：

```text
R6：BLOCKED
```

---

# 11. Production 进入条件

Production 只有在以下条件全部满足时才能进入或声明完成：

* 当前阶段正式收口；
* `Code complete: PASS`；
* `API complete: PASS`；
* `Browser complete: PASS`；
* `VPS complete: PASS`；
* 目标部署 SHA 已确认；
* VPS working tree clean；
* Production API、页面和核心业务数据已验证；
* 无服务器热修；
* 无未解决 P0；
* 回滚方案明确；
* `PROJECT_STATUS.md` 已记录 Production 门禁开放。

当前：

```text
Production：BLOCKED
```

---

# 12. 方案维护规则

`PROJECT_MASTER_PLAN.md` 是唯一长期项目总方案。

每轮正式验收结束后，项目总控必须检查以下内容是否变化：

* Project Overall；
* Module Overall；
* Stage Overall；
* 总体架构；
* 模块边界；
* 阶段目标；
* 长期阻断项。

只有总体方案或上述完成度发生实质变化时才更新本文件。当前任务、commit、短期风险或单次验收变化，应优先更新 `PROJECT_STATUS.md`。

任何重大方案调整必须先更新 `PROJECT_MASTER_PLAN.md`，必要时同步 `DECISIONS.md` 和 `ROADMAP.md`，再开始开发。

---

# 13. 版本记录

| 版本            | 日期         | 说明               |
| ------------- | ---------- | ---------------- |
| V1.0-Recovery | 2026-07-13 | 项目误删后的长期总体方案恢复基线 |
