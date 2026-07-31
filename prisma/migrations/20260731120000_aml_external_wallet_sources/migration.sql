ALTER TYPE "AntiFraudRuleKey" ADD VALUE IF NOT EXISTS 'EXTERNAL_WALLET_BLOCKLIST';

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "aml_api_url" TEXT,
  ADD COLUMN IF NOT EXISTS "aml_urls_json" TEXT,
  ADD COLUMN IF NOT EXISTS "aml_file_name" TEXT,
  ADD COLUMN IF NOT EXISTS "aml_file_rules_json" TEXT,
  ADD COLUMN IF NOT EXISTS "aml_active_sources_json" TEXT,
  ADD COLUMN IF NOT EXISTS "aml_blocked_wallets_json" TEXT;
