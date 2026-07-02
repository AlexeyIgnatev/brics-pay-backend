const crypto = require('crypto');
if (!globalThis.crypto) {
  globalThis.crypto = crypto.webcrypto;
}

const { NestFactory } = require('@nestjs/core');
const { ModuleRef } = require('@nestjs/core');
const { ConfigService } = require('@nestjs/config');
const { AppModule } = require('../dist/app.module');
const { PrismaService } = require('../dist/config/prisma/prisma.service');
const { EthereumService } = require('../dist/config/ethereum/ethereum.service');
const { BricsService } = require('../dist/config/brics/brics.service');
const { SettingsService } = require('../dist/config/settings/settings.service');
const { BybitExchangeService } = require('../dist/config/exchange/bybit.service');
const { BalanceFetchService } = require('../dist/user-management/balance-fetch.service');
const { AntiFraudService } = require('../dist/antifraud/antifraud.service');
const { CryptoService } = require('../dist/config/crypto/crypto.service');
const {
  UsdtTreasuryOrchestratorService,
} = require('../dist/payments/usdt-treasury-orchestrator.service');
const { PaymentsService } = require('../dist/payments/payments.service');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const prisma = app.get(PrismaService);
    const moduleRef = app.get(ModuleRef);
    const ethereumService = app.get(EthereumService);
    const settingsService = app.get(SettingsService);
    const exchangeService = app.get(BybitExchangeService);
    const balanceFetchService = app.get(BalanceFetchService);
    const antiFraud = app.get(AntiFraudService);
    const cryptoService = app.get(CryptoService);
    const usdtTreasuryOrchestrator = await app.resolve(
      UsdtTreasuryOrchestratorService,
    );
    const bricsService = await app.resolve(BricsService);

    const payments = new PaymentsService(
      prisma,
      ethereumService,
      bricsService,
      moduleRef,
      app.get(ConfigService),
      settingsService,
      exchangeService,
      balanceFetchService,
      antiFraud,
      cryptoService,
      usdtTreasuryOrchestrator,
    );

    const customerId = Number(process.env.SALAM_CUSTOMER_ID || 2566674);
    const amount = Number(process.env.SALAM_AMOUNT || 100);

    if (!Number.isFinite(customerId) || customerId <= 0) {
      throw new Error(`Invalid SALAM_CUSTOMER_ID: ${customerId}`);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Invalid SALAM_AMOUNT: ${amount}`);
    }

    const customer = await prisma.customer.findUnique({
      where: { customer_id: customerId },
      select: {
        customer_id: true,
        address: true,
        private_key: true,
        first_name: true,
        middle_name: true,
        last_name: true,
        phone: true,
        email: true,
      },
    });
    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    const startedAt = new Date();
    const beforeTxId =
      (await prisma.transaction.aggregate({ _max: { id: true } }))._max.id ?? 0;
    const beforePostingId =
      (await prisma.accountingPosting.aggregate({ _max: { id: true } }))._max
        .id ?? 0;
    const beforeBalance = await prisma.userAssetBalance.findMany({
      where: { customer_id: customerId },
      orderBy: { asset: 'asc' },
      select: {
        customer_id: true,
        asset: true,
        balance: true,
        updatedAt: true,
      },
    });

    console.log('customer=', JSON.stringify(customer, null, 2));
    console.log('beforeBalance=', JSON.stringify(beforeBalance, null, 2));
    console.log(
      'serviceCheck=',
      JSON.stringify(
        {
          prismaReady: Boolean((payments).prisma),
          bricsScoped: Boolean(bricsService),
        },
        null,
        2,
      ),
    );

    const result = await payments.fiatToCrypto({ amount }, customerId);
    console.log('fiatToCrypto=', JSON.stringify(result, null, 2));

    const transactions = await prisma.transaction.findMany({
      where: { id: { gt: beforeTxId }, createdAt: { gte: startedAt } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        kind: true,
        status: true,
        amount_in: true,
        asset_in: true,
        amount_out: true,
        asset_out: true,
        fee_amount: true,
        tx_hash: true,
        bank_op_id: true,
        sender_customer_id: true,
        receiver_customer_id: true,
        sender_wallet_address: true,
        receiver_wallet_address: true,
        external_address: true,
        comment: true,
        createdAt: true,
      },
    });

    const accountingPostings = await prisma.accountingPosting.findMany({
      where: { id: { gt: beforePostingId }, createdAt: { gte: startedAt } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        posting_group_key: true,
        sequence: true,
        transaction_id: true,
        payment_operation_id: true,
        debit_account_no: true,
        debit_account_name: true,
        credit_account_no: true,
        credit_account_name: true,
        asset: true,
        amount: true,
        comment: true,
        metadata: true,
        createdAt: true,
      },
    });

    const balances = await prisma.userAssetBalance.findMany({
      where: { customer_id: customerId },
      orderBy: { asset: 'asc' },
      select: {
        customer_id: true,
        asset: true,
        balance: true,
        updatedAt: true,
      },
    });

    console.log('transactions=', JSON.stringify(transactions, null, 2));
    console.log('accountingPostings=', JSON.stringify(accountingPostings, null, 2));
    console.log('balances=', JSON.stringify(balances, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
