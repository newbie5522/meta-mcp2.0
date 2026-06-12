# Meta Ads Store Analytics MCP 项目交接说明

当前最终主仓库：

https://github.com/newbie5522/meta-ads-store-analytics-mcp

参考仓库：

- 前端与业务逻辑参考：https://github.com/yiw16886-create/meta-ai-ads-system
- MCP / Meta Ads 工具架构参考：https://github.com/byadsco/meta-ads-mcp

## 1. 项目定位

本项目不是普通广告数据面板，而是：

**AI 广告投放操作系统（AI Media Buying Operating System）**

核心目标：

1. 广告数据中台
2. AI Media Buyer Copilot
3. AI Creative Copilot
4. Meta Ads MCP 只读分析系统
5. 多店铺订单归因分析
6. 实时广告异常监测
7. AI 优化建议系统

关键原则：

- AI 只能给建议，不能自动操作广告。
- Meta API 必须只允许 GET。
- 禁止任何 create / update / delete / pause / upload / budget / rules / billing 写入行为。
- 前端不能直接请求 Meta / Shopline / Shoplazza 外部 API。
- 正确数据流必须是：外部 API -> worker -> PostgreSQL -> Redis -> API -> Dashboard -> AI Copilot。

## 2. 当前本地提交状态

截至当前交接，本地 `main` 分支领先远端 3 个提交：

```bash
main...origin/main [ahead 3]

d867c3e Add project handoff instructions
f2964b2 Refresh analytics caches after sync
ce06f36 Connect suggestion cards to Creative Copilot
```

这三个提交的内容：

### d867c3e Add project handoff instructions

- 新增 `PROJECT_HANDOFF.md`。
- 合并项目定位、当前进度、需求对照表、后续开发排程、安全注意事项、VPS 更新命令。
- 用于让后续接手模型一次性理解项目，不需要从聊天记录里逐条整理。

### ce06f36 Connect suggestion cards to Creative Copilot

- AI 建议卡片新增“生成创意”。
- 可根据建议卡片生成 Creative Copilot Brief。
- 生成结果保存为 `creative` 类型 AI 报告。
- Creative Copilot 支持：
  - product
  - country
  - ad
  - creative
  - campaign
  - adset
  - store
  - ad_account
- MCP 工具同步扩展这些只读对象。

### f2964b2 Refresh analytics caches after sync

- Meta Insights 写库后清理分析缓存。
- 订单同步后清理店铺分析缓存。
- 账户消耗页新增排障字段：
  - 数据行
  - 最近数据
- 用于判断“消耗为 0”到底是没入库，还是 Meta 返回 0。

如果这些提交尚未在 GitHub 远端，请执行：

```bash
git push origin main
```

## 3. 当前架构

```txt
apps/
  web       React / Vite 前端
  api       Express API 入口
  worker    自动同步与规则监测
  mcp       MCP 服务

packages/
  ai         OpenAI/Gemini Provider、AI Copilot、Creative Copilot
  analytics 规则与分析逻辑
  auth      认证相关
  cache     Redis / TTL 缓存
  db        DB package
  erp       ERP 预留
  meta      Meta 能力声明
  shopline  Shopline 预留
  shoplazza Shoplazza 预留

src/
  api/routes.ts
  domain/
    ad-accounts.ts
    account-spend.ts
    account-analysis.ts
    ai-deep-analysis.ts
    ai-suggestions.ts
    analysis.ts
    mappings.ts
    meta-insights-sync.ts
    meta-structure-sync.ts
    meta-creatives-sync.ts
    order-sync.ts
    rule-monitor.ts
    stores.ts
    sync-logs.ts
  tools/
    accounts.ts
    campaigns.ts
    adsets.ts
    ads.ts
    creatives.ts
    insights.ts
    ai-copilot.ts
```

## 4. 已完成能力

### 4.1 Meta 只读安全

已实现：

- `READ_ONLY_MODE=true`
- `graph.facebook.com` 非 GET 请求会被拒绝
- MCP tools 全部是 `ads_readonly_*`
- `npm run verify:readonly` 通过

已有 MCP tools：

```txt
ads_readonly_get_ad_accounts
ads_readonly_get_account_info
ads_readonly_get_campaigns
ads_readonly_get_ad_sets
ads_readonly_get_ads
ads_readonly_get_creatives
ads_readonly_get_insights
ads_readonly_analyze_ad_account
ads_readonly_generate_creative_brief
```

### 4.2 数据库

Prisma 已有主要表：

```txt
stores
ad_accounts
campaigns
adsets
ads
store_ad_account_map
orders
order_items
meta_daily_insights
meta_breakdowns
daily_summaries
meta_ad_creatives
sync_logs
ai_provider_settings
ai_conversations
ai_messages
ai_analysis_reports
ai_action_suggestions
```

### 4.3 后台页面

React/Vite 后台已存在：

```txt
数据总览
店铺管理
Meta 广告账户
店铺账户映射
账户消耗数据
账户深度分析
店铺真实 ROAS
国家分析
产品分析
项目类别看板
负责人概览
AI 建议卡片
Creative Copilot
AI 模型设置
系统设置
同步日志
AI 小窗口
```

### 4.4 AI 能力

已实现：

- AI Provider 后台配置
- OpenAI / Gemini API Key 加密保存
- AI 小窗口
- 账户深度分析
- 单 Campaign / AdSet / Ad / Creative 分析
- AI 建议卡片
- 规则监测生成建议
- 店铺真实 ROAS / 国家 / 产品建议
- Creative Copilot
- 建议卡片联动 Creative Copilot

### 4.5 Worker

已有：

- 自动同步广告账户
- 自动同步 Meta 结构
- 自动同步 Meta Insights
- 自动同步订单
- 自动重试失败日志
- 自动规则检测

相关文件：

```txt
apps/worker/src/index.ts
src/jobs/scheduler.ts
docker-compose.yml
.env.example
```

### 4.6 Redis 缓存

已有：

- Redis TTL Cache
- Dashboard 缓存
- 账户汇总缓存
- 店铺汇总缓存
- 国家 / 产品 / 素材 / 趋势分析缓存
- Redis 不可用时回退内存缓存
- Meta Insights / 订单同步完成后主动清理相关分析缓存

## 5. 当前最大问题

### P0 问题 1：账户消耗数据仍可能为 0

现象：

- 前端账户消耗页同步后，消耗、展示、点击、订单、ROAS 可能为 0。
- 已新增 `数据行` 和 `最近数据` 字段用于排障。

需要继续排查：

1. Meta Insights 请求参数是否正确。
2. `level=ad` + `countryBreakdown=true` 是否导致部分账户无数据。
3. 是否应该先同步 `level=account` 用于账户总览。
4. 是否分页不完整。
5. 是否 active account 过滤过严。
6. 是否 Meta 返回数据但解析字段错。
7. 是否数据库写入后聚合范围不一致。
8. 是否同步日志没有暴露真实错误。

重点文件：

```txt
src/domain/meta-insights-sync.ts
src/domain/account-spend.ts
src/tools/field-policy.ts
src/meta/client.ts
src/api/routes.ts
apps/web/src/main.tsx
src/domain/sync-logs.ts
```

建议下一步：

- 新增账户级 Insights 同步模式：`level=account`
- 账户消耗页优先使用 account-level 数据
- ad-level / country breakdown 用于深度分析
- 同步日志展示每个账户的 fetched / saved / error
- 前端显示“无数据原因”

### P0 问题 2：订单同步尚未实机打通

目前已有订单同步框架，但 Shopline / Shoplazza 真实 API 适配需要验证。

重点文件：

```txt
src/domain/order-sync.ts
src/shop/client.ts
src/shop/privacy.ts
src/domain/stores.ts
src/domain/store-profile.ts
```

需要完成：

- Shopline 订单接口真实路径
- Shoplazza 订单接口真实路径
- Token / App Key / App Secret / App UID 鉴权方式
- 增量同步
- 失败重试
- 隐私过滤确认：
  - 不保存姓名
  - 不保存邮箱
  - 不保存电话
  - 不保存街道地址

### P0 问题 3：Worker 自动同步需要产品化确认

目前 worker 已有，但需要确认：

- Docker 中 worker 是否实际启动
- `.env` 是否启用了对应任务
- 同步频率是否合理
- 是否支持后台配置同步频率
- 是否避免 1GB VPS 压力过大

重点文件：

```txt
apps/worker/src/index.ts
src/jobs/scheduler.ts
docker-compose.yml
.env.example
```

## 6. 需求对照表

| 模块 | 当前状态 | 完成度 | 后续工作 |
|---|---:|---:|---|
| 最终主仓库 | 已对齐 | 90% | 确认本地领先提交 push 到 GitHub |
| apps/packages 架构 | 已建立 | 85% | 后续继续整理边界 |
| Meta 只读安全 | 基本完成 | 90% | 持续跑 `verify:readonly` |
| MCP tools | 基本完成 | 80% | 可继续增强分析 tool |
| Dashboard UI | 初版完成 | 60% | 增强运营指标与异常入口 |
| 店铺管理 | 初版完成 | 65% | 完善编辑、测试 Token、真实 API |
| 广告账户列表 | 初版完成 | 70% | 增加同步诊断 |
| 账户消耗数据 | 有问题 | 45% | 优先修复同步为 0 |
| 账户深度分析 | 初版完成 | 65% | 增强 Campaign / AdSet / Ad 建议 |
| 店铺真实 ROAS | 初版完成 | 65% | 依赖订单同步实机验证 |
| 国家分析 | 初版完成 | 60% | 增强预算建议 |
| 产品分析 | 初版完成 | 60% | 增强创意联动 |
| 素材分析 | 初版完成 | 55% | 增强疲劳判断 |
| AI 小窗口 | 初版完成 | 60% | 自动注入页面上下文 |
| AI 建议卡片 | 较好 | 75% | 增强筛选、批量处理 |
| Creative Copilot | 本地完成联动 | 70% | 确认 push，增强输出模板 |
| AI 模型设置 | 初版完成 | 70% | 增加测试连接 |
| Worker 自动同步 | 有机制 | 70% | 实机验证、可视化配置 |
| Redis 缓存 | 已接入 | 75% | 增加缓存清理范围测试 |
| 数据保留策略 | 不完整 | 25% | 实现自动归档与清理 |
| 部署文档 | 较完整 | 75% | 跟随后续功能更新 |

整体进度估算：

- 架构骨架：80%
- Meta 只读安全：90%
- 后台页面：60%
- 数据同步：55%
- AI Copilot：60%
- Creative Copilot：70%
- 真实运营可用度：45% - 50%
- 总体完成度：60% - 65%

## 7. 后续开发优先级

请按以下顺序继续，不要先做低频功能。

### 阶段 1：修复 Meta 消耗同步

目标：

- 账户消耗页必须看到真实消耗。
- 不再出现同步后全 0 但不知道原因。

任务：

1. 增加 account-level Insights 同步。
2. 账户汇总优先读取 account-level 数据。
3. 保留 ad-level + country breakdown 用于深度分析。
4. 同步日志记录每个账户的：
   - accountId
   - level
   - breakdown
   - fetched
   - saved
   - error
5. 前端账户消耗页显示：
   - 数据行
   - 最近数据
   - 最近同步状态
   - 错误原因
6. 如果 Meta 返回 0，要明确显示“Meta 返回无数据”，而不是静默 0。

### 阶段 2：打通订单同步

目标：

- Shopline / Shoplazza 订单能真实进入数据库。
- 真实 ROAS 可计算。

任务：

1. 确认 Shopline API 鉴权。
2. 确认 Shoplazza API 鉴权。
3. 实现真实订单接口。
4. 实现增量同步。
5. 隐私字段过滤。
6. 同步日志可视化。
7. 店铺页面增加“测试连接”和“同步订单”。

### 阶段 3：完善自动同步闭环

目标：

- 系统自动同步数据。
- 用户不需要每天手动点按钮。

任务：

1. Worker 实机验证。
2. 后台显示 Worker 状态。
3. 后台配置同步频率。
4. 同步失败自动重试。
5. 最近同步时间显示到 Dashboard。
6. 低内存 VPS 下控制并发。

### 阶段 4：增强 AI 上下文

目标：

AI 小窗口真正知道当前页面和筛选条件。

任务：

1. 当前页面上下文。
2. 当前店铺。
3. 当前账户。
4. 当前 Campaign。
5. 当前 Ad Set。
6. 当前 Ad。
7. 当前日期范围。
8. 当前筛选条件。
9. 点击“问 AI”自动带入上下文。

### 阶段 5：完善 AI Media Buyer 工作流

目标：

把建议变成运营待办。

任务：

1. 规则异常自动生成建议卡片。
2. AI 深度分析只在异常或用户提问时触发。
3. 建议卡片支持：
   - 采纳
   - 拒绝
   - 完成
   - 观察中
   - 备注
4. 每张建议卡片输出：
   - 结论
   - 建议动作
   - 数据依据
   - 风险点
   - 优先级
   - 观察周期
   - 执行清单

### 阶段 6：完善 Creative Copilot

目标：

从表现好的产品 / 国家 / 素材生成创意方向。

任务：

1. 从产品分析页生成创意。
2. 从国家分析页生成本地化创意。
3. 从素材分析页生成新 Hook。
4. 输出：
   - 文案
   - 标题
   - Hook
   - 15 秒视频脚本
   - Reels/TikTok 脚本
   - 图片 Prompt
   - 视频 Prompt
   - A/B Test 方案

## 8. 必须遵守的安全要求

1. AI 不允许操作广告。
2. Meta API 只允许 GET。
3. 不允许新增任何 Meta 写入工具。
4. 不允许上传素材。
5. 不允许创建 / 修改 / 暂停 / 删除广告。
6. Token 必须加密保存。
7. 前端不暴露 Token 明文。
8. 日志不能打印 Token。
9. 日志不能打印客户隐私。
10. CORS 不能使用 `*`。
11. 每次修改后必须运行：

```bash
npm run typecheck
npm test
npm run verify:readonly
npm run build
```

## 9. VPS 更新命令

当代码 push 到 GitHub 后，在 VPS 执行：

```bash
cd /opt/meta-ads-store-analytics-mcp
git pull origin main
docker compose up -d --build
docker compose exec meta-ads-store-analytics-mcp npx prisma migrate deploy
docker compose restart
```

查看 worker：

```bash
docker compose ps
docker compose logs -f worker
```

查看 API：

```bash
docker compose logs -f meta-ads-store-analytics-mcp
```

查看数据库最近 Insights：

```bash
docker compose exec postgres psql -U meta_ads -d meta_ads_analytics
```

SQL：

```sql
select ad_account_id, date, sum(spend), sum(impressions), sum(clicks), count(*)
from meta_daily_insights
group by ad_account_id, date
order by date desc
limit 50;
```

## 10. 给接手模型的核心提醒

当前最重要的不是继续做新页面，而是先让数据准确。

优先级：

1. 修复 Meta 消耗同步为 0。
2. 打通订单同步。
3. 确认 Worker 自动同步。
4. 再增强 AI。

如果底层数据不准，AI Copilot 和 Creative Copilot 都没有运营价值。
