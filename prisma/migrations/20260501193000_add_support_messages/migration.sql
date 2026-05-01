-- CreateEnum
CREATE TYPE "SupportMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "support_messages" (
    "support_message_id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "role" "SupportMessageRole" NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("support_message_id")
);

-- CreateIndex
CREATE INDEX "support_messages_customer_id_created_at_idx" ON "support_messages"("customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE CASCADE ON UPDATE CASCADE;
