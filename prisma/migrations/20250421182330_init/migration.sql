-- CreateTable
CREATE TABLE "customers" (
    "customer_id" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "private_key" TEXT NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("customer_id")
);
