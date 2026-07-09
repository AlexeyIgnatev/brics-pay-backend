ALTER TABLE "settings"
ADD COLUMN IF NOT EXISTS "bank_commission_central_bank_pct" DECIMAL(5,2) NOT NULL DEFAULT 20,
ADD COLUMN IF NOT EXISTS "bank_commission_bank_pct" DECIMAL(5,2) NOT NULL DEFAULT 40,
ADD COLUMN IF NOT EXISTS "bank_commission_partners_pct" DECIMAL(5,2) NOT NULL DEFAULT 40;
