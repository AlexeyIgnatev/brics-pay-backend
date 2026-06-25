-- CreateEnum
CREATE TYPE "Network" AS ENUM ('TRON');

-- CreateEnum
CREATE TYPE "OperationInitiatorType" AS ENUM ('USER', 'SYSTEM', 'RECONCILE', 'WEBHOOK', 'ADMIN');

-- CreateEnum
CREATE TYPE "OperationAddressKind" AS ENUM ('TREASURY', 'USER_WALLET', 'EXTERNAL', 'INTERNAL_LEDGER');

-- CreateEnum
CREATE TYPE "BlockchainTransactionDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "BlockchainTransactionStatus" AS ENUM ('CREATED', 'SIGNED', 'BROADCASTED', 'CONFIRMED', 'FAILED', 'DROPPED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DEBIT', 'CREDIT', 'RESERVE', 'RELEASE', 'COMPENSATION');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('USER_AVAILABLE', 'USER_RESERVED', 'TREASURY_AVAILABLE', 'TREASURY_FEE');

-- CreateEnum
CREATE TYPE "LedgerEntryStatus" AS ENUM ('PENDING', 'POSTED', 'REVERSED');

-- AlterTable
ALTER TABLE "payment_operations"
ADD COLUMN "network" "Network" NOT NULL DEFAULT 'TRON',
ADD COLUMN "source_kind" "OperationAddressKind",
ADD COLUMN "destination_kind" "OperationAddressKind",
ADD COLUMN "amount_raw" TEXT NOT NULL DEFAULT '0',
ADD COLUMN "decimals" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN "initiator_type" "OperationInitiatorType" NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN "last_error_code" TEXT,
ADD COLUMN "last_error_message" TEXT,
ADD COLUMN "webhook_received_at" TIMESTAMP(3),
ADD COLUMN "broadcasted_at" TIMESTAMP(3),
ADD COLUMN "confirmed_at" TIMESTAMP(3),
ADD COLUMN "failed_at" TIMESTAMP(3),
ADD COLUMN "last_reconciled_at" TIMESTAMP(3),
ADD COLUMN "reference_operation_id" INTEGER;

-- Backfill
UPDATE "payment_operations"
SET "amount_raw" = CAST(("amount" * 1000000)::numeric(38,0) AS TEXT)
WHERE "amount_raw" = '0';

-- CreateTable
CREATE TABLE "blockchain_transactions" (
    "id" SERIAL NOT NULL,
    "payment_operation_id" INTEGER NOT NULL,
    "direction" "BlockchainTransactionDirection" NOT NULL,
    "network" "Network" NOT NULL DEFAULT 'TRON',
    "asset" "Asset" NOT NULL,
    "token_contract" TEXT,
    "tx_hash" TEXT,
    "from_address" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "amount_raw" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 6,
    "status" "BlockchainTransactionStatus" NOT NULL DEFAULT 'CREATED',
    "block_number" INTEGER,
    "block_hash" TEXT,
    "block_timestamp" TIMESTAMP(3),
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "nonce_or_sequence" TEXT,
    "gas_payer_address" TEXT,
    "fee_amount" DECIMAL(38,18),
    "fee_amount_raw" TEXT,
    "fee_asset" TEXT,
    "energy_used" INTEGER,
    "bandwidth_used" INTEGER,
    "receipt_status" TEXT,
    "raw_transaction" JSONB,
    "raw_receipt" JSONB,
    "raw_event_logs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blockchain_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" SERIAL NOT NULL,
    "payment_operation_id" INTEGER NOT NULL,
    "blockchain_transaction_id" INTEGER,
    "transaction_id" INTEGER,
    "customer_id" INTEGER NOT NULL,
    "asset" "Asset" NOT NULL,
    "entry_type" "LedgerEntryType" NOT NULL,
    "account_type" "LedgerAccountType" NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "amount_raw" TEXT NOT NULL,
    "balance_before" DECIMAL(38,18),
    "balance_after" DECIMAL(38,18),
    "status" "LedgerEntryStatus" NOT NULL DEFAULT 'POSTED',
    "reference_entry_id" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_operations_network_tx_hash_idx" ON "payment_operations"("network", "tx_hash");

-- CreateIndex
CREATE INDEX "blockchain_transactions_payment_operation_id_status_idx" ON "blockchain_transactions"("payment_operation_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_transactions_network_tx_hash_key" ON "blockchain_transactions"("network", "tx_hash");

-- CreateIndex
CREATE INDEX "ledger_entries_payment_operation_id_status_idx" ON "ledger_entries"("payment_operation_id", "status");

-- CreateIndex
CREATE INDEX "ledger_entries_customer_id_asset_createdAt_idx" ON "ledger_entries"("customer_id", "asset", "createdAt");

-- AddForeignKey
ALTER TABLE "payment_operations" ADD CONSTRAINT "payment_operations_reference_operation_id_fkey" FOREIGN KEY ("reference_operation_id") REFERENCES "payment_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "blockchain_transactions_payment_operation_id_fkey" FOREIGN KEY ("payment_operation_id") REFERENCES "payment_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_operation_id_fkey" FOREIGN KEY ("payment_operation_id") REFERENCES "payment_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_blockchain_transaction_id_fkey" FOREIGN KEY ("blockchain_transaction_id") REFERENCES "blockchain_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reference_entry_id_fkey" FOREIGN KEY ("reference_entry_id") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
