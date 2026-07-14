-- Add USD buy/sell rates to settings
ALTER TABLE "settings"
ADD COLUMN IF NOT EXISTS "usd_buy_rate" DECIMAL(38, 18) NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "usd_sell_rate" DECIMAL(38, 18) NOT NULL DEFAULT 1;
