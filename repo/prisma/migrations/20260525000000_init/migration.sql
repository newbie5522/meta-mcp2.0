CREATE TYPE "StorePlatform" AS ENUM ('shopline', 'shoplazza');
CREATE TYPE "StoreStatus" AS ENUM ('active', 'inactive');
CREATE TYPE "SyncType" AS ENUM ('store_profile', 'orders', 'meta_ad_accounts', 'meta_insights', 'mapping_import');
CREATE TYPE "SyncStatus" AS ENUM ('pending', 'running', 'success', 'failed');

CREATE TABLE "stores" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "platform" "StorePlatform" NOT NULL,
  "domain" TEXT NOT NULL,
  "api_base_url" TEXT NOT NULL,
  "currency" TEXT,
  "timezone" TEXT,
  "api_token_encrypted" JSONB NOT NULL,
  "status" "StoreStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ad_accounts" (
  "id" TEXT NOT NULL,
  "meta_account_id" TEXT NOT NULL,
  "name" TEXT,
  "currency" TEXT,
  "timezone" TEXT,
  "status" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ad_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_ad_account_map" (
  "id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "ad_account_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "store_ad_account_map_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orders" (
  "id" TEXT NOT NULL,
  "platform_order_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "order_number" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL,
  "country" TEXT,
  "province" TEXT,
  "city" TEXT,
  "currency" TEXT,
  "total_amount" DECIMAL(18,4),
  "subtotal_amount" DECIMAL(18,4),
  "discount_amount" DECIMAL(18,4),
  "shipping_amount" DECIMAL(18,4),
  "payment_status" TEXT,
  "fulfillment_status" TEXT,
  "source_name" TEXT,
  "landing_page" TEXT,
  "utm_source" TEXT,
  "utm_medium" TEXT,
  "utm_campaign" TEXT,
  "utm_content" TEXT,
  "created_at_system" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at_system" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_items" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "product_id" TEXT,
  "product_name" TEXT,
  "variant_id" TEXT,
  "sku" TEXT,
  "quantity" INTEGER NOT NULL,
  "price" DECIMAL(18,4),
  "total_price" DECIMAL(18,4),
  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "meta_daily_insights" (
  "id" TEXT NOT NULL,
  "ad_account_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "campaign_id" TEXT,
  "campaign_name" TEXT,
  "adset_id" TEXT,
  "adset_name" TEXT,
  "ad_id" TEXT,
  "ad_name" TEXT,
  "country" TEXT,
  "spend" DECIMAL(18,4),
  "impressions" INTEGER,
  "reach" INTEGER,
  "frequency" DECIMAL(18,6),
  "clicks" INTEGER,
  "ctr" DECIMAL(18,6),
  "cpc" DECIMAL(18,6),
  "cpm" DECIMAL(18,6),
  "purchases" INTEGER,
  "purchase_value" DECIMAL(18,4),
  "purchase_roas" DECIMAL(18,6),
  "add_to_cart" INTEGER,
  "initiate_checkout" INTEGER,
  "cost_per_purchase" DECIMAL(18,6),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meta_daily_insights_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sync_logs" (
  "id" TEXT NOT NULL,
  "type" "SyncType" NOT NULL,
  "status" "SyncStatus" NOT NULL DEFAULT 'pending',
  "store_id" TEXT,
  "ad_account_id" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "range_start" TIMESTAMP(3),
  "range_end" TIMESTAMP(3),
  "records_fetched" INTEGER NOT NULL DEFAULT 0,
  "records_saved" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "metadata" JSONB,
  CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stores_platform_domain_key" ON "stores"("platform", "domain");
CREATE INDEX "stores_status_idx" ON "stores"("status");

CREATE UNIQUE INDEX "ad_accounts_meta_account_id_key" ON "ad_accounts"("meta_account_id");
CREATE INDEX "ad_accounts_status_idx" ON "ad_accounts"("status");

CREATE UNIQUE INDEX "store_ad_account_map_ad_account_id_key" ON "store_ad_account_map"("ad_account_id");
CREATE UNIQUE INDEX "store_ad_account_map_store_id_ad_account_id_key" ON "store_ad_account_map"("store_id", "ad_account_id");
CREATE INDEX "store_ad_account_map_store_id_idx" ON "store_ad_account_map"("store_id");

CREATE UNIQUE INDEX "orders_store_id_platform_order_id_key" ON "orders"("store_id", "platform_order_id");
CREATE INDEX "orders_store_id_created_at_idx" ON "orders"("store_id", "created_at");
CREATE INDEX "orders_country_idx" ON "orders"("country");

CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX "order_items_sku_idx" ON "order_items"("sku");

CREATE INDEX "meta_daily_insights_ad_account_id_date_idx" ON "meta_daily_insights"("ad_account_id", "date");
CREATE INDEX "meta_daily_insights_country_idx" ON "meta_daily_insights"("country");
CREATE INDEX "meta_daily_insights_campaign_id_idx" ON "meta_daily_insights"("campaign_id");
CREATE INDEX "meta_daily_insights_adset_id_idx" ON "meta_daily_insights"("adset_id");
CREATE INDEX "meta_daily_insights_ad_id_idx" ON "meta_daily_insights"("ad_id");

CREATE INDEX "sync_logs_type_status_idx" ON "sync_logs"("type", "status");
CREATE INDEX "sync_logs_store_id_started_at_idx" ON "sync_logs"("store_id", "started_at");
CREATE INDEX "sync_logs_ad_account_id_started_at_idx" ON "sync_logs"("ad_account_id", "started_at");

ALTER TABLE "store_ad_account_map"
  ADD CONSTRAINT "store_ad_account_map_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_ad_account_map"
  ADD CONSTRAINT "store_ad_account_map_ad_account_id_fkey"
  FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meta_daily_insights"
  ADD CONSTRAINT "meta_daily_insights_ad_account_id_fkey"
  FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sync_logs"
  ADD CONSTRAINT "sync_logs_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
