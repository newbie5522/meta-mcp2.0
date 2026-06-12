CREATE TYPE "AiProvider" AS ENUM ('openai', 'gemini');
CREATE TYPE "AiReportType" AS ENUM ('media_buyer', 'creative', 'anomaly', 'chat_followup');
CREATE TYPE "AiSuggestionStatus" AS ENUM ('pending', 'accepted', 'rejected', 'done');

CREATE TABLE "campaigns" (
  "id" TEXT NOT NULL,
  "ad_account_id" TEXT NOT NULL,
  "meta_campaign_id" TEXT NOT NULL,
  "name" TEXT,
  "status" TEXT,
  "objective" TEXT,
  "daily_budget" TEXT,
  "lifetime_budget" TEXT,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "adsets" (
  "id" TEXT NOT NULL,
  "ad_account_id" TEXT NOT NULL,
  "campaign_id" TEXT,
  "meta_adset_id" TEXT NOT NULL,
  "meta_campaign_id" TEXT,
  "name" TEXT,
  "status" TEXT,
  "daily_budget" TEXT,
  "bid_strategy" TEXT,
  "optimization_goal" TEXT,
  "targeting_geo" JSONB,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "adsets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ads" (
  "id" TEXT NOT NULL,
  "ad_account_id" TEXT NOT NULL,
  "campaign_id" TEXT,
  "adset_id" TEXT,
  "meta_ad_id" TEXT NOT NULL,
  "meta_campaign_id" TEXT,
  "meta_adset_id" TEXT,
  "name" TEXT,
  "status" TEXT,
  "creative_id" TEXT,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "meta_breakdowns" (
  "id" TEXT NOT NULL,
  "ad_account_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "level" TEXT NOT NULL,
  "entity_id" TEXT,
  "entity_name" TEXT,
  "breakdown_type" TEXT NOT NULL,
  "breakdown_value" TEXT NOT NULL,
  "metrics" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meta_breakdowns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_summaries" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "scope_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "metrics" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "daily_summaries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_provider_settings" (
  "id" TEXT NOT NULL,
  "provider" "AiProvider" NOT NULL,
  "display_name" TEXT NOT NULL,
  "api_key_encrypted" JSONB NOT NULL,
  "default_chat_model" TEXT,
  "default_analysis_model" TEXT,
  "default_creative_model" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_provider_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_conversations" (
  "id" TEXT NOT NULL,
  "title" TEXT,
  "context" JSONB,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_analysis_reports" (
  "id" TEXT NOT NULL,
  "type" "AiReportType" NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "date_range" JSONB,
  "conclusion" TEXT NOT NULL,
  "data_basis" JSONB NOT NULL,
  "risk_points" JSONB NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 3,
  "observation_window" TEXT,
  "model" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_analysis_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_action_suggestions" (
  "id" TEXT NOT NULL,
  "report_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 3,
  "status" "AiSuggestionStatus" NOT NULL DEFAULT 'pending',
  "execution_checklist" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_action_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaigns_ad_account_id_meta_campaign_id_key" ON "campaigns"("ad_account_id", "meta_campaign_id");
CREATE INDEX "campaigns_ad_account_id_idx" ON "campaigns"("ad_account_id");
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");
CREATE UNIQUE INDEX "adsets_ad_account_id_meta_adset_id_key" ON "adsets"("ad_account_id", "meta_adset_id");
CREATE INDEX "adsets_ad_account_id_idx" ON "adsets"("ad_account_id");
CREATE INDEX "adsets_campaign_id_idx" ON "adsets"("campaign_id");
CREATE INDEX "adsets_status_idx" ON "adsets"("status");
CREATE UNIQUE INDEX "ads_ad_account_id_meta_ad_id_key" ON "ads"("ad_account_id", "meta_ad_id");
CREATE INDEX "ads_ad_account_id_idx" ON "ads"("ad_account_id");
CREATE INDEX "ads_campaign_id_idx" ON "ads"("campaign_id");
CREATE INDEX "ads_adset_id_idx" ON "ads"("adset_id");
CREATE INDEX "ads_status_idx" ON "ads"("status");
CREATE INDEX "meta_breakdowns_ad_account_id_date_idx" ON "meta_breakdowns"("ad_account_id", "date");
CREATE INDEX "meta_breakdowns_level_entity_id_idx" ON "meta_breakdowns"("level", "entity_id");
CREATE INDEX "meta_breakdowns_breakdown_type_breakdown_value_idx" ON "meta_breakdowns"("breakdown_type", "breakdown_value");
CREATE UNIQUE INDEX "daily_summaries_scope_scope_id_date_key" ON "daily_summaries"("scope", "scope_id", "date");
CREATE INDEX "daily_summaries_scope_date_idx" ON "daily_summaries"("scope", "date");
CREATE UNIQUE INDEX "ai_provider_settings_provider_display_name_key" ON "ai_provider_settings"("provider", "display_name");
CREATE INDEX "ai_provider_settings_provider_enabled_idx" ON "ai_provider_settings"("provider", "enabled");
CREATE INDEX "ai_conversations_created_at_idx" ON "ai_conversations"("created_at");
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");
CREATE INDEX "ai_analysis_reports_type_entity_type_entity_id_idx" ON "ai_analysis_reports"("type", "entity_type", "entity_id");
CREATE INDEX "ai_analysis_reports_created_at_idx" ON "ai_analysis_reports"("created_at");
CREATE INDEX "ai_action_suggestions_report_id_idx" ON "ai_action_suggestions"("report_id");
CREATE INDEX "ai_action_suggestions_status_idx" ON "ai_action_suggestions"("status");

ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "adsets" ADD CONSTRAINT "adsets_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "adsets" ADD CONSTRAINT "adsets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ads" ADD CONSTRAINT "ads_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ads" ADD CONSTRAINT "ads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ads" ADD CONSTRAINT "ads_adset_id_fkey" FOREIGN KEY ("adset_id") REFERENCES "adsets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_action_suggestions" ADD CONSTRAINT "ai_action_suggestions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "ai_analysis_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
