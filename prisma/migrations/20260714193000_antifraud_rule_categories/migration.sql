ALTER TABLE "antifraud_rules"
ADD COLUMN IF NOT EXISTS "category" "TariffCategory" NOT NULL DEFAULT 'K1';

UPDATE "antifraud_rules"
SET "category" = 'K1'
WHERE "category" IS NULL;

DROP INDEX IF EXISTS "antifraud_rules_key_key";

CREATE UNIQUE INDEX IF NOT EXISTS "antifraud_rules_category_key_key"
ON "antifraud_rules"("category", "key");
