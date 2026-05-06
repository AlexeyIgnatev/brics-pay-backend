-- AlterEnum
ALTER TYPE "SupportMessageRole" ADD VALUE 'ADMIN';

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "support_tickets" (
    "support_ticket_id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "closed_by_admin_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("support_ticket_id")
);

-- AddColumn
ALTER TABLE "support_messages" ADD COLUMN "ticket_id" INTEGER;

-- Backfill support tickets for legacy messages (one closed ticket per customer)
WITH legacy_tickets AS (
    INSERT INTO "support_tickets" (
        "customer_id",
        "status",
        "created_at",
        "updated_at",
        "closed_at",
        "last_message_at"
    )
    SELECT
        sm."customer_id",
        'CLOSED'::"SupportTicketStatus",
        MIN(sm."created_at"),
        MAX(sm."created_at"),
        MAX(sm."created_at"),
        MAX(sm."created_at")
    FROM "support_messages" sm
    GROUP BY sm."customer_id"
    RETURNING "support_ticket_id", "customer_id"
)
UPDATE "support_messages" sm
SET "ticket_id" = lt."support_ticket_id"
FROM legacy_tickets lt
WHERE sm."customer_id" = lt."customer_id";

-- SetNotNull
ALTER TABLE "support_messages" ALTER COLUMN "ticket_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "support_tickets_customer_id_status_idx" ON "support_tickets"("customer_id", "status");

-- CreateIndex
CREATE INDEX "support_tickets_status_last_message_at_idx" ON "support_tickets"("status", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_one_open_per_customer" ON "support_tickets"("customer_id") WHERE "status" = 'OPEN';

-- CreateIndex
CREATE INDEX "support_messages_ticket_id_created_at_idx" ON "support_messages"("ticket_id", "created_at");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_closed_by_admin_id_fkey" FOREIGN KEY ("closed_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("support_ticket_id") ON DELETE CASCADE ON UPDATE CASCADE;
