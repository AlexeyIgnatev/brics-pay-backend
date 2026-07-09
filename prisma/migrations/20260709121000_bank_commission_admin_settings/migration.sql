ALTER TABLE "settings"
ADD COLUMN IF NOT EXISTS "rates_change_reasons_json" TEXT,
ADD COLUMN IF NOT EXISTS "bank_fee_posting_time_bishkek" TEXT,
ADD COLUMN IF NOT EXISTS "central_bank_som_account" TEXT,
ADD COLUMN IF NOT EXISTS "central_bank_salam_wallet" TEXT,
ADD COLUMN IF NOT EXISTS "central_bank_usdt_wallet" TEXT,
ADD COLUMN IF NOT EXISTS "bank_som_account" TEXT,
ADD COLUMN IF NOT EXISTS "bank_salam_wallet" TEXT,
ADD COLUMN IF NOT EXISTS "bank_usdt_wallet" TEXT,
ADD COLUMN IF NOT EXISTS "bank_commission_partners_json" TEXT;
