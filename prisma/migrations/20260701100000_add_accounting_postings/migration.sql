-- CreateTable
CREATE TABLE "accounting_postings" (
    "id" SERIAL NOT NULL,
    "posting_group_key" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "transaction_id" INTEGER,
    "payment_operation_id" INTEGER,
    "debit_account_no" TEXT NOT NULL,
    "debit_account_name" TEXT NOT NULL,
    "credit_account_no" TEXT NOT NULL,
    "credit_account_name" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "comment" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_postings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounting_postings_posting_group_key_idx" ON "accounting_postings"("posting_group_key");

-- CreateIndex
CREATE INDEX "accounting_postings_transaction_id_idx" ON "accounting_postings"("transaction_id");

-- CreateIndex
CREATE INDEX "accounting_postings_payment_operation_id_idx" ON "accounting_postings"("payment_operation_id");

-- AddForeignKey
ALTER TABLE "accounting_postings" ADD CONSTRAINT "accounting_postings_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_postings" ADD CONSTRAINT "accounting_postings_payment_operation_id_fkey" FOREIGN KEY ("payment_operation_id") REFERENCES "payment_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
