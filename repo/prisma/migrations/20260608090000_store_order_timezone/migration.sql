ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "timezone_source" TEXT;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "timezone_verified_at" TIMESTAMP(3);

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "created_at_utc" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "store_timezone" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "store_local_datetime" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "store_local_date" DATE;

UPDATE "orders" SET "created_at_utc" = "created_at" WHERE "created_at_utc" IS NULL;
UPDATE "orders" SET "store_local_datetime" = "created_at" WHERE "store_local_datetime" IS NULL;
UPDATE "orders" SET "store_local_date" = "created_at"::date WHERE "store_local_date" IS NULL;

CREATE INDEX IF NOT EXISTS "orders_store_id_store_local_date_idx" ON "orders"("store_id", "store_local_date");
