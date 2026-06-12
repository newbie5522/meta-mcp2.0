ALTER TYPE "SyncType" ADD VALUE IF NOT EXISTS 'meta_creatives';

CREATE TABLE "meta_ad_creatives" (
  "id" TEXT NOT NULL,
  "ad_account_id" TEXT NOT NULL,
  "ad_id" TEXT NOT NULL,
  "ad_name" TEXT,
  "creative_id" TEXT,
  "title" TEXT,
  "body" TEXT,
  "image_url" TEXT,
  "video_id" TEXT,
  "link_url" TEXT,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "meta_ad_creatives_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meta_ad_creatives_ad_account_id_ad_id_key"
  ON "meta_ad_creatives"("ad_account_id", "ad_id");
CREATE INDEX "meta_ad_creatives_ad_account_id_idx"
  ON "meta_ad_creatives"("ad_account_id");
CREATE INDEX "meta_ad_creatives_creative_id_idx"
  ON "meta_ad_creatives"("creative_id");

ALTER TABLE "meta_ad_creatives"
  ADD CONSTRAINT "meta_ad_creatives_ad_account_id_fkey"
  FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
