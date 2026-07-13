# Meta MCP 2.0 项目状态

版本：V1.1-Recovery
状态：恢复基线，待 GitHub 提交
文档路径：`docs/PROJECT_STATUS.md`
最后更新时间：2026-07-13
维护主体：项目总控

---

# 1. 当前总控结论

```text
Project Overall：PARTIAL
当前主阶段：R5
当前子任务：R5-DATA-PAGE-CODE-CLOSURE-AUDIT
Stage Overall：PARTIAL
```

当前项目仍处于 R5。

最新功能代码补丁已提交，但尚未完成正式逐文件、逐问题、grep 和关键逻辑验收。API 已有审计结果均出现 `FETCH_ERROR`，Browser、VPS 和 Production 尚未运行。

当前不允许进入 R6，不允许声明 Production。

---

# 2. 当前仓库和 Commit 基线

| 项目            | 当前值                                        |
| ------------- | ------------------------------------------ |
| 仓库            | `newbie5522/meta-mcp2.0`                   |
| 当前 branch     | `main`                                     |
| 当前治理文档 head   | `0399cd3a591ca2bca8c7080c02e548e8d9b918d6` |
| 当前代码审计 base   | `4e76d3785b0d357ec614ff2acfc3e34ba4cff64e` |
| 当前代码审计目标 head | `c417aadc724b56c09f5d3017e1915ebee20ee6f1` |
| ahead_by      | `1`                                        |
| behind_by     | `0`                                        |
| 最新代码功能 commit | `c417aadc724b56c09f5d3017e1915ebee20ee6f1` |
| 最新治理文档 commit | `0399cd3a591ca2bca8c7080c02e548e8d9b918d6` |

必须区分：

* `0399cd3a...` 是治理文档 commit，只提交 `docs/WORKFLOW.md`；
* `c417aadc...` 是当前需要补验收的功能代码 commit；
* 治理文档 commit 不代表新功能代码完成；
* 功能代码 commit 不代表完整 CF3、API、Browser、VPS 或 Production 完成。

---

# 3. 最新功能 Commit 状态

Commit：

```text
c417aadc724b56c09f5d3017e1915ebee20ee6f1
```

Commit message：

```text
fix: tighten audience meta labels and store-only country scope
```

已确认限定范围：

* Audience Meta 指标命名收紧；
* Countries store-only scope。

当前状态：

```text
已提交，正式代码验收待执行
```

当前 compare 实际改动文件：

* `docs/page-audit-report.md`
* `src/components/AudienceAnalysisDashboard.tsx`
* `src/server/routes/data-center.routes.ts`
* `src/server/services/country-analytics.service.ts`

---

# 4. 五类完成状态

| 完成维度                | 当前状态    | 说明                                                                         |
| ------------------- | ------- | -------------------------------------------------------------------------- |
| Code complete       | PARTIAL | R5 overall 尚未完成；c417 已提交但正式代码补验收待执行                                        |
| API complete        | FAIL    | 已有 Audience、Countries、Stores、Products、Creatives 接口均出现 `FETCH_ERROR`，必须重新执行 |
| Browser complete    | NOT RUN | 尚无完整真实页面和截图验收                                                              |
| VPS complete        | NOT RUN | 尚未完成目标 SHA、只读 API、Browser 和日志验收                                            |
| Production complete | NOT RUN | 当前不具备 Production 门禁                                                        |

---

# 5. 已完成内容

* `docs/WORKFLOW.md` V2.0 已通过 commit `0399cd3a591ca2bca8c7080c02e548e8d9b918d6` 提交；
* 项目长期治理规则和事实优先级已恢复；
* 当前主阶段已恢复为 R5；
* CF2 与当前补丁的 commit 关系已纠正；
* 当前代码审计 base/head、`ahead_by` 和 `behind_by` 已确认；
* c417 限定补丁的 4 个实际改动文件已确认；
* 已明确 c417 不代表完整 CF3 或真实验收完成；
* 本轮已生成治理体系恢复正文，待 GitHub 正式提交。

---

# 6. 未完成内容

* `R5-DATA-PAGE-CODE-CLOSURE-AUDIT` 尚未执行；
* c417 尚未完成逐文件验收；
* c417 尚未完成逐问题验收；
* c417 尚未完成 grep 和关键逻辑验收；
* canonical store-order query 尚未闭环；
* payment、refund 和 deduplication 规则尚未统一验收；
* Audience、Countries、Store、Products 的店铺订单口径尚未统一闭环；
* fabricated profit 风险尚未关闭；
* Products `storeId` 风险尚未关闭；
* Audit `FETCH_ERROR` 硬失败和 UTC 日期问题尚未关闭；
* all-store/per-store 验收矩阵尚未执行；
* today/yesterday/7/14/30 日期矩阵尚未执行；
* API 必须重新执行；
* Browser、VPS、Production 尚未执行；
* R1—R4 的历史目标和完成情况待可靠证据恢复。

---

# 7. 当前风险

## 7.1 P0

| 编号    | 风险                                                             | 当前状态 | 影响                                        |
| ----- | -------------------------------------------------------------- | ---- | ----------------------------------------- |
| P0-01 | API 已有必验接口全部出现 `FETCH_ERROR`                                   | OPEN | 无法证明真实数据和跨页面一致性                           |
| P0-02 | canonical store-order query、payment、refund、deduplication 未统一闭环 | OPEN | Store、Products、Countries、Audience 可能口径不一致 |
| P0-03 | Meta 数据与店铺订单分离、summary/visible rows 同口径尚未完成统一验收                | OPEN | 核心业务结果可能误导                                |
| P0-04 | lastGoodData 和范围守护尚未完成本轮独立审计                                   | OPEN | 可能跨日期、`storeId` 或 `accountId` 显示旧数据       |

## 7.2 P1

| 编号    | 风险                             | 当前状态 | 影响                   |
| ----- | ------------------------------ | ---- | -------------------- |
| P1-01 | fabricated profit 风险未关闭        | OPEN | 页面可能显示非真实利润          |
| P1-02 | Products `storeId` 风险未关闭       | OPEN | 单店数据可能混入其他店铺         |
| P1-03 | Audit 对 `FETCH_ERROR` 未形成可靠硬失败 | OPEN | 失败报告可能被误读为成功         |
| P1-04 | Audit 默认 UTC 日期                | OPEN | today/yesterday 可能偏移 |
| P1-05 | 缺少 all-store/per-store 和多日期矩阵  | OPEN | 范围一致性无法证明            |
| P1-06 | c417 正式代码补验收未执行                | OPEN | 无法确定限定补丁是否完整和无回归     |

## 7.3 P2

| 编号    | 风险                                  | 当前状态 | 影响                |
| ----- | ----------------------------------- | ---- | ----------------- |
| P2-01 | R1—R4 历史细节尚未恢复                      | OPEN | 不阻断 R5 主线，但影响历史追踪 |
| P2-02 | DECISIONS 批准人历史信息待确认                | OPEN | 不阻断 R5 主线         |
| P2-03 | Project Docs Backlog 中的非核心文档细节待后续整理 | OPEN | 不得阻断代码和真实验收主线     |

---

# 8. 当前阻断项

以下事项阻断 R5 收口和 R6：

* c417 正式代码闭环审计未完成；
* P0 风险未关闭；
* API complete 为 FAIL；
* Browser complete 为 NOT RUN；
* VPS complete 为 NOT RUN；
* Production complete 为 NOT RUN；
* 统一订单口径和验收矩阵未完成；
* 项目总控尚未开放 R6 门禁。

---

# 9. 当前阶段门禁

| 门禁         | 当前状态    | 说明                          |
| ---------- | ------- | --------------------------- |
| R5 内部代码审计  | OPEN    | 当前唯一允许启动的技术主线               |
| R5 补漏开发    | BLOCKED | 需等待代码审计确认是否存在核心漏点           |
| 本地 API 验收  | BLOCKED | 需先完成代码审计且无核心代码阻断            |
| Browser 验收 | BLOCKED | 需关键 API 通过                  |
| VPS 验收     | BLOCKED | 需本地 Code、API、Browser 满足前置条件 |
| R6         | BLOCKED | R5 未收口                      |
| Production | BLOCKED | Code、API、Browser、VPS 均未完成   |

是否允许进入 R6：

```text
否
```

是否允许进入 Production：

```text
否
```

---

# 10. 当前唯一下一步

```text
执行 R5-DATA-PAGE-CODE-CLOSURE-AUDIT
```

审计范围：

```text
base：4e76d3785b0d357ec614ff2acfc3e34ba4cff64e
head：c417aadc724b56c09f5d3017e1915ebee20ee6f1
```

该任务只执行独立代码收口审计，不直接开发新功能，不修改代码。

审计结束后：

* 核心问题完成：进入 API 验收；
* 存在 P0 或核心漏点：生成 R5 补漏开发任务；
* 仅存在非主链路 P2：登记 Project Docs Backlog 或 R5 Backlog，不阻断主线。

---

# 11. 待确认事项

* R1—R4 的正式阶段目标、完成状态和证据；
* 当前所有有效 Meta accountId 和 storeId 清单；
* payment status 的正式纳入规则；
* refund 的正式业务口径；
* deduplication 的正式唯一键和处理规则；
* DECISIONS 历史批准人；
* 本地 API 重新验收环境是否已准备；
* Browser 和 VPS 验收环境的可用时间；
* 本轮治理文档正式提交后的新治理 head。

---

# 12. 状态变更记录

| 版本            | 日期         | 说明                                         |
| ------------- | ---------- | ------------------------------------------ |
| V1.0-Recovery | 2026-07-13 | 项目误删后的初始状态恢复基线                             |
| V1.1-Recovery | 2026-07-13 | 区分治理文档 head 与功能代码审计 head，加入治理体系恢复和首个代码审计任务 |
