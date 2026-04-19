ALTER TABLE "settings"
ADD COLUMN IF NOT EXISTS "esom_som_conversion_fee_min" DECIMAL(38,18) NOT NULL DEFAULT 0;
