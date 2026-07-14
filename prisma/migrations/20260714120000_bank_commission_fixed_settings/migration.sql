ALTER TABLE "settings"
ADD COLUMN IF NOT EXISTS "bank_commission_distribution_mode" TEXT NOT NULL DEFAULT 'PERCENT',
ADD COLUMN IF NOT EXISTS "bank_commission_central_bank_fixed" DECIMAL(38,18) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "bank_commission_bank_fixed" DECIMAL(38,18) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "bank_commission_partners_fixed" DECIMAL(38,18) NOT NULL DEFAULT 0;
