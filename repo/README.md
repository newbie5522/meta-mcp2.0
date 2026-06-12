# Meta Ads Store Analytics MCP

目标仓库：`newbie5522/meta-ads-store-analytics-mcp`

这是一个面向多店铺、多 Meta 广告账户的 **AI 广告投放操作系统**。当前版本保留原项目的只读 Meta Ads MCP、安全鉴权、后台登录、Prisma/PostgreSQL、Docker 部署能力，并开始融合两个参考项目的核心思路：

- `yiw16886-create/meta-ai-ads-system`：Dashboard、业务页面、店铺/账户/分析后台体验参考。
- `byadsco/meta-ads-mcp`：MCP Server、Meta 只读 tools、Typed tools、Insights 查询、安全限制参考。

系统定位不是普通广告看板，而是：

1. 广告数据中台
2. AI Media Buyer Copilot
3. AI Creative Copilot
4. Meta Ads MCP 只读分析系统
5. 多店铺订单归因分析
6. Worker 自动同步与规则监测
7. AI 运营建议与创意生成

## 当前架构

```text
apps/
  api/       HTTP API 与后台入口
  worker/    自动同步订单、Meta Insights、规则监测
  mcp/       MCP stdio 入口
  web/       React/Vite 前端预留入口

packages/
  db/        Prisma 访问层
  meta/      Meta 只读能力边界
  analytics/ 规则引擎与分析逻辑
  ai/        OpenAI/Gemini Provider、AI Copilot、Creative Copilot
  cache/     TTL 缓存接口与 Redis key 设计
  auth/      API key 与加密工具
  shopline/  Shopline 只读订单适配
  shoplazza/ Shoplazza 只读订单适配
  erp/       ERP 接口预留
```

数据流：

```text
外部 API
  ↓
worker 自动同步
  ↓
PostgreSQL
  ↓
Redis / TTL Cache
  ↓
API
  ↓
Dashboard
  ↓
AI Copilot / MCP
```

前端和 AI 都不直接请求 Meta 或店铺平台。所有外部数据先由 worker 同步进本地数据库，再由 API 和 MCP 做只读分析。

## 安全边界

Meta 广告账户严格只读：

- `READ_ONLY_MODE=true`
- `graph.facebook.com` 只允许 `GET`
- MCP tools 全部使用 `ads_readonly_*` 命名
- 不注册 create/update/delete/pause/activate/upload/rules/billing/leads/comments 等工具
- AI 只能输出建议，不能执行广告操作
- Store token、AI token 进入数据库前加密
- 前端只展示脱敏 token 状态
- 日志不输出 token、客户姓名、邮箱、电话、详细地址

只读校验：

```bash
npm run verify:readonly
```

## MCP Tools

当前注册的 MCP tools 全部只读：

- `ads_readonly_get_ad_accounts`
- `ads_readonly_get_account_info`
- `ads_readonly_get_campaigns`
- `ads_readonly_get_ad_sets`
- `ads_readonly_get_ads`
- `ads_readonly_get_creatives`
- `ads_readonly_get_insights`
- `ads_readonly_analyze_ad_account`
- `ads_readonly_generate_creative_brief`

`ads_readonly_get_insights` 支持：

- campaign / adset / ad 维度
- country breakdown
- age / gender / publisher_platform / platform_position / impression_device breakdown

## AI 工作流

AI 不是全天候全量扫描广告。正确流程是：

```text
worker 同步数据
  ↓
规则引擎低成本检测异常
  ↓
发现异常后生成建议卡片
  ↓
账户深度分析把 Account / Campaign / Ad Set / Ad / Creative 判断写入 AI 报告
  ↓
需要深度解释时调用 OpenAI / Gemini，未配置时使用本地规则兜底
  ↓
AI 小窗口支持继续追问
  ↓
Creative Copilot 生成文案、Hook、脚本、Prompt、A/B Test 方案
```

AI 输出结构：

1. 结论
2. 建议动作
3. 数据依据
4. 风险点
5. 优先级
6. 观察周期
7. 执行清单

AI Provider 在后台通过 API 保存：

- OpenAI API Key
- Gemini API Key
- 默认聊天模型
- 默认分析模型
- 默认创意模型

密钥会加密保存到 `ai_provider_settings`，不会暴露到前端。

当前 AI 建议页支持：

- 运行规则检测，自动生成异常建议卡片
- 选择单个广告账户和日期范围生成深度分析报告
- 在账户分析页对单个 Campaign、Ad Set、Ad、Creative 生成深度分析
- 将账户、国家、Campaign、Ad Set、Ad、素材判断写入 `ai_analysis_reports`
- 将可执行建议拆成 `ai_action_suggestions`，支持待处理、采纳、完成、拒绝
- 查看建议卡片背后的完整数据依据、风险提醒和执行清单

## 数据库

PostgreSQL + Prisma。

核心表：

- `stores`
- `ad_accounts`
- `campaigns`
- `adsets`
- `ads`
- `creatives`
- `orders`
- `order_items`
- `meta_daily_insights`
- `meta_breakdowns`
- `daily_summaries`
- `sync_logs`
- `ai_provider_settings`
- `ai_conversations`
- `ai_messages`
- `ai_analysis_reports`
- `ai_action_suggestions`

迁移：

```bash
npm run db:generate
npm run db:migrate
```

## Redis / 缓存结构

Docker Compose 内置轻量 Redis：

- 关闭 AOF
- 关闭 RDB save
- `maxmemory=96mb`
- `allkeys-lru`

缓存 key 约定：

- `dashboard:v1:*`
- `store-summary:v1:*`
- `account-summary:v1:*`
- `country-analysis:v1:*`
- `product-analysis:v1:*`
- `creative-analysis:v1:*`
- `trend-analysis:v1:*`
- `ai-report:v1:*`
- `ai-context:v1:*`

所有 key 必须设置 TTL，默认 TTL 在 `packages/cache` 中统一定义。当前 API 会优先使用 Redis，Redis 不可用时自动回退到进程内短 TTL 缓存。为了兼顾 1GB VPS 和运营侧新鲜度，Dashboard / 账户汇总默认 30 秒，breakdown 默认 60 秒。

## Worker 自动同步

Worker 独立服务负责：

- Shopline / Shoplazza 订单同步
- Meta 广告账户同步
- Campaign / Ad Set / Ad / Creative 结构同步
- Meta Insights 同步
- 失败任务重试
- 规则引擎监测
- AI 建议卡片生成

常用配置：

```env
WORKER_ENABLED=true
WORKER_CONCURRENCY=1

ORDER_SYNC_ENABLED=true
ORDER_SYNC_INTERVAL_MINUTES=60
ORDER_SYNC_LOOKBACK_DAYS=7

META_AD_ACCOUNTS_SYNC_ENABLED=true
META_AD_ACCOUNTS_SYNC_INTERVAL_MINUTES=360
META_AD_ACCOUNTS_ACTIVE_LAST_DAYS=90
META_AD_ACCOUNTS_SYNC_LIMIT=500

META_STRUCTURE_SYNC_ENABLED=true
META_STRUCTURE_SYNC_INTERVAL_MINUTES=360
META_STRUCTURE_SYNC_LIMIT=500
META_STRUCTURE_SYNC_MAX_PAGES=10

META_CREATIVES_SYNC_ENABLED=false
META_CREATIVES_SYNC_INTERVAL_MINUTES=720
META_CREATIVES_SYNC_LIMIT=250
META_CREATIVES_SYNC_MAX_PAGES=10

META_INSIGHTS_SYNC_ENABLED=true
META_INSIGHTS_SYNC_INTERVAL_MINUTES=60
META_INSIGHTS_SYNC_DAYS=30
META_INSIGHTS_SYNC_MAX_PAGES=10
META_BREAKDOWN_SYNC_ENABLED=true # age/gender/placement breakdowns for AI audience and placement analysis

RULE_MONITOR_ENABLED=true
RULE_MONITOR_INTERVAL_MINUTES=60

FAILED_SYNC_RETRY_ENABLED=true
FAILED_SYNC_RETRY_INTERVAL_MINUTES=60
```

## Debian VPS 部署

1. 安装基础组件：

```bash
sudo apt update
sudo apt install -y ca-certificates curl git nginx
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

这一步安装 Git、Nginx、Docker 和 Docker Compose 插件。执行后建议退出 SSH 再重新登录，让当前用户获得 Docker 权限。

2. 拉取项目：

```bash
cd /opt
git clone git@github.com:newbie5522/meta-ads-store-analytics-mcp.git
cd /opt/meta-ads-store-analytics-mcp
```

这一步把最终主仓库拉到 VPS。后续更新也只在这个目录执行 `git pull`。

3. 创建环境变量：

```bash
cp .env.example .env
nano .env
```

这一步创建生产配置。必须设置数据库密码、后台账号、API Key、Session Secret、Token 加密密钥、Meta 只读 token、域名和 CORS 来源。

4. 生成密钥：

```bash
openssl rand -base64 32
openssl rand -hex 32
```

第一条适合作为 `SESSION_SECRET`，第二条适合作为 `TOKEN_ENCRYPTION_KEY`。`API_KEY` 也建议使用随机长字符串。

5. 启动服务：

```bash
docker compose up --build -d
```

这一步会启动 PostgreSQL、Redis、API、Worker、MCP 服务。

6. 执行数据库迁移：

```bash
docker compose exec meta-ads-store-analytics-mcp npx prisma migrate deploy
```

如果你更习惯 npm script，下面两个命令等价，也可以使用：

```bash
docker compose exec meta-ads-store-analytics-mcp npm run db:migrate
docker compose exec meta-ads-store-analytics-mcp npm run prisma:migrate
```

这一步把 Prisma 数据表创建或升级到最新版本。

7. 查看服务状态：

```bash
docker compose ps
docker compose logs -f meta-ads-store-analytics-mcp
docker compose logs --tail=100 worker
curl http://127.0.0.1:3000/health
```

这一步确认 API、Worker 和健康检查是否启动成功。如果后台打不开，先看 API 日志；如果没有自动同步数据，先看 worker 日志。

8. 配置 Nginx：

```bash
sudo cp deploy/nginx.example.conf /etc/nginx/sites-available/meta-ads-store-analytics-mcp
sudo sed -i 's/your-domain.example.com/你的域名/g' /etc/nginx/sites-available/meta-ads-store-analytics-mcp
sudo ln -s /etc/nginx/sites-available/meta-ads-store-analytics-mcp /etc/nginx/sites-enabled/meta-ads-store-analytics-mcp
sudo nginx -t
sudo systemctl reload nginx
```

这一步把公网域名反代到 Docker 内的 API 服务。

9. 申请 HTTPS：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名
```

这一步申请 Let's Encrypt 证书，并让后台通过 HTTPS 访问。

10. 打开后台：

```text
https://你的域名/admin/login
```

使用 `.env` 里的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录。

## VPS 更新流程

```bash
cd /opt/meta-ads-store-analytics-mcp
git fetch origin
git pull
docker compose up --build -d
docker compose exec meta-ads-store-analytics-mcp npx prisma migrate deploy
docker compose ps
docker compose logs --tail=100 worker
curl http://127.0.0.1:3000/health
```

这组命令会拉取最新代码、重建容器、执行数据库迁移，并检查 API 与 Worker 是否正常。`worker` 日志里应能看到订单、广告账户、结构、Insights 或规则监测的调度记录。

## 本地验证

```bash
npm install
npm run db:generate
npm run typecheck
npm test
npm run build
npm run verify:readonly
```

## 备份数据库

```bash
sh scripts/backup-postgres.sh
```

恢复：

```bash
docker compose cp ./backups/your-backup.dump postgres:/tmp/restore.dump
docker compose exec -T postgres pg_restore -U meta_ads -d meta_ads_analytics --clean --if-exists /tmp/restore.dump
```

## 当前阶段说明

本次重构完成的是系统级架构底座：

- monorepo 目录已建立
- API / Worker / MCP / Web 入口已拆分
- AI Provider、AI Copilot、Creative Copilot 已接入
- MCP 新增 AI 只读分析 tools
- Worker 自动规则监测已接入
- Worker 已支持自动同步 Meta 广告账户、广告结构、Insights 与订单
- Redis 已接入 Dashboard、账户汇总、店铺 / 国家 / 产品 / 素材 / 趋势分析接口
- Campaign / Ad Set / Ad / Creative 实体同步已落库
- AI 建议卡片工作台已接入，支持筛选、运行规则检测、采纳 / 完成 / 拒绝建议
- Docker Compose 已包含 PostgreSQL、Redis、API、Worker、MCP
- Meta 写入仍然被禁止

后续应继续补强：

- 前端 React/Vite Dashboard 深度迁移
- Shopline / Shoplazza live API 适配校验
- AI 建议详情页、批量处理和负责人分配
