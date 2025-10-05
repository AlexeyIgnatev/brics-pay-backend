/*
  Warnings:

  - You are about to drop the column `asset` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `som_amount` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the `user_trades` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `amount_in` to the `transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amount_out` to the `transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `asset_in` to the `transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `asset_out` to the `transactions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionKind" ADD VALUE 'CONVERSION';
ALTER TYPE "TransactionKind" ADD VALUE 'WITHDRAW_CRYPTO';

-- DropForeignKey
ALTER TABLE "user_trades" DROP CONSTRAINT "user_trades_customer_id_fkey";

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "asset",
DROP COLUMN "som_amount",
ADD COLUMN     "amount_in" DECIMAL(38,18) NOT NULL,
ADD COLUMN     "amount_out" DECIMAL(38,18) NOT NULL,
ADD COLUMN     "asset_in" "Asset" NOT NULL,
ADD COLUMN     "asset_out" "Asset" NOT NULL,
ADD COLUMN     "external_address" TEXT,
ADD COLUMN     "fee_amount" DECIMAL(38,18),
ADD COLUMN     "notional_usd" DECIMAL(38,18),
ADD COLUMN     "price_usd" DECIMAL(38,18);

-- DropTable
DROP TABLE "user_trades";
