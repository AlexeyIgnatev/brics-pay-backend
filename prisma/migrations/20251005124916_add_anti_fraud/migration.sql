-- CreateEnum
CREATE TYPE "AntiFraudRuleKey" AS ENUM ('FIAT_ANY_GE_1M', 'ONE_TIME_GE_8M', 'FREQUENT_OPS_3_30D_EACH_GE_100K', 'WITHDRAW_AFTER_LARGE_INFLOW', 'SPLITTING_TOTAL_14D_GE_1M', 'THIRD_PARTY_DEPOSITS_3_30D_TOTAL_GE_1M', 'AFTER_INACTIVITY_6M', 'MANY_SENDERS_TO_ONE_10_PER_MONTH');

-- CreateEnum
CREATE TYPE "AntiFraudCaseStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "antifraud_rules" (
    "id" SERIAL NOT NULL,
    "key" "AntiFraudRuleKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "period_days" INTEGER,
    "threshold_som" DECIMAL(38,18),
    "min_count" INTEGER,
    "percent_threshold" DECIMAL(5,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "antifraud_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "antifraud_cases" (
    "id" SERIAL NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "rule_key" "AntiFraudRuleKey" NOT NULL,
    "status" "AntiFraudCaseStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "antifraud_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "antifraud_rules_key_key" ON "antifraud_rules"("key");

-- CreateIndex
CREATE UNIQUE INDEX "antifraud_cases_transaction_id_key" ON "antifraud_cases"("transaction_id");

-- AddForeignKey
ALTER TABLE "antifraud_cases" ADD CONSTRAINT "antifraud_cases_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
