ALTER TABLE "payment_operations"
DROP CONSTRAINT IF EXISTS "payment_operations_reference_operation_id_fkey";

ALTER TABLE "payment_operations"
DROP COLUMN IF EXISTS "reference_operation_id";

ALTER TABLE "blockchain_transactions"
DROP COLUMN IF EXISTS "block_hash",
DROP COLUMN IF EXISTS "nonce_or_sequence",
DROP COLUMN IF EXISTS "fee_amount",
DROP COLUMN IF EXISTS "raw_transaction",
DROP COLUMN IF EXISTS "raw_receipt",
DROP COLUMN IF EXISTS "raw_event_logs";
