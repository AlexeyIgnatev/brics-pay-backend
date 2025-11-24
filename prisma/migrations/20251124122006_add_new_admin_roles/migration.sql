-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminRole" ADD VALUE 'SKK';
ALTER TYPE "AdminRole" ADD VALUE 'UDBO';
ALTER TYPE "AdminRole" ADD VALUE 'UBUIO';
ALTER TYPE "AdminRole" ADD VALUE 'UIT';
