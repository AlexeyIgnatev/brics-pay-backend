-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('ANDROID', 'IOS');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "push_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "user_push_tokens" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_push_tokens_token_key" ON "user_push_tokens"("token");

-- CreateIndex
CREATE INDEX "user_push_tokens_customer_id_is_active_idx" ON "user_push_tokens"("customer_id", "is_active");

-- AddForeignKey
ALTER TABLE "user_push_tokens" ADD CONSTRAINT "user_push_tokens_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE CASCADE ON UPDATE CASCADE;
