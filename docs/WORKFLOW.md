# Meta MCP 2.0 项目工作手册

版本：V2.0
版本定位：最终长期版本
状态：生效
文档路径：`docs/WORKFLOW.md`

除非项目长期工作流程、治理体系或验收机制发生重大变化，否则本文件原则上不再修改。

---

# 0. 项目总目标

## 0.1 项目最终目标

Meta MCP 2.0 的最终目标是：

> 建立 Meta MCP 2.0 统一的数据分析平台。

平台必须统一管理、分析和展示以下业务数据与功能：

* Meta 广告数据；
* 店铺订单；
* 商品；
* Audience；
* Countries；
* Campaign；
* Creative；
* Store；
* 数据同步；
* 数据诊断。

最终必须实现：

* 所有页面日期一致；
* 所有页面 `storeId` 一致；
* 所有页面 `summary` 一致；
* 所有页面 `rows` 一致；
* 所有页面业务口径一致；
* 所有页面真实数据一致。

## 0.2 项目核心一致性目标

### 0.2.1 日期一致

所有涉及日期的业务页面、API、查询服务、审计脚本和验收工具，必须明确并统一：

* 请求日期；
* 实际应用日期；
* 业务时区；
* 数据库日期字段；
* today 和 yesterday 边界；
* 多日日期范围；
* 页面显示日期。

店铺订单默认使用：

```text
Order.store_local_date
```

不得用 UTC 日期、同步日期、创建日期或其他技术日期替代店铺订单业务日期，除非 `DECISIONS.md` 已正式批准例外。

### 0.2.2 storeId 一致

所有涉及店铺数据的页面和 API 必须明确：

* 请求的 `storeId`；
* 实际应用的 `storeId`；
* `storeId=all` 的业务范围；
* 单店铺的业务范围；
* 无效店铺的处理；
* 无订单店铺的处理；
* all-store 和 per-store 的汇总关系。

不得跨店铺混用数据。

### 0.2.3 summary 与 rows 一致

所有页面和 API 必须保证：

```text
summary
```

与当前业务范围内的：

```text
visible rows
```

使用相同的：

* 日期；
* `storeId`；
* `accountId`；
* 数据源；
* 支付状态；
* 退款规则；
* 去重规则；
* 过滤条件；
* 映射条件；
* 零值处理规则。

不得出现：

* summary 使用全量数据，rows 使用过滤后数据；
* summary 使用 all-store，rows 使用单店铺；
* summary 包含 rows 中不存在的数据；
* summary 使用不同日期字段；
* summary 和 rows 使用不同数据源。

### 0.2.4 业务口径一致

同一业务指标必须在不同页面使用相同定义。

必须明确区分：

```text
Meta spend
Meta impressions
Meta clicks
Meta purchases
Meta purchase value
Store orders
Store revenue
Store AOV
Store ROAS
```

不得：

* 用 Meta purchases 冒充店铺订单；
* 用 Meta purchase value 冒充店铺收入；
* 用店铺订单冒充 Meta attribution；
* 把不同来源的数据包装成同一业务指标；
* 用推算数据冒充真实业务数据。

### 0.2.5 真实数据一致

所有正式业务页面必须以真实数据为主链路。

禁止使用：

* mock 主链路；
* demo 主链路；
* fallback 主链路；
* legacy 主链路；
* 固定比例推算事实指标；
* 旧周期数据冒充当前周期；
* API 错误时返回旧数据并冒充当前数据；
* 无数据时自动填充历史数据。

## 0.3 项目总体模块

Meta MCP 2.0 的正式模块包括：

1. Audience；
2. Countries；
3. Campaign；
4. Creative；
5. Store；
6. Products；
7. Sync；
8. Data Center；
9. Audit；
10. Project Docs。

### 0.3.1 Audience

负责：

* Audience 维度分析；
* Meta 受众指标；
* 年龄、性别、国家等 breakdown；
* 明确区分 Meta 指标和店铺订单指标。

### 0.3.2 Countries

负责：

* 店铺订单国家分析；
* 收货国家或正式决定中的国家字段；
* 国家订单数；
* 国家订单收入；
* 与店铺订单范围一致的国家列表。

Countries 不得默认以 Meta-only 国家作为店铺订单国家。

### 0.3.3 Campaign

负责：

* Campaign 层级数据；
* 广告花费；
* 展示；
* 点击；
* Meta attribution；
* Campaign 与账户、AdSet、Ad 的结构关系。

### 0.3.4 Creative

负责：

* Creative 层级分析；
* 素材表现；
* Meta spend；
* Meta purchases；
* Meta purchase value；
* 素材和广告结构映射。

Creative 的 Meta purchases 不得直接当作店铺订单。

### 0.3.5 Store

负责：

* 店铺级订单；
* 店铺收入；
* 店铺 AOV；
* 店铺范围；
* all-store 和 per-store 汇总。

### 0.3.6 Products

负责：

* 商品订单；
* 商品收入；
* 商品 line items；
* 商品与店铺关系；
* 商品维度汇总；
* 产品成本和利润的真实业务口径。

不得在没有真实成本数据时生成虚构利润。

### 0.3.7 Sync

负责：

* 数据同步任务；
* 同步链路；
* 同步状态；
* 同步范围；
* 增量同步；
* 任务诊断；
* 同步日志。

### 0.3.8 Data Center

负责：

* 数据中心页面；
* 跨模块数据展示；
* 页面日期和范围；
* 数据健康状态；
* 数据来源说明；
* 同步入口。

Data Center 业务页面不得默认暴露后端技术 key。

### 0.3.9 Audit

负责：

* 数据一致性审计；
* 日期矩阵；
* `storeId` 矩阵；
* summary/rows 对账；
* API 状态；
* 禁止写法检查；
* 验收报告生成。

Audit 失败不得被包装成 PASS。

### 0.3.10 Project Docs

负责：

* 长期工作规则；
* 项目总体方案；
* 当前真实状态；
* 未来阶段规划；
* 重大决定；
* 项目恢复和交接。

## 0.4 模块统一规则

所有模块必须遵守统一业务口径。

任何模块不得自行定义与其他模块冲突的：

* 日期规则；
* `storeId` 规则；
* 支付状态规则；
* 退款规则；
* 去重规则；
* summary 规则；
* rows 规则；
* 数据源规则；
* Meta 指标命名；
* 店铺订单指标命名。

如确需新增或调整长期业务规则，必须先进入 `DECISIONS.md`；如影响总体方案，必须先更新 `PROJECT_MASTER_PLAN.md`。

---

# 1. 文档定位与最高原则

## 1.1 文档定位

本手册是 Meta MCP 2.0 项目的长期运行规范，统一约束：

* 项目聊天窗口；
* 项目 Sources；
* GitHub 分支、commit 和代码；
* 开发任务生成；
* 代码审查；
* API 验收；
* 浏览器验收；
* VPS 部署与验收；
* Production 发布；
* 项目状态更新；
* 项目完成度更新；
* 阶段收口；
* 项目恢复；
* 聊天交接。

本手册不保存：

* 当前项目状态；
* 当前 commit；
* 当前风险；
* 当前任务；
* 当前阶段完成度；
* 单次开发记录；
* 单次验收结果；
* 临时服务器信息。

## 1.2 适用对象

以下所有参与者都必须遵守本手册：

* 项目负责人；
* 项目总控；
* 开发人员；
* Codex 或其他代码执行工具；
* ChatGPT 项目聊天窗口；
* 代码审查人员；
* API 验收人员；
* 浏览器验收人员；
* VPS 部署和验收人员；
* 后续接手项目的新人或 AI。

任何参与者不得自行降低验收标准或绕过阶段门禁。

## 1.3 真实证据优先

所有正式结论必须由可追溯证据支持。

可接受证据包括：

* GitHub 实际 commit；
* commit compare；
* 实际代码；
* grep 输出；
* lint 和 build 输出；
* 真实 API 返回；
* 浏览器截图；
* VPS commit SHA；
* VPS clean working tree；
* PM2 日志；
* Production 页面；
* Production 业务数据验证。

无法确认的内容必须写：

```text
待确认
```

不得根据记忆、旧聊天、预计或开发人员描述自行补全事实。

## 1.4 代码完成与真实验收分开

任何任务必须分别记录：

```text
Code complete
API complete
Browser complete
VPS complete
Production complete
```

这些状态互不替代。

例如：

* `Code complete: PASS` 不代表 `API complete: PASS`；
* `API complete: PASS` 不代表 `Browser complete: PASS`；
* 本地浏览器通过不代表 VPS 浏览器通过；
* VPS 部署成功不代表 Production complete；
* commit 已合并不代表阶段完成。

## 1.5 lint、build 和自报 PASS 不是最终完成

以下结果不能单独作为最终完成依据：

* `npm run lint` 通过；
* `npm run build` 通过；
* audit 脚本退出成功；
* commit 已创建；
* commit 已合并；
* Codex 自报 PASS；
* 开发人员自报完成；
* 文档已更新；
* 页面没有报错；
* API 返回 HTTP 200；
* VPS 服务成功启动。

这些只能作为局部证据。

## 1.6 业务数据必须真实

禁止为了页面好看而生成、推测或补齐业务事实。

特别禁止：

* 固定比例推算利润后冒充真实利润；
* 用 Meta purchases 冒充店铺订单；
* 用 Meta purchase value 冒充店铺收入；
* 用旧日期数据冒充当前日期；
* 用 mock、demo、fallback 或 legacy 数据补正常主链路；
* 把 API 错误包装成无数据；
* 把无数据包装成错误；
* 用 `0` 对 `0` 自动证明一致。

## 1.7 正式状态值

正式状态只能使用：

```text
PASS
PARTIAL
FAIL
NOT RUN
BLOCKED
```

| 状态      | 含义                 |
| ------- | ------------------ |
| PASS    | 本环节全部完成，并有充分证据     |
| PARTIAL | 已完成部分要求，但仍有明确漏点    |
| FAIL    | 存在核心问题、失败证据或触发失败标准 |
| NOT RUN | 尚未运行               |
| BLOCKED | 前置条件未满足，不允许运行      |

不得使用：

* 基本完成；
* 大概通过；
* 应该没问题；
* 差不多完成；
* 整体完成 80%。

---

# 2. 项目事实来源与正式文档体系

## 2.1 事实来源优先级

发生信息冲突时，按以下顺序判断：

1. 最新真实验收证据；
2. GitHub 实际代码和 commit；
3. `PROJECT_STATUS.md`；
4. `DECISIONS.md`；
5. 当前正式开发指令；
6. `ROADMAP.md`；
7. 项目 Sources；
8. 历史聊天和旧预计。

项目恢复时的文档读取顺序，不改变本事实优先级。

## 2.2 当前任务范围

当前任务的以下内容，以最新正式开发指令为准：

* 修改目标；
* 允许修改文件；
* 禁止修改文件；
* 是否允许新增文件；
* API 验收要求；
* 页面验收要求；
* grep 要求；
* 失败标准；
* 本轮不做什么。

开发指令不能覆盖已经产生的最新真实验收结论。

## 2.3 当前完成状态

当前项目完成状态，以以下两项为准：

1. 最新真实验收证据；
2. `PROJECT_STATUS.md`。

如二者冲突：

* 以最新真实验收证据为准；
* 必须更新 `PROJECT_STATUS.md`；
* 更新前必须明确标记状态文件已过期。

## 2.4 正式项目文档体系

正式项目文档统一存放在：

```text
docs/
```

正式文件包括：

```text
docs/
├── WORKFLOW.md
├── PROJECT_MASTER_PLAN.md
├── PROJECT_STATUS.md
├── ROADMAP.md
└── DECISIONS.md
```

## 2.5 WORKFLOW.md

`WORKFLOW.md` 负责长期工作规则。

包括：

* 事实来源；
* 开发流程；
* 验收流程；
* 阶段门禁；
* 项目恢复；
* 聊天交接；
* 部署流程；
* 状态同步；
* 完成度同步；
* 禁止项；
* 正式例外。

`WORKFLOW.md` 不保存项目当前状态。

不得长期保存：

* 当前 commit；
* 当前任务；
* 当前风险；
* 当前完成度；
* 当前 API 结果；
* 当前浏览器结果；
* 当前 VPS 状态。

## 2.6 PROJECT_MASTER_PLAN.md

`PROJECT_MASTER_PLAN.md` 是唯一长期项目方案。

负责记录：

* 项目总体目标；
* 项目总体方案；
* 总体架构；
* 模块定义；
* 模块依赖；
* Project Overall；
* Module Overall；
* Stage Overall；
* 当前阶段完成情况；
* 长期方案边界。

`PROJECT_MASTER_PLAN.md` 不保存临时开发记录。

不得保存：

* 单次调试过程；
* 临时 grep 输出；
* 单次 lint/build 记录；
* 普通 bug 处理过程；
* 未收口的聊天讨论；
* 单次 API 返回。

## 2.7 PROJECT_STATUS.md

`PROJECT_STATUS.md` 负责记录当前真实状态。

至少包括：

* 当前主阶段；
* 当前子任务；
* 当前 branch；
* base/head；
* 最新 commit；
* 当前风险；
* 当前阻断项；
* Code complete；
* API complete；
* Browser complete；
* VPS complete；
* Production complete；
* 当前阶段门禁；
* 当前唯一下一步。

`PROJECT_STATUS.md` 不保存长期规则。

## 2.8 ROADMAP.md

`ROADMAP.md` 负责未来阶段规划。

包括：

* 未来主阶段；
* 阶段顺序；
* 阶段依赖；
* 阶段目标；
* 预计进入条件；
* 阶段冻结或取消。

`ROADMAP.md` 不保存当前完成度。

当前完成度必须记录在：

* `PROJECT_STATUS.md`；
* `PROJECT_MASTER_PLAN.md`。

## 2.9 DECISIONS.md

`DECISIONS.md` 负责重大业务和架构决定。

包括：

* 日期业务口径；
* 店铺订单规则；
* 支付状态规则；
* 退款规则；
* 去重规则；
* 数据源选择；
* AI 权限边界；
* 架构方向；
* 正式例外；
* 废弃方案；
* 长期规则变更。

`DECISIONS.md` 不保存普通开发进度。

每条决定必须包含：

* 决定日期；
* 决定内容；
* 决定原因；
* 影响范围；
* 是否替代旧决定；
* 相关任务或 commit；
* 批准人。

## 2.10 项目 Sources

项目 Sources 用于保存：

* 聊天交接；
* 正式验收报告；
* API 输出；
* audit 输出；
* 浏览器截图；
* VPS 截图；
* 日志；
* 历史方案；
* 任务原文；
* 部署记录。

Sources 是证据库，不自动等于当前状态。

## 2.11 GitHub 的角色

GitHub 是以下事实的主要来源：

* branch；
* commit；
* base/head；
* compare；
* 变更文件；
* 实际代码；
* 正式项目文档；
* CI 状态。

GitHub 不能单独证明：

* API 已通过；
* 浏览器已通过；
* VPS 已通过；
* Production 已完成。

## 2.12 文档生命周期

| 文档                       | 生命周期       |
| ------------------------ | ---------- |
| `WORKFLOW.md`            | 长期稳定，一般不修改 |
| `PROJECT_MASTER_PLAN.md` | 持续更新       |
| `PROJECT_STATUS.md`      | 持续更新       |
| `ROADMAP.md`             | 按阶段更新      |
| `DECISIONS.md`           | 按重大决定更新    |

除非长期工作流程发生重大变化，否则原则上不再修改 `WORKFLOW.md`。

---

# 3. 项目恢复、聊天角色与交接规则

## 3.1 项目恢复顺序

任何聊天、任何 AI、任何 Codex、任何新人恢复项目时，必须按以下顺序读取：

```text
WORKFLOW
↓
PROJECT_MASTER_PLAN
↓
PROJECT_STATUS
↓
ROADMAP
↓
DECISIONS
↓
GitHub
↓
Sources
↓
历史聊天
```

完整路径对应：

1. `docs/WORKFLOW.md`；
2. `docs/PROJECT_MASTER_PLAN.md`；
3. `docs/PROJECT_STATUS.md`；
4. `docs/ROADMAP.md`；
5. `docs/DECISIONS.md`；
6. GitHub 当前仓库、branch、base、head 和代码；
7. 项目 Sources；
8. 历史聊天。

不得直接依赖历史聊天恢复项目。

读取顺序用于恢复项目上下文，发生事实冲突时仍按第 2 章事实来源优先级处理。

## 3.2 恢复后必须确认

开始任何正式工作前，必须确认：

* 项目最终目标；
* 当前总体方案；
* 当前模块完成度；
* 当前主阶段；
* 当前子任务；
* 当前 branch；
* 当前 base/head；
* 当前五类完成状态；
* 当前风险；
* 当前阻断项；
* 当前阶段门禁；
* 当前唯一下一步；
* 当前允许做什么；
* 当前禁止做什么。

## 3.3 聊天窗口基本定位

聊天窗口是项目工作的现场，不是唯一事实来源。

聊天窗口可以：

* 分析需求；
* 生成开发指令；
* 审查 commit；
* 验收 API；
* 验收页面；
* 规划部署；
* 整理项目状态；
* 发现风险；
* 生成正式文档更新内容。

重要结论必须回写到正式文档或 Sources。

## 3.4 项目总控窗口职责

项目总控窗口唯一负责：

* 项目总体方案；
* 项目总体完成度；
* 模块完成度；
* 阶段完成度；
* 阶段推进；
* 阶段门禁；
* 正式状态；
* 当前唯一下一步；
* 正式项目文档同步判断；
* 开发、代码验收、API、Browser、VPS 和 Production 结果收口。

项目总控窗口不替代：

* 实际开发；
* 独立 commit 验收；
* 真实 API 验收；
* 浏览器截图验收；
* VPS 部署验收。

## 3.5 其他窗口权限边界

开发、代码审计、API、Browser、VPS 等其他窗口可以：

* 提供证据；
* 提供本环节 PASS、PARTIAL 或 FAIL；
* 提出风险；
* 建议更新完成度；
* 建议是否允许进入下一环节。

其他窗口不得：

* 直接修改项目总体完成度；
* 直接修改模块总体完成度；
* 直接宣布进入下一主阶段；
* 直接宣布 R6 或 Production；
* 直接改变总体方案；
* 将自身环节 PASS 当作项目整体 PASS。

最终状态由项目总控收口，并写入正式文档。

## 3.6 开发指令窗口

负责：

* 读取正式文档；
* 对齐当前任务；
* 生成正式开发指令；
* 明确文件范围；
* 明确验收要求；
* 明确失败标准；
* 防止范围漂移。

## 3.7 GitHub 代码审计窗口

负责：

* compare commit；
* 逐文件检查；
* 逐问题检查；
* grep；
* 关键逻辑检查；
* Code complete 判定。

## 3.8 API 与浏览器验收窗口

负责：

* 本地 API 验收；
* 数据一致性对账；
* 浏览器页面验收；
* 页面截图；
* 页面问题记录。

## 3.9 VPS 部署验收窗口

负责：

* VPS 部署；
* commit SHA 核对；
* clean working tree；
* VPS API；
* VPS Browser；
* 日志；
* 部署证据。

## 3.10 “新服务器部署指南”的过渡期角色

“新服务器部署指南”可在过渡期继续推进已经开始的任务。

长期职责为：

* VPS 环境说明；
* 标准部署操作入口；
* VPS API 验收入口；
* VPS Browser 验收入口；
* 部署证据记录。

它不能独自决定：

* 项目总体完成度；
* 阶段完成；
* 总体方案；
* Production complete。

过渡期是否结束，由 `PROJECT_STATUS.md` 记录。

## 3.11 聊天达到上限时的交接

聊天达到上限或必须更换窗口时，必须：

1. 完成当前任务收口；
2. 停止新增无关工作；
3. 确认当前阶段和任务；
4. 确认 branch、base、head；
5. 整理已完成内容；
6. 整理未完成内容；
7. 整理已验证项目；
8. 整理未验证项目；
9. 整理 P0、P1 风险；
10. 整理阶段门禁；
11. 更新 `PROJECT_STATUS.md`；
12. 如涉及完成度，更新 `PROJECT_MASTER_PLAN.md`；
13. 如涉及阶段推进，更新 `ROADMAP.md`；
14. 如涉及长期决定，更新 `DECISIONS.md`；
15. 保存 Sources；
16. 生成标准聊天交接；
17. 新聊天按恢复顺序继续；
18. 原窗口停止产生新的正式项目结论。

不得让聊天成为唯一事实来源。

## 3.12 聊天结论回写规则

| 聊天中产生的内容    | 正式保存位置                   |
| ----------- | ------------------------ |
| 长期工作规则      | `WORKFLOW.md`            |
| 项目总体方案      | `PROJECT_MASTER_PLAN.md` |
| 总体、模块、阶段完成度 | `PROJECT_MASTER_PLAN.md` |
| 当前真实状态      | `PROJECT_STATUS.md`      |
| 未来阶段        | `ROADMAP.md`             |
| 重大业务或架构决定   | `DECISIONS.md`           |
| 验收报告        | Sources                  |
| API 输出      | Sources                  |
| Browser 截图  | Sources                  |
| VPS 证据      | Sources                  |
| 普通讨论        | 可保留聊天，不作为唯一事实            |

---

# 4. 项目阶段、任务编号与阶段门禁

## 4.1 主阶段编号

主阶段使用：

```text
R1
R2
R3
R4
R5
R6
...
```

只有同时满足以下条件时，才能新建主阶段：

* 前一主阶段已正式收口或正式冻结；
* 新目标与前阶段存在明确边界；
* `PROJECT_MASTER_PLAN.md` 已包含相关总体方案；
* `ROADMAP.md` 已记录该阶段；
* `PROJECT_STATUS.md` 已允许进入；
* 阶段目标和完成标准明确。

## 4.2 子任务编号

子任务使用：

```text
R5-RCA
R5-ROOT-FIX
R5-UX-SCOPE-SYNC
```

名称必须反映真实目标。

不得只使用：

```text
FIX
UPDATE
FINAL
NEW
```

## 4.3 补漏任务编号

同一任务验收后发现遗漏时，使用：

```text
-CF
-CF2
-CF3
```

例如：

```text
R5-ROOT-FIX-CF
R5-UX-SCOPE-SYNC-CF2
```

以下情况应使用补漏任务：

* 原任务核心目标未完全完成；
* 验收发现漏点；
* 代码方向正确但仍有遗漏；
* 需要补齐 API、页面或状态分支；
* 需要修复同一问题链路。

不得通过新建阶段掩盖旧阶段失败。

## 4.4 阶段和任务记录位置

* 当前阶段和当前任务：`PROJECT_STATUS.md`；
* 阶段总体完成情况：`PROJECT_MASTER_PLAN.md`；
* 未来阶段：`ROADMAP.md`；
* 重大阶段调整：`DECISIONS.md`；
* 阶段工作规则：`WORKFLOW.md`。

## 4.5 阶段门禁顺序

```text
总体方案确认
→ 正式任务明确
→ 开发执行
→ Commit 与代码验收
→ 本地 API 验收
→ 本地 Browser 验收
→ VPS 部署
→ VPS API 验收
→ VPS Browser 验收
→ Production 验收
→ 阶段收口
→ 进入下一阶段
```

任何环节不得默认跳过。

## 4.6 进入代码验收

必须具备：

* 正式开发指令；
* 明确 base；
* 明确 head；
* commit 已存在；
* 开发交付说明；
* 实际变更文件可读取。

## 4.7 进入本地 API 验收

必须具备：

* Code complete 没有 P0 核心失败；
* 服务可运行；
* 数据源可访问；
* API 验收矩阵已定义。

## 4.8 进入本地 Browser 验收

必须具备：

* 关键 API 已通过；
* 前端可运行；
* 页面清单明确；
* 日期、店铺和账户范围明确。

## 4.9 进入 VPS 验收

必须具备：

* Code complete 允许进入；
* 本地 API 通过；
* 本地 Browser 通过；
* GitHub commit 已存在；
* 目标 SHA 明确；
* `PROJECT_STATUS.md` 允许部署。

## 4.10 进入下一主阶段

必须具备：

* 当前阶段强制门禁通过；
* 无未处理 P0；
* 阶段正式收口；
* `PROJECT_MASTER_PLAN.md` 已更新阶段完成度；
* `PROJECT_STATUS.md` 已允许进入；
* `ROADMAP.md` 中下一阶段有效；
* 项目总控正式宣布门禁开放。

## 4.11 阻断规则

以下情况必须阻断：

* 核心业务口径不一致；
* API 失败；
* 页面仍复现核心问题；
* VPS SHA 不明确；
* 存在服务器热修；
* Production 数据不可信；
* 重大决定未记录；
* 当前状态与证据冲突；
* P0 未解决；
* 总体方案尚未更新；
* 非项目总控窗口擅自宣布阶段推进。

阻断状态：

```text
BLOCKED
```

---

# 5. 开发任务流程

## 5.1 开发任务启动前

项目总控必须读取并对齐：

* 用户需求；
* `WORKFLOW.md`；
* `PROJECT_MASTER_PLAN.md`；
* `PROJECT_STATUS.md`；
* `ROADMAP.md`；
* `DECISIONS.md`；
* 相关 Sources；
* GitHub 当前代码；
* 当前 base/head；
* 前一轮验收结论；
* 前一轮漏点。

## 5.2 重大方案调整前置规则

任何重大方案调整必须：

1. 先修改 `PROJECT_MASTER_PLAN.md`；
2. 必要时更新 `DECISIONS.md`；
3. 必要时更新 `ROADMAP.md`；
4. 项目负责人审核；
5. 通过 GitHub commit 正式保存；
6. 再生成开发任务；
7. 再开始开发。

不得先开发，再倒推总体方案。

重大方案调整包括：

* 模块边界变化；
* 核心数据源变化；
* 总体架构变化；
* 业务口径变化；
* 主阶段目标变化；
* 新增长期模块；
* 删除长期模块；
* 关键同步链路变化；
* 数据库方向变化；
* AI 权限变化。

## 5.3 正式开发指令必须包含

* 项目名称；
* 任务编号；
* 任务名称；
* base commit；
* 本轮目标；
* 本轮只做什么；
* 本轮不做什么；
* 允许修改文件；
* 禁止修改文件；
* 是否允许新增文件；
* 每个文件独立要求；
* 当前问题；
* 修复位置；
* 旧逻辑风险；
* 怎么修；
* 必须复用的公共逻辑；
* 参考代码；
* 禁止写法；
* grep 要求；
* API 要求；
* Browser 要求；
* 失败标准；
* lint/build 要求；
* commit message；
* 交付内容。

不得使用“同上”代替独立文件要求。

## 5.4 文件修改范围

开发只能修改正式指令允许的文件。

如需额外文件，必须先说明：

* 文件路径；
* 必须修改的原因；
* 不修改的影响；
* 是否直接依赖；
* 是否触及禁止项；
* 是否扩大业务范围。

未授权前不得修改。

## 5.5 新增文件规则

只有开发指令明确允许时才能新增。

必须说明：

* 文件用途；
* 现有文件为何不能承载；
* 是否引入新主链路；
* 是否加入验收；
* 是否影响总体方案；
* 是否需要更新正式文档。

## 5.6 开发执行规则

开发必须：

1. 基于指定 base；
2. 不混入其他任务；
3. 不只修改文案掩盖逻辑；
4. 不隐藏组件伪装修复；
5. 不恢复废弃主链路；
6. 不新增 mock 或 fallback 主数据；
7. 不让 GET 页面接口写业务数据；
8. 不同步前清空事实数据；
9. 不在 VPS 修改源码；
10. 不修改永久禁止文件；
11. 保持日期、`storeId`、`accountId` 明确；
12. 保持 Meta 与店铺数据分离；
13. 处理 catch、empty 和中性状态；
14. 防止 `lastGoodData` 跨范围复用；
15. 保证 summary 与 visible rows 一致。

## 5.7 开发中的状态说明

开发人员可以报告：

```text
实现中
代码完成
lint 通过
build 通过
commit 已创建
```

不得自行宣布：

```text
最终 PASS
项目完成
阶段完成
Browser complete
VPS complete
Production complete
```

## 5.8 开发交付要求

必须提供：

* branch；
* base；
* head；
* commit message；
* 实际变更文件；
* 新增文件；
* 禁止文件确认；
* lint；
* build；
* 已实现内容；
* 未实现内容；
* 未运行项目；
* 已知风险；
* 自测结果；
* 重点验收内容。

---

# 6. Commit 与代码验收流程

## 6.1 正式验收顺序

1. 对齐任务原文；
2. 对齐 `WORKFLOW.md`；
3. 对齐 `PROJECT_MASTER_PLAN.md`；
4. 对齐 `PROJECT_STATUS.md`；
5. 对齐相关 `DECISIONS.md`；
6. 确认 base；
7. 确认 head；
8. compare commits；
9. 检查 `ahead_by`；
10. 检查 `behind_by`；
11. 检查实际文件；
12. 检查遗漏文件；
13. 检查额外文件；
14. 检查禁止文件；
15. 逐文件验收；
16. 逐问题验收；
17. grep；
18. 关键逻辑验收；
19. 失败标准核对；
20. 输出判定；
21. 检查正式文档是否需要更新。

不得只检查 lint 和 build。

## 6.2 Commit 对齐要求

必须明确：

```text
branch:
base:
head:
ahead_by:
behind_by:
commit message:
变更文件:
新增文件:
遗漏文件:
额外文件:
是否修改禁止文件:
是否基于正确 base:
```

以下情况不能 PASS：

* base 错误；
* head 不明确；
* `behind_by` 异常且无解释；
* 存在未授权文件；
* 遗漏要求文件；
* 修改永久禁止文件；
* 只更新 docs 但任务要求代码；
* commit 混入其他任务。

## 6.3 逐文件验收

每个文件必须说明：

* 文件路径；
* 指令要求；
* 原有问题；
* 修改位置；
* 实际代码；
* 公共逻辑复用；
* 旧逻辑风险；
* 是否完成；
* 漏点；
* 风险；
* 证据。

禁止只写：

```text
已修改
已覆盖
代码正常
build 通过
```

## 6.4 逐问题验收

必须检查：

* catch；
* empty；
* `RUNNING`；
* `NO_NEW_DATA`；
* `PARTIAL_SUCCESS`；
* true error；
* 中性状态是否显示失败；
* `lastGoodData` 是否跨日期；
* 是否跨 `storeId`；
* 是否跨 `accountId`；
* 是否显示旧周期；
* summary/rows；
* Meta/店铺分离；
* API error 是否包装成无数据；
* 无数据是否包装成失败；
* 是否新增推测指标；
* 是否引入页面回归。

## 6.5 grep 验收

### 正向关键代码

用于确认：

* 公共函数已调用；
* 状态分支已落地；
* `storeId` 已贯通；
* 日期字段已使用；
* 范围守护生效。

### 禁止写法

至少检查：

```text
mock
demo
fallback
legacy
display:none
deleteMany
prisma.*.create
prisma.*.update
prisma.*.upsert
```

### 状态分支

检查：

```text
RUNNING
NO_NEW_DATA
PARTIAL_SUCCESS
FAILED
ERROR
```

### 技术 key

检查：

```text
issueId
ACC_ACT
acc_act
STORE_1
store_1
data_health
mapping
```

所有 grep 命中必须解释上下文。

## 6.6 关键业务逻辑验收

### 日期

检查：

* 请求日期；
* 应用日期；
* 店铺本地日期；
* 时区；
* today/yesterday；
* 旧周期缓存。

默认店铺订单日期：

```text
Order.store_local_date
```

### 店铺范围

检查：

* `storeId=all`；
* 单店铺；
* 空店铺；
* 不存在店铺；
* 请求范围和应用范围。

### 账户范围

检查：

* `accountId`；
* 多账户；
* 未映射账户；
* 账户名称；
* 技术 key。

### 汇总和明细

检查：

* summary；
* 返回 rows；
* visible rows；
* 过滤后总计；
* 排序；
* 分页。

### Meta 与店铺数据

明确区分：

```text
Meta spend
Meta purchases
Meta purchase value
Store orders
Store revenue
Store AOV
Store ROAS
```

## 6.7 Code complete 判定

### PASS

必须全部满足：

* 文件范围正确；
* 要求文件全部完成；
* 无未授权文件；
* 无永久禁止文件；
* 核心问题修复；
* grep 通过；
* 无新增高风险逻辑；
* 未触发失败标准；
* 代码验证完成。

### PARTIAL

适用于：

* 大部分完成；
* 存在明确漏点；
* 非核心问题未完成；
* 某些要求未验证；
* 未触发核心 FAIL。

### FAIL

任一情况必须 FAIL：

* 核心问题未修；
* 修改禁止文件；
* base 错误；
* 引入高风险逻辑；
* 中性状态仍显示失败；
* `lastGoodData` 跨范围；
* Meta 与店铺混用；
* 只改文档或表面文案；
* 隐藏方式伪装修复；
* 恢复 mock/demo/fallback/legacy；
* GET 页面接口写库；
* 同步前 `deleteMany`；
* 添加伪造指标；
* 与任务核心目标不一致。

## 6.8 Code complete 的边界

代码验收只能更新：

```text
Code complete
```

不得自动更新：

```text
API complete
Browser complete
VPS complete
Production complete
```

---

# 7. API、Browser、VPS 与 Production 验收流程

## 7.1 本地 API 验收前置条件

必须确认：

* Code complete 允许进入；
* 本地服务可运行；
* 数据源可访问；
* 目标 commit 明确；
* 日期明确；
* 店铺明确；
* API 清单明确。

## 7.2 日期矩阵

原则上必须覆盖：

```text
today
yesterday
past_7
past_14
past_30
```

涉及美国业务默认时区：

```text
America/Los_Angeles
```

除非 `DECISIONS.md` 有其他正式决定。

## 7.3 店铺矩阵

必须覆盖：

```text
storeId=all
每个有效 storeId
```

不得只验证 all-store 后宣布逐店铺一致。

## 7.4 API 必查内容

每个 API 至少检查：

* HTTP 状态；
* 请求日期；
* 应用日期；
* 请求 `storeId`；
* 应用 `storeId`；
* 请求 `accountId`；
* 应用 `accountId`；
* summary；
* rows；
* summary/rows 合计；
* 空数据；
* 错误状态；
* 数据源；
* 同步状态；
* trace。

## 7.5 API 失败规则

以下必须 FAIL：

* `FETCH_ERROR`；
* HTTP error；
* 日期不一致；
* `storeId` 不一致；
* summary 与 visible rows 不一致；
* 同口径页面不一致；
* 应有数据却无理由返回 0；
* API error 包装成无数据；
* 无数据包装成系统错误；
* 报告未真实连接 API。

以下不能 PASS：

* 0 对 0；
* 任一侧为 0 后返回 `N/A`；
* 脚本退出成功但 API 失败；
* 只验证一个日期；
* 只验证 all-store；
* 只验证 HTTP 200。

## 7.6 本地 Browser 验收前置条件

必须确认：

* 关键 API 通过；
* 前端可运行；
* 页面清单明确；
* 日期明确；
* 店铺和账户范围明确；
* 截图要求明确。

## 7.7 每个页面必须检查

* 应看到什么；
* 不应看到什么；
* KPI 名称；
* KPI 业务口径；
* 日期选择；
* `storeId`；
* `accountId`；
* 空数据；
* 错误状态；
* 同步状态；
* `RUNNING`；
* `NO_NEW_DATA`；
* `PARTIAL_SUCCESS`；
* true error；
* 旧周期数据；
* 加载状态；
* 技术 key；
* 说明框；
* 表格；
* 图表；
* 常用分辨率；
* 其他页面回归。

## 7.8 Browser 截图要求

截图必须证明：

* 当前页面；
* 当前日期；
* 当前店铺或账户；
* 当前 KPI；
* 当前状态；
* 验收结果。

截图必须记录：

* 日期；
* 环境；
* commit SHA；
* 页面路径；
* 操作步骤；
* 验收结论。

## 7.9 VPS 允许操作

```text
git fetch
git reset
git checkout 已存在 commit 或 branch
npm install
npm ci
prisma generate
npm run lint
npm run build
pm2 restart
查看日志
调用只读 API
页面截图
浏览器验收
```

## 7.10 VPS 禁止操作

禁止：

* 编辑源码；
* 修改 `dist`；
* 修改 `node_modules`；
* `sed`、`vim`、`nano` 热修；
* 手工补丁；
* 手工修改业务数据；
* 创建未提交差异；
* 在 VPS 创建新 commit；
* 先改 Production 再补 GitHub；
* 绕过本地验收部署。

## 7.11 VPS 部署流程

1. 确认允许进入 VPS；
2. 记录 branch；
3. 记录目标 SHA；
4. `git fetch`；
5. checkout/reset；
6. `git rev-parse HEAD`；
7. `git status --short`；
8. 确认 clean；
9. 安装依赖；
10. `prisma generate`；
11. lint；
12. build；
13. PM2 restart；
14. 查看新日志；
15. 调用只读 API；
16. Browser 验收；
17. 保存证据；
18. 更新正式状态。

需要修改源码时，必须停止并返回开发流程。

## 7.12 VPS API 验收

必须重新执行适用的本地 API 矩阵。

额外确认：

* VPS SHA；
* 环境变量；
* 数据库连接；
* VPS 时区；
* PM2；
* API 地址；
* 日志；
* 与本地数据差异。

## 7.13 VPS Browser 验收

必须检查：

* 页面访问；
* 静态资源；
* API；
* 日期；
* 店铺；
* 同步按钮；
* 状态提示；
* 缓存；
* VPS 专属错误；
* 页面截图。

不得用本地截图替代 VPS 截图。

## 7.14 Production complete

只有以下全部满足才能 PASS：

* `Code complete: PASS`；
* `API complete: PASS`；
* `Browser complete: PASS`；
* `VPS complete: PASS`；
* 部署 SHA 已记录；
* working tree clean；
* Production API 已验证；
* Production 页面已验证；
* 核心业务数据已验证；
* 无未解决 P0；
* 无服务器热修；
* 回滚方案明确；
* 正式文档已更新。

Production 验收必须单独记录。

---

# 8. 项目完成度、状态同步与任务收口

## 8.1 统一完成度维度

项目完成度统一使用以下维度：

```text
Project Overall
Module Overall
Stage Overall
Code complete
API complete
Browser complete
VPS complete
Production complete
```

## 8.2 Project Overall

`Project Overall` 表示整个 Meta MCP 2.0 项目的总体完成状态。

只能使用：

```text
PASS
PARTIAL
FAIL
NOT RUN
BLOCKED
```

不得写：

```text
整体完成 80%
项目完成 70%
差不多完成
```

除非未来建立正式、可审计、具备计算规则的百分比体系，并通过 `DECISIONS.md` 批准。

## 8.3 Module Overall

`Module Overall` 表示单个正式模块的总体完成状态。

必须分别记录：

* Audience；
* Countries；
* Campaign；
* Creative；
* Store；
* Products；
* Sync；
* Data Center；
* Audit；
* Project Docs。

每个模块只能使用正式状态值。

## 8.4 Stage Overall

`Stage Overall` 表示当前主阶段的总体状态。

例如：

```text
R5 Stage Overall: PARTIAL
```

不得因为某一个 commit PASS 就将整个 Stage Overall 更新为 PASS。

## 8.5 五类执行完成状态

每个任务和阶段必须分别记录：

```text
Code complete
API complete
Browser complete
VPS complete
Production complete
```

不得混写为单一“已完成”。

## 8.6 PROJECT_STATUS.md 更新流程

`PROJECT_STATUS.md` 不由 AI、聊天、Codex 或脚本自动成为正式版本。

流程：

1. 项目总控依据证据生成更新内容；
2. 项目负责人审核；
3. 通过 GitHub commit 写入；
4. 新 commit 成为正式状态；
5. 后续窗口读取正式版本。

## 8.7 必须检查 PROJECT_STATUS.md 的情况

以下任一情况发生时，必须检查是否更新：

* 新任务启动；
* 当前任务变化；
* branch 变化；
* base/head 变化；
* 新 commit；
* Code 验收完成；
* API 验收完成；
* Browser 验收完成；
* VPS 验收完成；
* Production 发布；
* 发现 P0/P1；
* 阶段门禁变化；
* 聊天交接；
* 项目暂停或恢复。

## 8.8 正式验收后的完成度同步

任何正式验收结束后，项目总控必须检查 `PROJECT_MASTER_PLAN.md` 是否需要更新：

1. Project Overall；
2. Module Overall；
3. Stage Overall。

完成度变化不得长期停留在聊天中。

如验收没有改变总体、模块或阶段完成度，应明确记录：

```text
PROJECT_MASTER_PLAN.md：无需更新
```

## 8.9 PROJECT_MASTER_PLAN.md 更新原则

不得因为以下单一事件自动上调总体完成度：

* commit 已提交；
* lint PASS；
* build PASS；
* 单文件修复；
* 单个 API PASS；
* 单张截图；
* Codex 自报完成。

完成度调整必须依据：

* 正式验收证据；
* 模块目标；
* 阶段完成标准；
* 阶段门禁；
* 当前阻断项。

## 8.10 ROADMAP.md 更新规则

仅在以下情况更新：

* 进入新阶段；
* 阶段顺序变化；
* 阶段冻结；
* 阶段取消；
* 新增未来阶段；
* 阶段依赖变化；
* 已完成阶段归档。

普通 bug、commit 或验收结果不写入 `ROADMAP.md`。

## 8.11 DECISIONS.md 更新规则

仅在新增长期决定时更新：

* 业务口径；
* 日期字段；
* 支付状态；
* 退款规则；
* 去重规则；
* 数据源；
* 架构方向；
* AI 权限；
* 正式例外；
* 永久规则；
* 废弃方案。

普通开发进度不写入 `DECISIONS.md`。

## 8.12 每轮正式任务结束的文档检查顺序

每轮正式任务结束后，必须逐项检查：

1. `WORKFLOW.md`；
2. `PROJECT_MASTER_PLAN.md`；
3. `PROJECT_STATUS.md`；
4. `ROADMAP.md`；
5. `DECISIONS.md`。

不是要求每轮全部更新，而是必须逐项判断是否需要更新。

### WORKFLOW.md

仅长期工作流程发生重大变化时更新。

### PROJECT_MASTER_PLAN.md

总体方案、Project Overall、Module Overall 或 Stage Overall 变化时更新。

### PROJECT_STATUS.md

当前任务、commit、风险、五类状态或下一步变化时更新。

### ROADMAP.md

阶段推进或未来阶段规划变化时更新。

### DECISIONS.md

新增长期业务、架构或正式例外时更新。

## 8.13 每轮正式收口流程

1. 对齐任务原文；
2. 确认 base/head；
3. 输出验收结论；
4. 区分所有完成度维度；
5. 列出已完成；
6. 列出未完成；
7. 列出新风险；
8. 列出未运行项；
9. 核对阶段门禁；
10. 确定唯一下一步；
11. 检查 `WORKFLOW.md`；
12. 检查 `PROJECT_MASTER_PLAN.md`；
13. 检查 `PROJECT_STATUS.md`；
14. 检查 `ROADMAP.md`；
15. 检查 `DECISIONS.md`；
16. 保存验收证据到 Sources；
17. 接近窗口上限时生成交接。

## 8.14 失败记录保留

失败和阻断不得删除。

修复后必须记录：

* 原失败任务；
* 修复任务；
* 修复 commit；
* 新验收结果；
* 风险是否关闭。

不得把历史 FAIL 改写为从未发生。

## 8.15 阶段收口条件

主阶段正式收口必须满足：

* 阶段目标完成；
* 强制验收通过；
* 无未解决 P0；
* 关键 P1 已关闭或正式接受；
* Project Overall 已检查；
* Module Overall 已检查；
* Stage Overall 已更新；
* 五类完成状态已记录；
* `PROJECT_MASTER_PLAN.md` 已更新；
* `PROJECT_STATUS.md` 已更新；
* `ROADMAP.md` 已更新阶段状态；
* 重大决定已写入 `DECISIONS.md`；
* 证据已保存；
* 下一阶段门禁明确。

---

# 9. 永久禁止项与例外规则

## 9.1 永久禁止修改的路径和文件

未经正式例外批准，禁止修改：

```text
repo/
repo_ref/
repo_reference/
prisma/schema.prisma
Dockerfile
docker-compose.yml
deploy.sh
```

## 9.2 数据库和架构禁止项

禁止：

* 新增 migrations；
* 修改数据库 provider；
* 新增 Prisma 表；
* 切换 PostgreSQL；
* 手工修改 Production 业务数据；
* 用临时数据库结构绕过正式设计；
* GET 页面接口写业务数据；
* 同步前 `deleteMany` 清理事实数据。

## 9.3 数据主链路禁止项

禁止恢复或新增：

* mock 主链路；
* demo 主链路；
* fallback 主链路；
* legacy 主链路；
* 静态假数据；
* 固定比例推算事实指标；
* API 错误返回旧数据并冒充当前数据；
* 无数据自动填充历史数据；
* 用技术 trace 代替业务页面。

## 9.4 页面禁止项

禁止：

* `display:none` 假装修复；
* 删除组件但保留错误逻辑；
* 大量常驻说明框掩盖问题；
* 正常有数据时显示调试说明；
* 默认暴露后端技术 key；
* Meta 数据命名为店铺数据；
* 店铺数据命名为 Meta 数据；
* 旧周期数据冒充当前周期；
* 同步中显示失败；
* 无新数据显示系统错误。

默认禁止暴露：

```text
issueId
ACC_ACT
acc_act
STORE_1
store_1
data_health
mapping
```

## 9.5 服务器禁止项

禁止：

* 修改服务器源码；
* 修改 `dist`；
* 修改 `node_modules`；
* 编辑器热修；
* `sed` 热修；
* 手工补丁；
* 创建未提交差异；
* VPS 创建临时 commit；
* 先改 Production 再补 GitHub；
* 未经本地验收频繁部署；
* 手工修改业务数据；
* 使用服务器差异作为正式修复。

## 9.6 验收结论禁止项

禁止将以下内容写成最终 PASS：

* lint；
* build；
* 脚本执行成功；
* commit 创建；
* commit 合并；
* Codex 自报；
* 开发人员自报；
* HTTP 200；
* 0 对 0；
* `N/A`；
* `FETCH_ERROR` 后生成报告；
* 未验证 API 的“数据一致”；
* 未看页面的 Browser complete；
* 未部署的 VPS complete；
* 未验证 Production 的 Production complete。

## 9.7 正式例外申请

必须包含：

* 例外编号；
* 日期；
* 申请人；
* 需要突破的规则；
* 业务原因；
* 技术原因；
* 影响范围；
* 风险；
* 替代方案；
* 替代方案为何不可行；
* 回滚方案；
* 允许文件；
* 生效时间；
* 失效时间；
* 批准人。

## 9.8 正式例外生效条件

正式例外必须：

1. 项目负责人批准；
2. 写入 `DECISIONS.md`；
3. 明确单次或长期；
4. 明确影响范围；
5. 明确回滚；
6. 开发指令引用决定；
7. 验收时核对范围。

聊天口头同意不构成正式例外。

## 9.9 例外不能自动成为长期规则

单次例外只适用于批准任务。

要成为长期规则，必须：

* 修改 `WORKFLOW.md`；
* 更新版本号；
* 记录修订原因；
* 项目负责人批准；
* GitHub commit 写入。

---

# 10. PROJECT_MASTER_PLAN 与总体方案维护规则

## 10.1 唯一长期项目方案

`PROJECT_MASTER_PLAN.md` 是 Meta MCP 2.0 唯一长期项目方案。

任何聊天、Sources、历史文档、开发指令或个人记录，均不得替代 `PROJECT_MASTER_PLAN.md` 作为总体方案。

## 10.2 必须记录的内容

`PROJECT_MASTER_PLAN.md` 至少必须包含：

* 项目最终目标；
* 总体架构；
* 正式模块；
* 模块职责；
* 模块依赖；
* 核心业务口径；
* Project Overall；
* Module Overall；
* Stage Overall；
* 当前阶段完成情况；
* 长期阻断项；
* 总体方案版本；
* 方案变更记录。

## 10.3 重大方案调整流程

任何重大方案调整必须：

```text
提出方案调整
→ 更新 PROJECT_MASTER_PLAN.md
→ 必要时更新 DECISIONS.md
→ 必要时更新 ROADMAP.md
→ 项目负责人审核
→ GitHub commit
→ 项目总控更新 PROJECT_STATUS.md
→ 生成正式开发任务
→ 开始开发
```

不得跳过总体方案更新直接开发。

## 10.4 总体完成度维护

项目总控必须依据真实验收结果维护：

```text
Project Overall
Module Overall
Stage Overall
```

其他窗口只能提出建议，不得直接修改。

## 10.5 模块完成度维护

每个模块必须独立记录完成状态。

不得出现：

* 一个页面 PASS，整个模块直接 PASS；
* 一个模块 PASS，整个项目直接 PASS；
* Code complete PASS，模块直接 Production PASS；
* 未运行 API 和 Browser，却将模块记录为完成。

## 10.6 阶段完成度维护

Stage Overall 必须根据该阶段所有正式目标和门禁判断。

不得根据：

* 单个 commit；
* 单个页面；
* 单个 API；
* 单次 lint/build；
* 单个窗口结论；

直接更新 Stage Overall 为 PASS。

## 10.7 总体方案与当前状态的关系

* `PROJECT_MASTER_PLAN.md`：长期方案和总体完成度；
* `PROJECT_STATUS.md`：当前任务和当前真实状态；
* `ROADMAP.md`：未来阶段；
* `DECISIONS.md`：重大决定；
* `WORKFLOW.md`：长期规则。

不得混写。

---

# 附录 A：开发指令模板

````markdown
# Meta MCP 2.0 开发指令

## 一、任务信息

项目：Meta MCP 2.0  
任务编号：  
任务名称：  
开发 base：  
目标 branch：  
建议 commit message：  

## 二、正式文档对齐

- `WORKFLOW.md`：
- `PROJECT_MASTER_PLAN.md`：
- `PROJECT_STATUS.md`：
- `ROADMAP.md`：
- `DECISIONS.md`：

是否涉及重大方案调整：

如涉及，`PROJECT_MASTER_PLAN.md` 是否已先更新：

## 三、本轮目标

1.
2.
3.

## 四、本轮只做什么

1.
2.
3.

## 五、本轮不做什么

1.
2.
3.

## 六、允许修改范围

| 文件编号 | 文件路径 | 是否允许新增 | 说明 |
| --- | --- | --- | --- |
| F01 |  | 否 |  |
| F02 |  | 否 |  |

## 七、禁止修改范围

- `repo/`
- `repo_ref/`
- `repo_reference/`
- `prisma/schema.prisma`
- `Dockerfile`
- `docker-compose.yml`
- `deploy.sh`
- migrations
- 其他：

## 八、逐文件开发要求

### 文件编号：F01

文件路径：

当前问题：

修复位置：

旧逻辑风险：

怎么修：

必须复用的公共逻辑：

参考代码：

```ts
// 必要参考代码
```

禁止写法：

验收 grep：

```bash
# grep
```

API 验收：

Browser 验收：

失败标准：

## 九、跨文件业务规则

### 日期规则

- 默认订单日期：
- 时区：
- 请求日期与应用日期：

### storeId 规则

- `storeId=all`：
- 单店铺：
- 无效店铺：

### accountId 规则

- 全账户：
- 单账户：
- 未映射账户：

### Meta 与店铺数据

- Meta purchases：
- Store orders：
- Meta purchase value：
- Store revenue：

### summary 与 rows

- 汇总范围：
- visible rows：
- 过滤规则：

### 同步状态

- `RUNNING`：
- `NO_NEW_DATA`：
- `PARTIAL_SUCCESS`：
- true error：

## 十、grep 验收

### 正向 grep

```bash
```

### 禁止写法 grep

```bash
```

### 状态分支 grep

```bash
```

### mock/demo/fallback/legacy grep

```bash
```

### GET 写库 grep

```bash
```

### deleteMany grep

```bash
```

### 技术 key grep

```bash
```

## 十一、代码验证

```bash
npm run lint
npm run build
```

## 十二、交付要求

必须提供：

- branch；
- base；
- head；
- commit SHA；
- commit message；
- 实际变更文件；
- 新增文件；
- lint；
- build；
- 已完成；
- 未完成；
- 未运行；
- 已知风险；
- 重点验收内容。

## 十三、失败标准

1.
2.
3.

## 十四、状态边界

本轮开发最多只能证明：

```text
Code complete
```

不得自行声明：

```text
API complete
Browser complete
VPS complete
Production complete
Project Overall
Module Overall
Stage Overall
```
````

---

# 附录 B：正式验收报告模板

````markdown
# Meta MCP 2.0 正式验收报告

## 一、本轮结论

```text
PASS / PARTIAL / FAIL
```

结论说明：

## 二、正式文档对齐

- `WORKFLOW.md`：
- `PROJECT_MASTER_PLAN.md`：
- `PROJECT_STATUS.md`：
- `ROADMAP.md`：
- `DECISIONS.md`：

## 三、指令对齐

任务编号：  
任务名称：  
允许修改文件：  
禁止修改文件：  
是否允许新增文件：  
API 要求：  
Browser 要求：  
VPS 要求：  
失败标准：  

## 四、Commit 对齐

```text
branch:
base:
head:
ahead_by:
behind_by:
commit message:
```

变更文件：

遗漏文件：

额外文件：

新增文件：

是否修改永久禁止文件：

是否基于正确 base：

判定：

## 五、逐文件验收

### 文件 1

文件路径：

指令要求：

原有问题：

实际修改：

代码证据：

旧逻辑风险：

完成情况：

漏点：

风险：

判定：

## 六、逐问题验收

| 问题 | 指令要求 | 实际代码 | 证据 | 判定 |
| --- | --- | --- | --- | --- |
| catch |  |  |  |  |
| empty |  |  |  |  |
| RUNNING |  |  |  |  |
| NO_NEW_DATA |  |  |  |  |
| PARTIAL_SUCCESS |  |  |  |  |
| true error |  |  |  |  |
| lastGoodData |  |  |  |  |
| 日期 |  |  |  |  |
| storeId |  |  |  |  |
| accountId |  |  |  |  |
| summary/rows |  |  |  |  |
| Meta/店铺分离 |  |  |  |  |

## 七、逐页面验收

| 页面 | 应看到 | 不应看到 | KPI 口径 | 空状态 | 同步状态 | 截图 | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- |

## 八、grep 验收

### 正向 grep

命令：

结果：

上下文：

判定：

### 禁止写法 grep

命令：

结果：

上下文：

判定：

### 状态分支 grep

命令：

结果：

上下文：

判定：

### mock/demo/fallback/legacy grep

命令：

结果：

上下文：

判定：

### GET 写库 grep

命令：

结果：

上下文：

判定：

### deleteMany grep

命令：

结果：

上下文：

判定：

### 技术 key grep

命令：

结果：

上下文：

判定：

## 九、失败标准核对

| 失败标准 | 是否触发 | 证据 | 结论 |
| --- | --- | --- | --- |

## 十、验收矩阵

| 验收类型 | 状态 | 已有证据 | 缺失证据 |
| --- | --- | --- | --- |
| Code | PASS / PARTIAL / FAIL / NOT RUN / BLOCKED |  |  |
| API | PASS / PARTIAL / FAIL / NOT RUN / BLOCKED |  |  |
| Browser | PASS / PARTIAL / FAIL / NOT RUN / BLOCKED |  |  |
| VPS | PASS / PARTIAL / FAIL / NOT RUN / BLOCKED |  |  |
| Production | PASS / PARTIAL / FAIL / NOT RUN / BLOCKED |  |  |

## 十一、完成度影响

```text
Project Overall:
Module Overall:
Stage Overall:
Code complete:
API complete:
Browser complete:
VPS complete:
Production complete:
```

项目总控是否需要更新 `PROJECT_MASTER_PLAN.md`：

## 十二、当前风险

| 编号 | 风险 | 严重程度 | 影响 | 状态 |
| --- | --- | --- | --- | --- |
|  |  | P0 / P1 / P2 |  |  |

## 十三、阶段门禁

| 下一阶段 | 是否允许进入 | 原因 |
| --- | --- | --- |

## 十四、正式文档更新判断

- [ ] `WORKFLOW.md`
- [ ] `PROJECT_MASTER_PLAN.md`
- [ ] `PROJECT_STATUS.md`
- [ ] `ROADMAP.md`
- [ ] `DECISIONS.md`
- [ ] Sources
- [ ] 无需更新

更新说明：
````

---

# 附录 C：聊天窗口交接模板

````markdown
# Meta MCP 2.0 聊天窗口交接

## 一、窗口信息

原聊天名称：  
原窗口角色：  
交接日期：  
是否达到窗口上限：  
交接后是否停止产生正式结论：  

## 二、必须按顺序读取

1. `docs/WORKFLOW.md`
2. `docs/PROJECT_MASTER_PLAN.md`
3. `docs/PROJECT_STATUS.md`
4. `docs/ROADMAP.md`
5. `docs/DECISIONS.md`
6. GitHub
7. Sources
8. 历史聊天

## 三、当前项目位置

```text
Project Overall:
当前主阶段:
Stage Overall:
当前子任务:
当前 branch:
base:
head:
```

## 四、模块完成度

| 模块 | Module Overall |
| --- | --- |
| Audience |  |
| Countries |  |
| Campaign |  |
| Creative |  |
| Store |  |
| Products |  |
| Sync |  |
| Data Center |  |
| Audit |  |
| Project Docs |  |

## 五、五类完成状态

```text
Code complete:
API complete:
Browser complete:
VPS complete:
Production complete:
```

## 六、当前任务摘要

本轮目标：

本轮只做：

本轮不做：

允许修改文件：

禁止修改文件：

失败标准：

## 七、已完成工作

1.
2.
3.

## 八、未完成工作

1.
2.
3.

## 九、已验证项目

1.
2.
3.

## 十、未验证项目

1.
2.
3.

## 十一、当前风险

| 编号 | 风险 | 严重程度 | 影响 | 状态 |
| --- | --- | --- | --- | --- |
|  |  | P0 / P1 / P2 |  |  |

## 十二、阶段门禁

| 下一阶段 | 是否允许 | 原因 |
| --- | --- | --- |

## 十三、正式文档同步状态

| 文档 | 是否已更新 | 说明 |
| --- | --- | --- |
| `WORKFLOW.md` |  |  |
| `PROJECT_MASTER_PLAN.md` |  |  |
| `PROJECT_STATUS.md` |  |  |
| `ROADMAP.md` |  |  |
| `DECISIONS.md` |  |  |

## 十四、相关证据

Commit：

验收报告：

API：

Browser：

VPS：

Sources：

## 十五、新窗口第一项工作

任务：

需要先核对：

不得直接假设：

## 十六、交接确认

- [ ] 当前状态已核对
- [ ] base/head 已核对
- [ ] 完成度已核对
- [ ] 风险已记录
- [ ] 阶段门禁已记录
- [ ] 正式文档已逐项判断
- [ ] Sources 已保存
- [ ] 新窗口已读取交接
````

---

# 附录 D：部署与状态更新检查表

````markdown
# Meta MCP 2.0 部署与状态更新检查表

## 一、部署前门禁

- [ ] Code complete 状态明确
- [ ] 本地 API 状态明确
- [ ] 本地 Browser 状态明确
- [ ] `PROJECT_STATUS.md` 允许进入 VPS
- [ ] GitHub commit 已存在
- [ ] 目标 branch 已确认
- [ ] 目标 SHA 已确认
- [ ] 无未解决 P0
- [ ] 回滚 commit 已确认

## 二、部署目标

```text
repository:
branch:
target_sha:
rollback_sha:
server:
pm2_process:
deployment_time:
operator:
```

## 三、VPS 操作

### Git

- [ ] `git fetch`
- [ ] checkout/reset 到已存在 commit
- [ ] `git rev-parse HEAD`
- [ ] SHA 与目标一致
- [ ] `git status --short`
- [ ] working tree clean

### 安装和生成

- [ ] `npm install` 或 `npm ci`
- [ ] `prisma generate`
- [ ] 无未经批准的依赖变化

### 验证

- [ ] `npm run lint`
- [ ] `npm run build`

### PM2

- [ ] PM2 restart
- [ ] 状态正常
- [ ] 新日志已检查
- [ ] 无核心启动错误
- [ ] 无数据库错误
- [ ] 无循环重启

## 四、服务器禁止项确认

- [ ] 未编辑源码
- [ ] 未修改 dist
- [ ] 未修改 node_modules
- [ ] 未热修
- [ ] 未手工补丁
- [ ] 未手工修改业务数据
- [ ] 未创建未提交差异
- [ ] 未在 VPS 创建 commit
- [ ] 未修改禁止文件

## 五、VPS API 验收

### 日期矩阵

- [ ] today
- [ ] yesterday
- [ ] past_7
- [ ] past_14
- [ ] past_30

### 店铺矩阵

- [ ] `storeId=all`
- [ ] 每个有效 storeId

### API 检查

- [ ] HTTP 正常
- [ ] 无 `FETCH_ERROR`
- [ ] 日期一致
- [ ] `storeId` 一致
- [ ] `accountId` 一致
- [ ] summary/rows 一致
- [ ] 页面间口径一致
- [ ] 空数据正确
- [ ] error 正确
- [ ] 未使用 0 对 0
- [ ] 未使用 `N/A` 代替判断
- [ ] 输出已保存

```text
VPS API:
PASS / PARTIAL / FAIL / NOT RUN / BLOCKED
```

## 六、VPS Browser 验收

- [ ] 页面可访问
- [ ] 静态资源正常
- [ ] commit 可追溯
- [ ] 日期正常
- [ ] 店铺正常
- [ ] 账户正常
- [ ] KPI 名称正确
- [ ] KPI 口径正确
- [ ] summary/rows 一致
- [ ] Meta/店铺分离
- [ ] 空数据正确
- [ ] error 正确
- [ ] 同步按钮正常
- [ ] RUNNING
- [ ] NO_NEW_DATA
- [ ] PARTIAL_SUCCESS
- [ ] true error
- [ ] 无旧周期数据
- [ ] 无技术 key
- [ ] 无冗余说明框
- [ ] 无旧构建缓存

```text
VPS Browser:
PASS / PARTIAL / FAIL / NOT RUN / BLOCKED
```

## 七、Production 验收

- [ ] Code complete: PASS
- [ ] API complete: PASS
- [ ] Browser complete: PASS
- [ ] VPS complete: PASS
- [ ] Production API 已验证
- [ ] Production 页面已验证
- [ ] Production 数据已验证
- [ ] 无未解决 P0
- [ ] 回滚方案可用
- [ ] 证据已保存

```text
Production complete:
PASS / PARTIAL / FAIL / NOT RUN / BLOCKED
```

## 八、完成度检查

```text
Project Overall:
Module Overall:
Stage Overall:
Code complete:
API complete:
Browser complete:
VPS complete:
Production complete:
```

## 九、正式文档更新判断

### WORKFLOW.md

- [ ] 无需更新
- [ ] 长期工作流程发生重大变化

### PROJECT_MASTER_PLAN.md

- [ ] 无需更新
- [ ] 总体方案变化
- [ ] Project Overall 变化
- [ ] Module Overall 变化
- [ ] Stage Overall 变化

### PROJECT_STATUS.md

- [ ] 当前任务已更新
- [ ] branch/base/head 已更新
- [ ] 五类状态已更新
- [ ] 风险已更新
- [ ] 门禁已更新
- [ ] 下一步已更新

### ROADMAP.md

- [ ] 无需更新
- [ ] 阶段推进
- [ ] 阶段顺序变化
- [ ] 新增未来阶段
- [ ] 阶段归档

### DECISIONS.md

- [ ] 无需更新
- [ ] 新增业务决定
- [ ] 新增架构决定
- [ ] 新增正式例外

### Sources

- [ ] 部署记录
- [ ] API 输出
- [ ] Browser 截图
- [ ] 日志
- [ ] 验收报告
- [ ] 聊天交接

## 十、最终判定

```text
PASS / PARTIAL / FAIL / NOT RUN / BLOCKED
```

结论：

阻断项：

下一步：

是否回滚：

回滚结果：
````

---

# 版本历史

## V1.0

建立长期工作规则。

主要包括：

* 事实来源；
* 开发流程；
* 代码验收；
* API 验收；
* Browser 验收；
* VPS 验收；
* Production 验收；
* 聊天交接；
* 永久禁止项；
* 正式例外机制。

## V1.1

新增正式文档体系。

新增：

* 项目方案同步机制；
* 项目完成度同步机制；
* 聊天恢复机制；
* `PROJECT_MASTER_PLAN.md`。

## V2.0

新增项目目标。

新增：

* 项目最终目标；
* 项目总体架构；
* 正式模块体系；
* Project Overall；
* Module Overall；
* Stage Overall；
* 统一完成度体系；
* `PROJECT_MASTER_PLAN.md` 唯一长期项目方案规则；
* 重大方案调整前置规则；
* 项目恢复顺序；
* 项目总控唯一职责；
* 其他窗口权限边界；
* 正式文档逐项更新顺序；
* 正式文档生命周期；
* 长期稳定版本规则。

本版本作为 Meta MCP 2.0 的最终长期 `WORKFLOW.md`。

除非长期工作流程、治理体系或验收机制发生重大变化，否则原则上不再修改。
