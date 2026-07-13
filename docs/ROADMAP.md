# Meta MCP 2.0 项目路线图

版本：V1.0-Recovery
状态：恢复基线，待 GitHub 提交
文档路径：`docs/ROADMAP.md`
最后更新：2026-07-13

---

# 1. 文档定位

本文件只记录未来阶段、阶段关系、阶段门禁和路线调整。

本文件不记录当前 commit、普通开发进度或单次验收结果。当前真实状态以 `PROJECT_STATUS.md` 为准，长期总体方案以 `PROJECT_MASTER_PLAN.md` 为准。

---

# 2. 项目总路线

```text
R1
→ R2
→ R3
→ R4
→ R5
→ R6
→ Production 门禁评估
```

当前：

```text
R5
```

R5 完成前不得进入 R6；Code、API、Browser、VPS 未完成前不得宣布 Production。

---

# 3. R1—R6 阶段表

| 阶段 | 总体定位                          | 当前路线状态  |
| -- | ----------------------------- | ------- |
| R1 | 历史阶段目标待可靠证据恢复                 | 待确认     |
| R2 | 历史阶段目标待可靠证据恢复                 | 待确认     |
| R3 | 历史阶段目标待可靠证据恢复                 | 待确认     |
| R4 | 历史阶段目标待可靠证据恢复                 | 待确认     |
| R5 | 数据可信度、页面口径、同步状态和真实验收闭环        | 当前阶段    |
| R6 | 在 R5 统一可信基线完成后的后续能力扩展，详细范围待确认 | BLOCKED |

不得根据历史聊天或旧预计补写 R1—R4 的详细完成事实。

---

# 4. 已确认阶段与待确认阶段

## 4.1 已确认

* 当前主阶段为 R5；
* R5 当前未完成；
* R6 尚未进入；
* Production 尚未进入；
* 当前只允许 R5 内部修复、补验收、代码收口和项目治理恢复。

## 4.2 待确认

* R1 的正式目标、范围和完成证据；
* R2 的正式目标、范围和完成证据；
* R3 的正式目标、范围和完成证据；
* R4 的正式目标、范围和完成证据；
* R6 的详细模块范围和正式交付目标。

---

# 5. R5 当前目标

R5 当前目标是建立可真实验收的数据和页面可信基线，完成：

* 日期范围一致；
* `storeId` 和 `accountId` 范围一致；
* `summary` 与 `visible rows` 一致；
* Meta 与店铺订单数据分离；
* 店铺订单统一使用 `Order.store_local_date`；
* payment、refund、deduplication 规则统一；
* 同步状态语义正确；
* lastGoodData 不跨范围复用；
* Audit 能真实识别接口失败和日期问题；
* 完成 Code、API、Browser 和 VPS 闭环；
* 恢复并维护正式 Project Docs。

当前首个技术任务：

```text
R5-DATA-PAGE-CODE-CLOSURE-AUDIT
```

---

# 6. R5 收口条件

R5 收口必须满足：

1. 最新功能代码完成独立代码闭环审计；
2. R5 核心代码问题完成或形成正式可接受结论；
3. 无未解决 P0；
4. `Code complete: PASS`；
5. `API complete: PASS`；
6. `Browser complete: PASS`；
7. `VPS complete: PASS`；
8. all-store/per-store 验收矩阵通过；
9. today/yesterday/7/14/30 日期矩阵通过；
10. Meta/Store、summary/rows 和同步状态通过真实验收；
11. 项目治理文档和 Sources 已同步；
12. 项目总控正式完成 R5 收口。

---

# 7. R6 预计目标

R6 的预计定位是：

> 在 R5 已建立的统一可信数据基线上，进入下一阶段能力扩展和产品化收口。

R6 具体模块、文件范围、交付标准和验收矩阵必须在进入前通过：

* `PROJECT_MASTER_PLAN.md`；
* `ROADMAP.md`；
* `DECISIONS.md`（如涉及重大决定）；
* `PROJECT_STATUS.md` 阶段门禁。

当前 R6 详细范围：

```text
待确认
```

---

# 8. R6 进入门禁

进入 R6 必须：

* R5 Stage Overall 为 PASS；
* R5 无未解决 P0；
* Code、API、Browser、VPS 均为 PASS；
* `PROJECT_MASTER_PLAN.md` 已确认 R6 方案；
* `ROADMAP.md` 已确认 R6 范围；
* `PROJECT_STATUS.md` 明确允许进入；
* 项目总控正式宣布进入 R6。

当前：

```text
R6：BLOCKED
```

---

# 9. Production 进入门禁

进入或声明 Production 必须：

* 当前正式阶段已经收口；
* `Code complete: PASS`；
* `API complete: PASS`；
* `Browser complete: PASS`；
* `VPS complete: PASS`；
* 生产目标 SHA 和回滚 SHA 明确；
* Production API、页面和核心业务数据已验证；
* 无服务器热修；
* 无未解决 P0；
* `PROJECT_STATUS.md` 明确开放 Production 门禁。

当前：

```text
Production：BLOCKED
```

---

# 10. 当前允许和禁止事项

## 10.1 当前允许

* R5 内部修复；
* 最新代码 commit 补验收；
* 项目管理体系恢复；
* R5 代码收口和补漏；
* 独立 Code、API、Browser、VPS 验收；
* 非核心小问题登记到 Project Docs Backlog 或 R5 Backlog。

## 10.2 当前禁止

* 直接进入 R6；
* 直接宣布 Production；
* 未完成代码审计就宣称 c417 完成；
* 未完成 API、Browser、VPS 验收就推进阶段；
* 用 lint、build、commit 或工具自报 PASS 代替真实验收；
* 编造 R1—R4 历史完成事实；
* 在 VPS 热修；
* 通过新阶段掩盖 R5 核心漏点。

---

# 11. 路线调整规则

出现以下情况时才更新本文件：

* 新增、删除或冻结主阶段；
* 阶段顺序变化；
* 阶段目标发生重大变化；
* 阶段进入条件变化；
* R5 正式收口并进入 R6；
* Production 门禁策略变化。

路线调整必须：

1. 先更新 `PROJECT_MASTER_PLAN.md`；
2. 必要时更新 `DECISIONS.md`；
3. 更新本文件；
4. 更新 `PROJECT_STATUS.md`；
5. 项目负责人审核并通过 GitHub commit 保存。

---

# 12. 版本记录

| 版本            | 日期         | 说明                        |
| ------------- | ---------- | ------------------------- |
| V1.0-Recovery | 2026-07-13 | 恢复 R1—R6 总路线、R5 当前目标和阶段门禁 |
