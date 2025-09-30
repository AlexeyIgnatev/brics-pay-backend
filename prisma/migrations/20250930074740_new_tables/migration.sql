/*
  Warnings:

  - Added the required column `updatedAt` to the `customers` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "Asset" AS ENUM ('ESOM', 'SOM', 'BTC', 'ETH', 'USDT_TRC20');

-- CreateEnum
CREATE TYPE "WithdrawStatus" AS ENUM ('PENDING', 'SUBMITTED', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('BANK_TO_BANK', 'BANK_TO_WALLET', 'WALLET_TO_BANK', 'WALLET_TO_WALLET');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "first_name" TEXT,
ADD COLUMN     "last_name" TEXT,
ADD COLUMN     "middle_name" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "esom_per_usd" DECIMAL(38,18) NOT NULL,
    "esom_som_conversion_fee_pct" DECIMAL(5,2) NOT NULL,
    "btc_trade_fee_pct" DECIMAL(5,2) NOT NULL,
    "eth_trade_fee_pct" DECIMAL(5,2) NOT NULL,
    "usdt_trade_fee_pct" DECIMAL(5,2) NOT NULL,
    "btc_withdraw_fee_fixed" DECIMAL(38,18) NOT NULL,
    "eth_withdraw_fee_fixed" DECIMAL(38,18) NOT NULL,
    "usdt_withdraw_fee_fixed" DECIMAL(38,18) NOT NULL,
    "min_withdraw_btc" DECIMAL(38,18) NOT NULL,
    "min_withdraw_eth" DECIMAL(38,18) NOT NULL,
    "min_withdraw_usdt_trc20" DECIMAL(38,18) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_asset_balances" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "asset" "Asset" NOT NULL,
    "balance" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_asset_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_trades" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "asset_from" "Asset" NOT NULL,
    "asset_to" "Asset" NOT NULL,
    "amount_from" DECIMAL(38,18) NOT NULL,
    "amount_to" DECIMAL(38,18) NOT NULL,
    "price_usd" DECIMAL(38,18) NOT NULL,
    "notional_usdt" DECIMAL(38,18) NOT NULL,
    "fee_esom" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" SERIAL NOT NULL,
    "kind" "TransactionKind" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "som_amount" DECIMAL(38,18) NOT NULL,
    "asset" "Asset",
    "tx_hash" TEXT,
    "bank_op_id" INTEGER,
    "sender_customer_id" INTEGER,
    "receiver_customer_id" INTEGER,
    "sender_wallet_address" TEXT,
    "receiver_wallet_address" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdraw_requests" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "asset" "Asset" NOT NULL,
    "address" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "fee" DECIMAL(38,18) NOT NULL,
    "txid" TEXT,
    "status" "WithdrawStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdraw_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'SUPER_ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_asset_balances_customer_id_asset_key" ON "user_asset_balances"("customer_id", "asset");

-- CreateIndex
CREATE INDEX "transactions_kind_idx" ON "transactions"("kind");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "transactions_createdAt_idx" ON "transactions"("createdAt");

-- CreateIndex
CREATE INDEX "transactions_sender_customer_id_idx" ON "transactions"("sender_customer_id");

-- CreateIndex
CREATE INDEX "transactions_receiver_customer_id_idx" ON "transactions"("receiver_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- AddForeignKey
ALTER TABLE "user_asset_balances" ADD CONSTRAINT "user_asset_balances_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_trades" ADD CONSTRAINT "user_trades_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sender_customer_id_fkey" FOREIGN KEY ("sender_customer_id") REFERENCES "customers"("customer_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_receiver_customer_id_fkey" FOREIGN KEY ("receiver_customer_id") REFERENCES "customers"("customer_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdraw_requests" ADD CONSTRAINT "withdraw_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;
