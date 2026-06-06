CREATE TYPE "TariffCategory" AS ENUM ('K1', 'K2', 'K3', 'K4', 'K5', 'K6');
CREATE TYPE "CustomerResidency" AS ENUM ('RESIDENT', 'NON_RESIDENT');
CREATE TYPE "TariffOperation" AS ENUM (
  'ESOM_TO_BTC',
  'ESOM_TO_USDT_TRC20',
  'ESOM_TO_ETH',
  'BTC_TO_ETH',
  'BTC_TO_USDT_TRC20',
  'USDT_TRC20_TO_ETH',
  'WALLET_TRANSFER_ESOM',
  'WALLET_TRANSFER_BTC',
  'WALLET_TRANSFER_ETH',
  'WALLET_TRANSFER_USDT_TRC20'
);

ALTER TABLE "customers"
ADD COLUMN "tariff_category" "TariffCategory" NOT NULL DEFAULT 'K1',
ADD COLUMN "residency" "CustomerResidency" NOT NULL DEFAULT 'RESIDENT';

CREATE TABLE "tariff_settings" (
  "id" SERIAL NOT NULL,
  "category" "TariffCategory" NOT NULL,
  "residency" "CustomerResidency" NOT NULL,
  "operation" "TariffOperation" NOT NULL,
  "percent_fee" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "fixed_fee" DECIMAL(38,18) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tariff_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tariff_settings_category_residency_operation_key"
ON "tariff_settings"("category", "residency", "operation");
