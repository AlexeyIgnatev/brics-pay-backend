-- CreateEnum
CREATE TYPE "PaymentOperationType" AS ENUM ('DEPOSIT', 'INTERNAL_TRANSFER', 'WITHDRAW', 'SWEEP', 'COMPENSATION');

-- CreateEnum
CREATE TYPE "PaymentOperationStatus" AS ENUM ('NEW', 'RESERVED', 'DB_COMMITTED', 'BROADCASTED', 'CONFIRMED', 'FAILED', 'COMPENSATED');

-- CreateTable
CREATE TABLE "payment_operations" (
    "id" SERIAL NOT NULL,
    "operation_type" "PaymentOperationType" NOT NULL,
    "status" "PaymentOperationStatus" NOT NULL DEFAULT 'NEW',
    "idempotency_key" TEXT NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "counterparty_customer_id" INTEGER,
    "from_address" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "tx_hash" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "payload" JSONB,
    "reversal_of_id" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_operations_idempotency_key_key" ON "payment_operations"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_operations_tx_hash_key" ON "payment_operations"("tx_hash");

-- CreateIndex
CREATE INDEX "payment_operations_customer_id_status_idx" ON "payment_operations"("customer_id", "status");

-- CreateIndex
CREATE INDEX "payment_operations_operation_type_status_idx" ON "payment_operations"("operation_type", "status");

-- AddForeignKey
ALTER TABLE "payment_operations" ADD CONSTRAINT "payment_operations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_operations" ADD CONSTRAINT "payment_operations_counterparty_customer_id_fkey" FOREIGN KEY ("counterparty_customer_id") REFERENCES "customers"("customer_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_operations" ADD CONSTRAINT "payment_operations_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "payment_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
