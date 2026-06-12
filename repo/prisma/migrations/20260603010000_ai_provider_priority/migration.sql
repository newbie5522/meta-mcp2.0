ALTER TABLE "ai_provider_settings" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100;

CREATE INDEX "ai_provider_settings_enabled_priority_idx" ON "ai_provider_settings"("enabled", "priority");
