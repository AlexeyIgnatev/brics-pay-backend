-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "last_login_device" TEXT,
ADD COLUMN     "last_login_ip" TEXT;
