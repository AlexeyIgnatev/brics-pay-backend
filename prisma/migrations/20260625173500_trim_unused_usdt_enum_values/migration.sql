ALTER TABLE "payment_operations"
ALTER COLUMN "initiator_type" DROP DEFAULT;

ALTER TABLE "blockchain_transactions"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "ledger_entries"
ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "OperationInitiatorType_new" AS ENUM ('USER', 'SYSTEM', 'WEBHOOK');
ALTER TABLE "payment_operations"
ALTER COLUMN "initiator_type" TYPE "OperationInitiatorType_new"
USING (
  CASE
    WHEN "initiator_type"::text IN ('RECONCILE', 'ADMIN') THEN 'SYSTEM'
    ELSE "initiator_type"::text
  END
)::"OperationInitiatorType_new";
DROP TYPE "OperationInitiatorType";
ALTER TYPE "OperationInitiatorType_new" RENAME TO "OperationInitiatorType";
ALTER TABLE "payment_operations"
ALTER COLUMN "initiator_type" SET DEFAULT 'SYSTEM';

CREATE TYPE "BlockchainTransactionStatus_new" AS ENUM ('CREATED', 'BROADCASTED', 'CONFIRMED', 'FAILED');
ALTER TABLE "blockchain_transactions"
ALTER COLUMN "status" TYPE "BlockchainTransactionStatus_new"
USING (
  CASE
    WHEN "status"::text = 'SIGNED' THEN 'BROADCASTED'
    WHEN "status"::text = 'DROPPED' THEN 'FAILED'
    ELSE "status"::text
  END
)::"BlockchainTransactionStatus_new";
DROP TYPE "BlockchainTransactionStatus";
ALTER TYPE "BlockchainTransactionStatus_new" RENAME TO "BlockchainTransactionStatus";
ALTER TABLE "blockchain_transactions"
ALTER COLUMN "status" SET DEFAULT 'CREATED';

CREATE TYPE "LedgerEntryType_new" AS ENUM ('DEBIT', 'CREDIT', 'COMPENSATION');
ALTER TABLE "ledger_entries"
ALTER COLUMN "entry_type" TYPE "LedgerEntryType_new"
USING (
  CASE
    WHEN "entry_type"::text = 'RESERVE' THEN 'DEBIT'
    WHEN "entry_type"::text = 'RELEASE' THEN 'CREDIT'
    ELSE "entry_type"::text
  END
)::"LedgerEntryType_new";
DROP TYPE "LedgerEntryType";
ALTER TYPE "LedgerEntryType_new" RENAME TO "LedgerEntryType";

CREATE TYPE "LedgerAccountType_new" AS ENUM ('USER_AVAILABLE');
ALTER TABLE "ledger_entries"
ALTER COLUMN "account_type" TYPE "LedgerAccountType_new"
USING 'USER_AVAILABLE'::"LedgerAccountType_new";
DROP TYPE "LedgerAccountType";
ALTER TYPE "LedgerAccountType_new" RENAME TO "LedgerAccountType";

CREATE TYPE "LedgerEntryStatus_new" AS ENUM ('POSTED');
ALTER TABLE "ledger_entries"
ALTER COLUMN "status" TYPE "LedgerEntryStatus_new"
USING 'POSTED'::"LedgerEntryStatus_new";
DROP TYPE "LedgerEntryStatus";
ALTER TYPE "LedgerEntryStatus_new" RENAME TO "LedgerEntryStatus";
ALTER TABLE "ledger_entries"
ALTER COLUMN "status" SET DEFAULT 'POSTED';
