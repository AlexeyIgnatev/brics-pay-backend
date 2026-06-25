const crypto = require('crypto');
const { NestFactory } = require('@nestjs/core');
const { ConfigService } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { AppModule } = require('../dist/app.module');
const { CryptoService } = require('../dist/config/crypto/crypto.service');
const {
  UsdtTreasuryOrchestratorService,
} = require('../dist/payments/usdt-treasury-orchestrator.service');

if (!globalThis.crypto) {
  globalThis.crypto = crypto.webcrypto;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const prisma = app.get(PrismaClient);
    const configService = app.get(ConfigService);
    const cryptoService = app.get(CryptoService);

    const orchestrator = new UsdtTreasuryOrchestratorService(
      prisma,
      configService,
      cryptoService,
      null,
    );

    const customerId = 2566667;
    const triggerTxHash = `sweep-trigger-${Date.now()}`;
    const fakeSweepTxHash = `sweep-${Date.now()}`;
    const startedAt = new Date();

    const customer = await prisma.customer.findUnique({
      where: { customer_id: customerId },
      select: { customer_id: true, address: true, private_key: true },
    });
    if (!customer) {
      throw new Error(`customer ${customerId} not found`);
    }

    const beforeOps = await prisma.paymentOperation.findMany({
      where: { customer_id: customerId },
      orderBy: { id: 'desc' },
      take: 5,
      select: {
        id: true,
        operation_type: true,
        status: true,
        tx_hash: true,
        payload: true,
      },
    });

    const originalGetUsdtBalance =
      orchestrator.getUsdtBalance.bind(orchestrator);
    const originalSendUsdt = orchestrator.sendUsdt.bind(orchestrator);
    const originalWaitForConfirmation =
      orchestrator.waitForConfirmation.bind(orchestrator);

    orchestrator.getUsdtBalance = async (address) => {
      if (address === customer.address) {
        return 21;
      }
      return originalGetUsdtBalance(address);
    };

    orchestrator.sendUsdt = async () => ({ txHash: fakeSweepTxHash });
    orchestrator.waitForConfirmation = async (txHash) =>
      txHash === fakeSweepTxHash;

    await orchestrator.maybeSweepCustomerWallet(customerId, triggerTxHash);

    const sweepOps = await prisma.paymentOperation.findMany({
      where: {
        customer_id: customerId,
        operation_type: 'SWEEP',
        createdAt: { gte: startedAt },
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        operation_type: true,
        status: true,
        idempotency_key: true,
        customer_id: true,
        from_address: true,
        to_address: true,
        amount: true,
        tx_hash: true,
        attempt_count: true,
        last_error: true,
        payload: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const blockchainTransactions = await prisma.blockchainTransaction.findMany({
      where: {
        payment_operation_id: { in: sweepOps.map((item) => item.id) },
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        payment_operation_id: true,
        direction: true,
        tx_hash: true,
        status: true,
        amount: true,
        fee_amount: true,
        fee_asset: true,
        confirmations: true,
        createdAt: true,
      },
    });

    console.log('customer=', JSON.stringify(customer, null, 2));
    console.log('beforeOps=', JSON.stringify(beforeOps, null, 2));
    console.log('sweepOps=', JSON.stringify(sweepOps, null, 2));
    console.log(
      'blockchainTransactions=',
      JSON.stringify(blockchainTransactions, null, 2),
    );
    console.log('expectedSweepTxHash=', fakeSweepTxHash);
    console.log(
      'result=',
      JSON.stringify(
        {
          ok:
            sweepOps.length > 0 &&
            sweepOps[sweepOps.length - 1].status === 'CONFIRMED' &&
            sweepOps[sweepOps.length - 1].tx_hash === fakeSweepTxHash,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
