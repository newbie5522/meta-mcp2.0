ALTER TABLE "stores"
  ADD COLUMN "app_key" TEXT,
  ADD COLUMN "app_secret_encrypted" JSONB;

ALTER TABLE "ad_accounts"
  ADD COLUMN "recent_activity_90d" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "last_activity_checked_at" TIMESTAMP(3),
  ADD COLUMN "last_synced_at" TIMESTAMP(3);

CREATE INDEX "ad_accounts_recent_activity_90d_idx"
  ON "ad_accounts"("recent_activity_90d");
