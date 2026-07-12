import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Asset,
  BlockchainTransactionDirection,
  BlockchainTransactionStatus,
  LedgerAccountType,
  LedgerEntryStatus,
  LedgerEntryType,
  Network,
  OperationAddressKind,
  OperationInitiatorType,
  PaymentOperation,
  PaymentOperationStatus,
  PaymentOperationType,
  PrismaClient,
  TariffOperation,
  TransactionKind,
  TransactionStatus,
} from '@prisma/client';
import TronWeb from 'tronweb';
import { createHash, randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { CryptoService } from '../config/crypto/crypto.service';
import { EthereumService } from '../config/ethereum/ethereum.service';
import { TronService } from '../config/crypto/tron.service';
import { BricsService } from 'src/config/brics/brics.service';
import { StatusOKDto } from 'src/common/dto/status.dto';
import { BalanceFetchService } from '../user-management/balance-fetch.service';
import { BalanceCacheService } from '../user-management/balance-cache.service';
import { SettingsService } from '../config/settings/settings.service';

const USDT_DECIMALS = 6;
const TRON_SUN = 1_000_000;
const SWEEP_THRESHOLD = 10;
const RECONCILE_INTERVAL_MS = 60_000;

type UsdtPaymentPayload = Record<string, unknown>;

interface UsdtRuntime {
  rpcUrl: string;
  tokenAddress: string;
  treasuryPrivateKey: string;
  treasuryAddress: string;
}

interface DepositFinalizeInput {
  customerId: number;
  fromAddress: string;
  toAddress: string;
  amount: number;
  txHash: string;
  operationId: number;
  payload?: UsdtPaymentPayload;
}

interface ChainTransactionSnapshot {
  receipt: Record<string, unknown>;
  transaction: Record<string, unknown>;
  currentBlockNumber: number;
}

interface TronCustomerSnapshot {
  customer_id: number;
  address: string;
  private_key: string;
  status: string;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  tron_address: string;
}

@Injectable()
export class UsdtTreasuryOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(UsdtTreasuryOrchestratorService.name);
  private runtime?: UsdtRuntime;
  private tronWeb?: any;
  private reconcileTimer?: NodeJS.Timeout;
  private reconcileRunning = false;
  private reconcileStartedAt?: number;
  private readonly treasuryUsdtBalanceCache = new Map<
    string,
    { balance: number; expiresAt: number }
  >();
  private readonly treasuryUsdtBalanceCacheTtlMs = 10_000;
  private readonly treasuryUsdtBalanceFetchTimeoutMs = 2_500;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly configService: ConfigService,
    private readonly cryptoService: CryptoService,
    private readonly ethereumService: EthereumService,
    private readonly tronService: TronService,
    private readonly bricsService: BricsService,
    private readonly balanceFetchService: BalanceFetchService,
    private readonly balanceCache: BalanceCacheService,
    private readonly settingsService: SettingsService,
  ) {}

  onModuleInit(): void {
    if (!this.hasRuntimeConfig()) {
      this.logger.warn(
        'USDT treasury orchestrator is disabled because RPC/TOKEN/treasury env is missing',
      );
      return;
    }

    void this.reconcileUsdtOperations();
    this.reconcileTimer = setInterval(() => {
      void this.reconcileUsdtOperations();
    }, RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref?.();
  }

  private hasRuntimeConfig(): boolean {
    return Boolean(
      this.getUsdtRpcUrl() &&
        this.configService.get<string>('USDT_TOKEN_ADDRESS') &&
        this.getTreasuryPrivateKey(),
    );
  }

  private getUsdtRpcUrl(): string | undefined {
    return (
      this.configService.get<string>('USDT_RPC_URL') ||
      this.configService.get<string>('TRON_FULL_NODE')
    )?.trim();
  }

  private readSecretFromFile(
    envKey: string,
    defaultPath?: string,
  ): string | undefined {
    const configuredPath = this.configService.get<string>(envKey)?.trim();
    const path = configuredPath || defaultPath;
    if (!path || !existsSync(path)) {
      return undefined;
    }

    const value = readFileSync(path, 'utf8').trim();
    return value || undefined;
  }

  private getTreasuryPrivateKey(): string | undefined {
    return (
      this.configService.get<string>('USDT_TREASURY_PRIVATE_KEY')?.trim() ||
      this.readSecretFromFile(
        'USDT_TREASURY_PRIVATE_KEY_FILE',
        '/run/secrets/usdt_treasury_private_key',
      )
    );
  }

  private getWebhookSecret(): string | undefined {
    return (
      this.configService.get<string>('USDT_WEBHOOK_SECRET')?.trim() ||
      this.readSecretFromFile(
        'USDT_WEBHOOK_SECRET_FILE',
        '/run/secrets/usdt_webhook_secret',
      )
    );
  }

  private getRuntime(): UsdtRuntime {
    if (this.runtime) return this.runtime;

    const rpcUrl = this.getUsdtRpcUrl();
    const tokenAddress = this.configService.get<string>('USDT_TOKEN_ADDRESS');
    const treasuryPrivateKey = this.getTreasuryPrivateKey();
    if (!rpcUrl || !tokenAddress || !treasuryPrivateKey) {
      throw new BadRequestException('USDT treasury runtime config is missing');
    }

    const treasuryAddress =
      this.cryptoService.trxAddressFromPrivateKey(treasuryPrivateKey);
    this.runtime = {
      rpcUrl,
      tokenAddress,
      treasuryPrivateKey,
      treasuryAddress,
    };
    return this.runtime;
  }

  private getTronWebCtor(): new (options: {
    fullHost: string;
    privateKey: string;
  }) => any {
    const candidate =
      (TronWeb as { TronWeb?: unknown }).TronWeb ??
      (TronWeb as { default?: { TronWeb?: unknown } }).default?.TronWeb ??
      (TronWeb as { default?: unknown }).default ??
      TronWeb;

    if (typeof candidate !== 'function') {
      throw new BadRequestException('TronWeb constructor is unavailable');
    }

    return candidate as new (options: {
      fullHost: string;
      privateKey: string;
    }) => any;
  }

  private getTronWeb(): any {
    if (this.tronWeb) return this.tronWeb;

    const runtime = this.getRuntime();
    const TronWebCtor = this.getTronWebCtor();
    this.tronWeb = new TronWebCtor({
      fullHost: runtime.rpcUrl,
      privateKey: runtime.treasuryPrivateKey,
    });
    return this.tronWeb;
  }

  private async safeSnapshotValue<T>(
    label: string,
    task: Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await task;
    } catch (error) {
      this.logger.warn(
        `USDT reserve snapshot ${label} unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fallback;
    }
  }

  private normalizeKey(value?: string | null): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private resolveUserOperationIdempotencyKey(
    scope: string,
    providedKey?: string | null,
  ): string {
    const normalized = this.normalizeKey(providedKey);
    return normalized ?? `${scope}:${randomUUID()}`;
  }

  private fallbackIdempotencyKey(scope: string, parts: unknown[]): string {
    const raw = [scope, ...parts]
      .map((part) => {
        if (part === null || part === undefined) return '';
        if (typeof part === 'string') return part;
        if (typeof part === 'number' || typeof part === 'boolean')
          return String(part);
        try {
          return JSON.stringify(part);
        } catch {
          return String(part);
        }
      })
      .join('|');
    return createHash('sha256').update(raw).digest('hex');
  }

  private toTronHex(address: string): string {
    return this.getTronWeb().address.toHex(address);
  }

  private sameAddress(left: string, right: string): boolean {
    try {
      return (
        this.toTronHex(left).toLowerCase() ===
        this.toTronHex(right).toLowerCase()
      );
    } catch {
      return left.trim() === right.trim();
    }
  }

  private toRawAmount(amount: number, decimals = USDT_DECIMALS): string {
    return BigInt(Math.floor(amount * 10 ** decimals)).toString();
  }

  private parseDateFromUnixMs(value: unknown): Date | null {
    const parsed = Number(value ?? 0);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return new Date(parsed);
  }

  private getErrorDetails(error: unknown): {
    code?: string;
    message: string;
  } {
    if (error instanceof Error) {
      const typed = error as Error & { code?: string };
      return {
        code: typed.code || error.name || undefined,
        message: error.message,
      };
    }

    return { message: String(error) };
  }

  private async fetchChainTransactionSnapshot(
    txHash: string,
  ): Promise<ChainTransactionSnapshot> {
    const rpcUrl = this.getRuntime().rpcUrl.replace(/\/+$/, '');
    const [receiptText, transactionText, currentBlockText] = await Promise.all([
      this.postJsonRaw(`${rpcUrl}/wallet/gettransactioninfobyid`, {
        value: txHash,
      }),
      this.postJsonRaw(`${rpcUrl}/wallet/gettransactionbyid`, {
        value: txHash,
      }),
      this.postJsonRaw(`${rpcUrl}/wallet/getnowblock`, {}),
    ]);

    const receipt = receiptText.trim()
      ? (JSON.parse(receiptText) as Record<string, unknown>)
      : {};
    const transaction = transactionText.trim()
      ? (JSON.parse(transactionText) as Record<string, unknown>)
      : {};
    const currentBlock = currentBlockText.trim()
      ? (JSON.parse(currentBlockText) as Record<string, unknown>)
      : {};

    const currentBlockNumber = Number(
      (
        currentBlock.block_header as
          | { raw_data?: { number?: number } }
          | undefined
      )?.raw_data?.number ?? 0,
    );

    return { receipt, transaction, currentBlockNumber };
  }

  private async upsertBlockchainTransaction(
    client: PrismaClient | any,
    input: {
      paymentOperationId: number;
      direction: BlockchainTransactionDirection;
      asset: Asset;
      txHash?: string | null;
      fromAddress: string;
      toAddress: string;
      amount: number;
      status: BlockchainTransactionStatus;
      gasPayerAddress?: string | null;
      snapshot?: ChainTransactionSnapshot | null;
    },
  ) {
    const existing = input.txHash
      ? await client.blockchainTransaction.findFirst({
          where: {
            payment_operation_id: input.paymentOperationId,
            tx_hash: input.txHash,
          },
          orderBy: { id: 'asc' },
        })
      : null;

    const receipt = input.snapshot?.receipt ?? {};
    const transaction = input.snapshot?.transaction ?? {};
    const blockNumber = Number(receipt.blockNumber ?? 0) || null;
    const blockTimestamp =
      this.parseDateFromUnixMs(
        receipt.blockTimeStamp ??
          (transaction.raw_data as { timestamp?: number } | undefined)
            ?.timestamp,
      ) ?? null;
    const receiptBlock = receipt as Record<string, unknown>;
    const nestedReceipt = receiptBlock.receipt as
      | Record<string, unknown>
      | undefined;
    const feeRawNumber = Number(
      receiptBlock.fee ??
        receiptBlock.net_fee ??
        receiptBlock.energy_fee ??
        nestedReceipt?.fee ??
        nestedReceipt?.net_fee ??
        nestedReceipt?.energy_fee ??
        0,
    );
    const feeAmountRaw =
      Number.isFinite(feeRawNumber) && feeRawNumber >= 0
        ? String(feeRawNumber)
        : '0';
    const confirmations =
      blockNumber && input.snapshot?.currentBlockNumber
        ? Math.max(input.snapshot.currentBlockNumber - blockNumber + 1, 0)
        : 0;

    const payload = {
      payment_operation_id: input.paymentOperationId,
      direction: input.direction,
      network: Network.TRON,
      asset: input.asset,
      token_contract: this.getRuntime().tokenAddress,
      tx_hash: input.txHash ?? null,
      from_address: input.fromAddress,
      to_address: input.toAddress,
      amount: input.amount.toString(),
      amount_raw: this.toRawAmount(input.amount),
      decimals: USDT_DECIMALS,
      status: input.status,
      block_number: blockNumber,
      block_timestamp: blockTimestamp,
      confirmations,
      gas_payer_address: input.gasPayerAddress ?? null,
      fee_amount_raw: feeAmountRaw,
      fee_asset: 'TRX',
      energy_used:
        Number(
          receiptBlock.energy_usage_total ??
            receiptBlock.energy_usage ??
            nestedReceipt?.energy_usage_total ??
            nestedReceipt?.energy_usage ??
            0,
        ) || 0,
      bandwidth_used:
        Number(receiptBlock.net_usage ?? nestedReceipt?.net_usage ?? 0) || 0,
      receipt_status:
        (receiptBlock.result as string | undefined) ??
        (nestedReceipt?.result as string | undefined) ??
        null,
    };

    if (existing) {
      return client.blockchainTransaction.update({
        where: { id: existing.id },
        data: payload,
      });
    }

    return client.blockchainTransaction.create({
      data: {
        ...payload,
        tx_hash: input.txHash ?? null,
      },
    });
  }

  private async applyLedgerDelta(
    client: PrismaClient | any,
    input: {
      paymentOperationId: number;
      customerId: number;
      asset: Asset;
      delta: number;
      entryType: LedgerEntryType;
      accountType?: LedgerAccountType;
      transactionId?: number | null;
      blockchainTransactionId?: number | null;
      referenceEntryId?: number | null;
      metadata?: UsdtPaymentPayload;
    },
  ) {
    const existingBalance = await client.userAssetBalance.findUnique({
      where: {
        customer_id_asset: {
          customer_id: input.customerId,
          asset: input.asset,
        },
      },
    });

    const before = Number(existingBalance?.balance ?? 0);
    const after = before + input.delta;
    if (after < -1e-12) {
      throw new BadRequestException('Insufficient USDT balance');
    }

    if (existingBalance) {
      await client.userAssetBalance.update({
        where: {
          customer_id_asset: {
            customer_id: input.customerId,
            asset: input.asset,
          },
        },
        data: {
          balance:
            input.delta >= 0
              ? { increment: input.delta.toString() }
              : { decrement: Math.abs(input.delta).toString() },
        },
      });
    } else {
      await client.userAssetBalance.create({
        data: {
          customer_id: input.customerId,
          asset: input.asset,
          balance: after.toString(),
        },
      });
    }

    this.balanceCache.invalidate(input.customerId);

    return client.ledgerEntry.create({
      data: {
        payment_operation_id: input.paymentOperationId,
        blockchain_transaction_id: input.blockchainTransactionId ?? null,
        transaction_id: input.transactionId ?? null,
        customer_id: input.customerId,
        asset: input.asset,
        entry_type: input.entryType,
        account_type: input.accountType ?? LedgerAccountType.USER_AVAILABLE,
        amount: Math.abs(input.delta).toString(),
        amount_raw: this.toRawAmount(Math.abs(input.delta)),
        balance_before: before.toString(),
        balance_after: after.toString(),
        status: LedgerEntryStatus.POSTED,
        reference_entry_id: input.referenceEntryId ?? null,
        metadata: (input.metadata ?? {}) as any,
      },
    });
  }

  private async getCustomer(customerId: number) {
    return this.prisma.customer.findUnique({
      where: { customer_id: customerId },
      select: {
        customer_id: true,
        address: true,
        private_key: true,
        status: true,
        first_name: true,
        middle_name: true,
        last_name: true,
      },
    });
  }

  private resolveCustomerTronAddress(customer: {
    address?: string | null;
    private_key?: string | null;
  }): string | null {
    const privateKey = customer.private_key?.trim();
    if (privateKey) {
      try {
        return this.cryptoService.trxAddressFromPrivateKey(privateKey).trim();
      } catch {
        // Fall back to the stored address below when legacy data is malformed.
      }
    }

    const storedAddress = customer.address?.trim();
    return storedAddress || null;
  }

  private async findCustomerByTronAddress(
    address: string,
  ): Promise<TronCustomerSnapshot | null> {
    const customers = await this.prisma.customer.findMany({
      select: {
        customer_id: true,
        address: true,
        private_key: true,
        status: true,
        first_name: true,
        middle_name: true,
        last_name: true,
      },
    });

    for (const customer of customers) {
      const tronAddress = this.resolveCustomerTronAddress(customer);
      if (!tronAddress) continue;
      if (!this.sameAddress(tronAddress, address)) continue;

      return {
        ...customer,
        tron_address: tronAddress,
      };
    }

    return null;
  }

  private isBrowserWalletCustomer(customer?: {
    first_name?: string | null;
    middle_name?: string | null;
    last_name?: string | null;
  } | null): boolean {
    if (!customer) return false;
    const markers = [
      customer.first_name?.trim().toLowerCase(),
      customer.middle_name?.trim().toLowerCase(),
      customer.last_name?.trim().toLowerCase(),
    ];
    return (
      markers[0] === 'browser' &&
      markers[1] === 'tron' &&
      markers[2] === 'wallet'
    );
  }

  private async ensureCustomer(
    customerId: number,
    address?: string,
    privateKey?: string,
  ) {
    const existing = await this.getCustomer(customerId);
    if (existing) return existing;
    const generated = this.cryptoService.trxAddressFromPrivateKey(
      privateKey ?? this.getRuntime().treasuryPrivateKey,
    );
    return this.prisma.customer.create({
      data: {
        customer_id: customerId,
        address: address ?? generated,
        private_key: privateKey ?? this.getRuntime().treasuryPrivateKey,
      },
      select: {
        customer_id: true,
        address: true,
        private_key: true,
        status: true,
        first_name: true,
        middle_name: true,
        last_name: true,
      },
    });
  }

  private async getUsdtBalance(address: string): Promise<number> {
    const cacheKey = address.trim().toLowerCase();
    const cached = this.treasuryUsdtBalanceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.verbose(
        `[reserve-usdt] cache hit address=${address} balance=${cached.balance}`,
      );
      return cached.balance;
    }

    this.logger.verbose(`[reserve-usdt] fetch start address=${address}`);
    const contract = this.getTronWeb().contract(
      [
        {
          constant: true,
          inputs: [{ name: '_owner', type: 'address' }],
          name: 'balanceOf',
          outputs: [{ name: 'balance', type: 'uint256' }],
          type: 'function',
          stateMutability: 'view',
          payable: false,
        },
      ],
      this.getRuntime().tokenAddress,
    );
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('USDT reserve lookup timed out')),
        this.treasuryUsdtBalanceFetchTimeoutMs,
      ),
    );

    try {
      const balance = await Promise.race([
        contract.balanceOf(address).call(),
        timeoutPromise,
      ]);
      const resolved = Number(balance) / 10 ** USDT_DECIMALS;
      this.treasuryUsdtBalanceCache.set(cacheKey, {
        balance: resolved,
        expiresAt: Date.now() + this.treasuryUsdtBalanceCacheTtlMs,
      });
      this.logger.verbose(
        `[reserve-usdt] fetch done address=${address} balance=${resolved}`,
      );
      return resolved;
    } catch (error) {
      if (cached) {
        this.logger.warn(
          `[reserve-usdt] fetch failed, using cached value address=${address}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return cached.balance;
      }
      throw error;
    }
  }

  private async getTreasuryAccountSnapshot(): Promise<{
    trxBalance: number;
    energyAvailable: number;
    bandwidthAvailable: number;
  }> {
    const runtime = this.getRuntime();
    const rpcUrl = runtime.rpcUrl.replace(/\/+$/, '');
    const address = this.toTronHex(runtime.treasuryAddress);

    const [accountText, resourceText] = await Promise.all([
      this.postJsonRaw(`${rpcUrl}/wallet/getaccount`, { address }),
      this.postJsonRaw(`${rpcUrl}/wallet/getaccountresource`, { address }),
    ]);

    const account = accountText.trim()
      ? (JSON.parse(accountText) as Record<string, unknown>)
      : {};
    const resources = resourceText.trim()
      ? (JSON.parse(resourceText) as Record<string, unknown>)
      : {};

    const trxBalance = Number(account.balance ?? 0) / 10 ** USDT_DECIMALS;
    const energyLimit = Number(resources.EnergyLimit ?? 0);
    const energyUsed = Number(resources.EnergyUsed ?? 0);
    const freeNetLimit = Number(resources.freeNetLimit ?? 0);
    const freeNetUsed = Number(resources.freeNetUsed ?? 0);
    const netLimit = Number(resources.NetLimit ?? 0);
    const netUsed = Number(resources.NetUsed ?? 0);

    return {
      trxBalance: Number.isFinite(trxBalance) ? trxBalance : 0,
      energyAvailable: Math.max(energyLimit - energyUsed, 0),
      bandwidthAvailable: Math.max(
        freeNetLimit - freeNetUsed + (netLimit - netUsed),
        0,
      ),
    };
  }

  private invalidateTreasuryUsdtBalanceCache(): void {
    const treasuryAddress = this.getRuntime().treasuryAddress.trim().toLowerCase();
    this.treasuryUsdtBalanceCache.delete(treasuryAddress);
    this.logger.verbose(
      `[reserve-usdt] cache invalidated address=${this.getRuntime().treasuryAddress}`,
    );
  }

  private async adjustTreasuryUsdtBalanceCache(delta: number): Promise<void> {
    if (!Number.isFinite(delta) || delta === 0) return;

    const treasuryAddress = this.getRuntime().treasuryAddress.trim().toLowerCase();
    const now = Date.now();
    const cached = this.treasuryUsdtBalanceCache.get(treasuryAddress);
    const baseBalance =
      cached && cached.expiresAt > now
        ? cached.balance
        : await this.getUsdtBalance(this.getRuntime().treasuryAddress).catch(
            () => 0,
          );
    const balance = Math.max(0, baseBalance + delta);

    this.treasuryUsdtBalanceCache.set(treasuryAddress, {
      balance,
      expiresAt: now + this.treasuryUsdtBalanceCacheTtlMs,
    });
    this.logger.verbose(
      `[reserve-usdt] cache adjusted address=${this.getRuntime().treasuryAddress} delta=${delta} balance=${balance}`,
    );
  }

  private async getSalamTreasurySnapshot(): Promise<number> {
    const [creditRows, debitRows] = await Promise.all([
      this.prisma.accountingPosting.findMany({
        where: {
          credit_account_no: '21199',
          asset: 'SOM',
        },
        select: { amount: true },
      }),
      this.prisma.accountingPosting.findMany({
        where: {
          debit_account_no: '21199',
          asset: 'SOM',
        },
        select: { amount: true },
      }),
    ]);

    const sum = (rows: { amount: unknown }[]) =>
      rows.reduce((total, row) => {
        const value = Number(row.amount ?? 0);
        return total + (Number.isFinite(value) ? value : 0);
      }, 0);

    const balance = sum(creditRows) - sum(debitRows);
    return Number.isFinite(balance) ? balance : 0;
  }

  private async sumTransactionAssetInput(
    startAt?: Date,
  ): Promise<{ today: number; total: number }> {
    const [todayRows, allRows] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          status: TransactionStatus.SUCCESS,
          asset_in: 'ESOM',
          ...(startAt ? { createdAt: { gte: startAt } } : {}),
        },
        select: { amount_in: true },
      }),
      this.prisma.transaction.findMany({
        where: {
          status: TransactionStatus.SUCCESS,
          asset_in: 'ESOM',
        },
        select: { amount_in: true },
      }),
    ]);

    const sum = (rows: { amount_in: unknown }[]) =>
      rows.reduce((total, row) => {
        const value = Number(row.amount_in ?? 0);
        return total + (Number.isFinite(value) ? value : 0);
      }, 0);

    return {
      today: sum(todayRows),
      total: sum(allRows),
    };
  }

  private async sumBricsBurned(
    startAt?: Date,
  ): Promise<{ today: number; total: number }> {
    const [todayRows, allRows] = await Promise.all([
      this.prisma.accountingPosting.findMany({
        where: {
          debit_account_no: '92602',
          credit_account_no: '90001',
          ...(startAt ? { createdAt: { gte: startAt } } : {}),
        },
        select: { amount: true },
      }),
      this.prisma.accountingPosting.findMany({
        where: {
          debit_account_no: '92602',
          credit_account_no: '90001',
        },
        select: { amount: true },
      }),
    ]);

    const sum = (rows: { amount: unknown }[]) =>
      rows.reduce((total, row) => {
        const value = Number(row.amount ?? 0);
        return total + (Number.isFinite(value) ? value : 0);
      }, 0);

    return {
      today: sum(todayRows),
      total: sum(allRows),
    };
  }

  private async sumBricsBalance(): Promise<number> {
    const [issuedRows, redeemedRows] = await Promise.all([
      this.prisma.accountingPosting.findMany({
        where: {
          debit_account_no: '90001',
          credit_account_no: '92602',
        },
        select: { amount: true },
      }),
      this.prisma.accountingPosting.findMany({
        where: {
          debit_account_no: '92602',
          credit_account_no: '90001',
        },
        select: { amount: true },
      }),
    ]);

    const sum = (rows: { amount: unknown }[]) =>
      rows.reduce((total, row) => {
        const value = Number(row.amount ?? 0);
        return total + (Number.isFinite(value) ? value : 0);
      }, 0);

    return Math.max(sum(issuedRows) - sum(redeemedRows), 0);
  }

  async getTreasuryReserveSnapshot(): Promise<{
    treasury_address: string;
    usdt_balance: number;
    salam_balance: number;
    salam_spent_today: number;
    salam_spent_total: number;
    brics_balance: number;
    trx_balance: number;
    energy_available: number;
    bandwidth_available: number;
    energy_spent_today: number;
    energy_spent_total: number;
    bandwidth_spent_today: number;
    bandwidth_spent_total: number;
    network_fee_trx_today: number;
    network_fee_trx_total: number;
    brics_burned_today: number;
    brics_burned_total: number;
  }> {
    const startedAt = Date.now();
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const runtime = this.getRuntime();
      this.logger.verbose(
        `[reserve-snapshot] start treasury=${runtime.treasuryAddress}`,
      );
      const [
        usdtBalance,
        salamBalance,
        salamSpent,
        bricsBalance,
        bricsBurned,
        accountSnapshot,
        todayTransactions,
        allTransactions,
      ] = await Promise.all([
        this.safeSnapshotValue(
          'USDT balance',
          this.getUsdtBalance(runtime.treasuryAddress),
          0,
        ),
        this.safeSnapshotValue(
          'SALAM balance',
          this.getSalamTreasurySnapshot(),
          0,
        ),
        this.safeSnapshotValue(
          'SALAM spent',
          this.sumTransactionAssetInput(startOfToday),
          { today: 0, total: 0 },
        ),
        this.safeSnapshotValue('BRICS balance', this.sumBricsBalance(), 0),
        this.safeSnapshotValue(
          'BRICS burned',
          this.sumBricsBurned(startOfToday),
          { today: 0, total: 0 },
        ),
        this.safeSnapshotValue(
          'treasury account resources',
          this.getTreasuryAccountSnapshot(),
          {
            trxBalance: 0,
            energyAvailable: 0,
            bandwidthAvailable: 0,
          },
        ),
        this.prisma.blockchainTransaction.findMany({
          where: {
            network: Network.TRON,
            createdAt: { gte: startOfToday },
          },
          select: {
            fee_amount_raw: true,
            energy_used: true,
            bandwidth_used: true,
          },
        }),
        this.prisma.blockchainTransaction.findMany({
          where: { network: Network.TRON },
          select: {
            fee_amount_raw: true,
            energy_used: true,
            bandwidth_used: true,
          },
        }),
      ]);

      const sumFeeTrx = (
        transactions: {
          fee_amount_raw: string | null;
          energy_used: number | null;
          bandwidth_used: number | null;
        }[],
      ) =>
        transactions.reduce((sum, transaction) => {
          const rawFee = Number(transaction.fee_amount_raw ?? 0);
          return sum + (Number.isFinite(rawFee) ? rawFee / TRON_SUN : 0);
        }, 0);

      const sumUsage = (
        transactions: {
          fee_amount_raw: string | null;
          energy_used: number | null;
          bandwidth_used: number | null;
        }[],
        key: 'energy_used' | 'bandwidth_used',
      ) =>
        transactions.reduce((sum, transaction) => {
          const value = Number(transaction[key] ?? 0);
          return sum + (Number.isFinite(value) ? value : 0);
        }, 0);

      return {
        treasury_address: runtime.treasuryAddress,
        usdt_balance: usdtBalance,
        salam_balance: salamBalance,
        salam_spent_today: salamSpent.today,
        salam_spent_total: salamSpent.total,
        brics_balance: bricsBalance,
        trx_balance: accountSnapshot.trxBalance,
        energy_available: accountSnapshot.energyAvailable,
        bandwidth_available: accountSnapshot.bandwidthAvailable,
        energy_spent_today: sumUsage(todayTransactions, 'energy_used'),
        energy_spent_total: sumUsage(allTransactions, 'energy_used'),
        bandwidth_spent_today: sumUsage(todayTransactions, 'bandwidth_used'),
        bandwidth_spent_total: sumUsage(allTransactions, 'bandwidth_used'),
        network_fee_trx_today: sumFeeTrx(todayTransactions),
        network_fee_trx_total: sumFeeTrx(allTransactions),
        brics_burned_today: bricsBurned.today,
        brics_burned_total: bricsBurned.total,
      };
    } catch (error) {
      this.logger.error(
        `USDT reserve snapshot failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        treasury_address: '',
        usdt_balance: 0,
        salam_balance: 0,
        salam_spent_today: 0,
        salam_spent_total: 0,
        brics_balance: 0,
        trx_balance: 0,
        energy_available: 0,
        bandwidth_available: 0,
        energy_spent_today: 0,
        energy_spent_total: 0,
        bandwidth_spent_today: 0,
        bandwidth_spent_total: 0,
        network_fee_trx_today: 0,
        network_fee_trx_total: 0,
        brics_burned_today: 0,
        brics_burned_total: 0,
      };
    } finally {
      const runtime = this.getRuntime();
      this.logger.verbose(
        `[reserve-snapshot] done treasury=${runtime.treasuryAddress} elapsedMs=${Date.now() - startedAt}`,
      );
    }
  }

  private async sendUsdt(
    fromPrivateKey: string,
    toAddress: string,
    amount: number,
  ): Promise<{ txHash: string }> {
    try {
      const fromAddress = this.cryptoService.trxAddressFromPrivateKey(
        fromPrivateKey,
      );
      const { txHash } = await this.tronService.sendTrc20({
        fromPrivateKey,
        toAddress,
        amount,
        tokenAddress: this.getRuntime().tokenAddress,
        feeLimit: 100_000_000,
      });
      if (this.sameAddress(fromAddress, this.getRuntime().treasuryAddress)) {
        await this.adjustTreasuryUsdtBalanceCache(-amount);
      }
      if (this.sameAddress(toAddress, this.getRuntime().treasuryAddress)) {
        await this.adjustTreasuryUsdtBalanceCache(amount);
      }
      return { txHash };
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`TRC20 broadcast failed: ${details}`);
    }
  }

  private async isConfirmedTx(txHash: string): Promise<boolean> {
    const isConfirmedPayload = (
      info: Record<string, unknown> | null | undefined,
    ) => {
      if (!info || typeof info !== 'object') return false;

      const receipt = info.receipt as Record<string, unknown> | undefined;
      if (receipt?.result === 'SUCCESS') return true;

      const blockNumber = Number(info.blockNumber ?? 0);
      if (Number.isFinite(blockNumber) && blockNumber > 0) {
        return true;
      }

      const blockTimeStamp = Number(info.blockTimeStamp ?? 0);
      const minedTxId =
        typeof info.id === 'string'
          ? info.id
          : typeof info.txID === 'string'
            ? info.txID
            : undefined;
      if (
        minedTxId === txHash &&
        Number.isFinite(blockTimeStamp) &&
        blockTimeStamp > 0
      ) {
        return true;
      }

      if (Object.keys(info).length > 0 && !('result' in info)) {
        return true;
      }

      return false;
    };

    try {
      const rawText = await this.postJsonRaw(
        `${this.getRuntime().rpcUrl.replace(/\/+$/, '')}/wallet/gettransactioninfobyid`,
        { value: txHash },
      );
      const info = rawText.trim()
        ? (JSON.parse(rawText) as Record<string, unknown>)
        : {};
      if (isConfirmedPayload(info)) {
        return true;
      }
      this.logger.warn(
        `Raw RPC confirmation payload for tx=${txHash} was not treated as confirmed: ${rawText}`,
      );
    } catch (error) {
      this.logger.warn(
        `Raw RPC confirmation lookup failed for tx=${txHash}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      const info = (await this.getTronWeb().trx.getTransactionInfo(
        txHash,
      )) as Record<string, unknown> | null;
      if (isConfirmedPayload(info)) {
        return true;
      }
      if (info && Object.keys(info).length > 0) {
        this.logger.warn(
          `TronWeb confirmation payload for tx=${txHash} was not treated as confirmed: ${JSON.stringify(info)}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('405')) {
        this.logger.warn(
          `TronWeb confirmation lookup failed for tx=${txHash}: ${message}`,
        );
      }
    }

    try {
      const tx = (await this.getTronWeb().trx.getTransaction(
        txHash,
      )) as Record<string, unknown> | null;
      if (tx && Object.keys(tx).length > 0) {
        this.logger.verbose(
          `Full-node transaction payload for tx=${txHash} was treated as confirmed: ${JSON.stringify(tx)}`,
        );
        return true;
      }
    } catch (error) {
      this.logger.warn(
        `Full-node transaction lookup failed for tx=${txHash}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return false;
  }

  private async postJsonRaw(url: string, body: Record<string, unknown>) {
    const target = new URL(url);
    const payload = JSON.stringify(body);
    const requestImpl =
      target.protocol === 'https:' ? httpsRequest : httpRequest;

    return new Promise<string>((resolve, reject) => {
      const req = requestImpl(
        target,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 10_000,
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            resolve(data);
          });
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error(`request timeout for ${url}`));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  private async finalizeDepositOperation(
    input: DepositFinalizeInput,
  ): Promise<number> {
    const snapshot = await this.fetchChainTransactionSnapshot(
      input.txHash,
    ).catch(() => null);
    const transaction = await this.prisma.$transaction(async (tx) => {
      const currentOp = await tx.paymentOperation.findUnique({
        where: { id: input.operationId },
      });
      if (!currentOp) {
        throw new BadRequestException('USDT deposit operation not found');
      }

      const existingTransaction = await tx.transaction.findFirst({
        where: {
          tx_hash: input.txHash,
          receiver_customer_id: input.customerId,
          asset_in: 'USDT_TRC20',
          asset_out: 'USDT_TRC20',
        },
        orderBy: { id: 'asc' },
      });
      const unresolvedTransaction = existingTransaction
        ? null
        : await tx.transaction.findFirst({
            where: {
              tx_hash: input.txHash,
              receiver_customer_id: null,
              asset_in: 'USDT_TRC20',
              asset_out: 'USDT_TRC20',
              OR: [
                { receiver_wallet_address: input.toAddress },
                { external_address: input.toAddress },
              ],
            },
            orderBy: { id: 'asc' },
          });

      const transactionRecord =
        existingTransaction ??
        (unresolvedTransaction
          ? await tx.transaction.update({
              where: { id: unresolvedTransaction.id },
              data: {
                status: TransactionStatus.SUCCESS,
                sender_wallet_address:
                  unresolvedTransaction.sender_wallet_address ??
                  input.fromAddress,
                receiver_customer_id: input.customerId,
                receiver_wallet_address:
                  unresolvedTransaction.receiver_wallet_address ??
                  input.toAddress,
                comment: unresolvedTransaction.comment ?? 'USDT deposit',
              },
            })
          : await tx.transaction.create({
              data: {
                kind: TransactionKind.WALLET_TO_WALLET,
                status: TransactionStatus.SUCCESS,
                amount_in: input.amount.toString(),
                asset_in: 'USDT_TRC20',
                amount_out: input.amount.toString(),
                asset_out: 'USDT_TRC20',
                tx_hash: input.txHash,
                sender_wallet_address: input.fromAddress,
                receiver_customer_id: input.customerId,
                receiver_wallet_address: input.toAddress,
                comment: 'USDT deposit',
              },
            }));

      const blockchainTransaction = await this.upsertBlockchainTransaction(tx, {
        paymentOperationId: currentOp.id,
        direction: BlockchainTransactionDirection.INBOUND,
        asset: 'USDT_TRC20',
        txHash: input.txHash,
        fromAddress: input.fromAddress,
        toAddress: input.toAddress,
        amount: input.amount,
        status: BlockchainTransactionStatus.CONFIRMED,
        gasPayerAddress: input.fromAddress,
        snapshot,
      });

      if (!existingTransaction) {
        await this.applyLedgerDelta(tx, {
          paymentOperationId: currentOp.id,
          blockchainTransactionId: blockchainTransaction.id,
          transactionId: transactionRecord.id,
          customerId: input.customerId,
          asset: 'USDT_TRC20',
          delta: input.amount,
          entryType: LedgerEntryType.CREDIT,
          metadata: {
            source: 'deposit',
            tx_hash: input.txHash,
            ...(input.payload ?? {}),
          },
        });
      }

      await tx.paymentOperation.update({
        where: { id: currentOp.id },
        data: {
          status: PaymentOperationStatus.CONFIRMED,
          confirmed_at: new Date(),
          payload: {
            ...((currentOp.payload as UsdtPaymentPayload | undefined) ?? {}),
            ...(input.payload ?? {}),
            transaction_id: transactionRecord.id,
            confirmed: true,
          },
          last_error_code: null,
          last_error_message: null,
        },
      });

      return transactionRecord;
    });

    return transaction.id;
  }

  private async waitForConfirmation(
    txHash: string,
    attempts = 3,
    delayMs = 2000,
  ): Promise<boolean> {
    for (let i = 0; i < attempts; i += 1) {
      if (await this.isConfirmedTx(txHash)) return true;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return false;
  }

  private async findOperationByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<PaymentOperation | null> {
    return this.prisma.paymentOperation.findUnique({
      where: { idempotency_key: idempotencyKey },
    });
  }

  private async findOperationByTxHash(
    txHash: string,
  ): Promise<PaymentOperation | null> {
    return this.prisma.paymentOperation.findFirst({
      where: { tx_hash: txHash },
    });
  }

  private async updateOperation(
    id: number,
    data: Record<string, unknown>,
  ): Promise<PaymentOperation> {
    return this.prisma.paymentOperation.update({
      where: { id },
      data: data as any,
    });
  }

  private async createOperation(input: {
    operation_type: PaymentOperationType;
    idempotency_key: string;
    customer_id: number;
    counterparty_customer_id?: number | null;
    from_address: string;
    to_address: string;
    asset: Asset;
    amount: number;
    tx_hash?: string | null;
    status?: PaymentOperationStatus;
    payload?: UsdtPaymentPayload;
    network?: Network;
    initiator_type?: OperationInitiatorType;
    source_kind?: OperationAddressKind | null;
    destination_kind?: OperationAddressKind | null;
    webhook_received_at?: Date | null;
    broadcasted_at?: Date | null;
    confirmed_at?: Date | null;
    failed_at?: Date | null;
    last_reconciled_at?: Date | null;
    reversal_of_id?: number | null;
  }): Promise<PaymentOperation> {
    return this.prisma.paymentOperation.create({
      data: {
        operation_type: input.operation_type,
        idempotency_key: input.idempotency_key,
        customer_id: input.customer_id,
        counterparty_customer_id: input.counterparty_customer_id ?? null,
        network: input.network ?? Network.TRON,
        from_address: input.from_address,
        to_address: input.to_address,
        source_kind: input.source_kind ?? null,
        destination_kind: input.destination_kind ?? null,
        asset: input.asset,
        amount: input.amount.toString(),
        amount_raw: this.toRawAmount(input.amount),
        decimals: USDT_DECIMALS,
        tx_hash: input.tx_hash ?? null,
        status: input.status ?? PaymentOperationStatus.NEW,
        initiator_type: input.initiator_type ?? OperationInitiatorType.SYSTEM,
        payload: input.payload as any,
        webhook_received_at: input.webhook_received_at ?? null,
        broadcasted_at: input.broadcasted_at ?? null,
        confirmed_at: input.confirmed_at ?? null,
        failed_at: input.failed_at ?? null,
        last_reconciled_at: input.last_reconciled_at ?? null,
        reversal_of_id: input.reversal_of_id ?? null,
      },
    });
  }

  private async upsertOperationByKey(
    input: Parameters<UsdtTreasuryOrchestratorService['createOperation']>[0],
  ): Promise<PaymentOperation> {
    const existing = await this.findOperationByIdempotencyKey(
      input.idempotency_key,
    );
    if (existing) return existing;
    return this.createOperation(input);
  }

  private async markFailed(
    op: PaymentOperation,
    error: unknown,
  ): Promise<PaymentOperation> {
    const details = this.getErrorDetails(error);
    return this.updateOperation(op.id, {
      status: PaymentOperationStatus.FAILED,
      last_error_code: details.code ?? null,
      last_error_message: details.message,
      failed_at: new Date(),
      attempt_count: op.attempt_count + 1,
    });
  }

  private async markBroadcasted(
    op: PaymentOperation,
    txHash: string,
    payload?: UsdtPaymentPayload,
  ): Promise<PaymentOperation> {
    return this.updateOperation(op.id, {
      status: PaymentOperationStatus.BROADCASTED,
      tx_hash: txHash,
      broadcasted_at: new Date(),
      payload: {
        ...(payload ?? {}),
        ...((op.payload as UsdtPaymentPayload | undefined) ?? {}),
      } as any,
      attempt_count: op.attempt_count + 1,
    });
  }

  private async markConfirmed(
    op: PaymentOperation,
    payload?: UsdtPaymentPayload,
  ): Promise<PaymentOperation> {
    return this.updateOperation(op.id, {
      status: PaymentOperationStatus.CONFIRMED,
      confirmed_at: new Date(),
      payload: (payload ??
        (op.payload as UsdtPaymentPayload | undefined) ??
        undefined) as any,
      last_error_code: null,
      last_error_message: null,
    });
  }

  private async createTransactionForInternalTransfer(
    client:
      | PrismaClient
      | {
          transaction: PrismaClient['transaction'];
        },
    customerId: number,
    counterpartyCustomerId: number,
    amount: number,
    netAmount: number,
    feeAmount: number,
    txHash: string | null,
    comment: string,
    receiverWalletAddress?: string,
    senderWalletAddress?: string,
  ) {
    return client.transaction.create({
      data: {
        kind: TransactionKind.WALLET_TO_WALLET,
        status: TransactionStatus.SUCCESS,
        amount_in: amount.toString(),
        asset_in: 'USDT_TRC20',
        amount_out: netAmount.toString(),
        asset_out: 'USDT_TRC20',
        fee_amount: feeAmount > 0 ? feeAmount.toString() : null,
        tx_hash: txHash,
        sender_customer_id: customerId,
        receiver_customer_id: counterpartyCustomerId,
        receiver_wallet_address: receiverWalletAddress,
        sender_wallet_address: senderWalletAddress ?? null,
        comment,
      },
    });
  }

  private tariffOperationForWalletTransfer(
    asset: Asset,
  ): TariffOperation | null {
    switch (asset) {
      case 'USDT_TRC20':
        return TariffOperation.WALLET_TRANSFER_USDT_TRC20;
      default:
        return null;
    }
  }

  private async getCustomerTariffFee(
    customerId: number,
    operation: TariffOperation | null,
    baseAmount: number,
  ): Promise<{ fee: number }> {
    if (!operation) return { fee: 0 };

    const customer = await this.prisma.customer.findUnique({
      where: { customer_id: customerId },
      select: { tariff_category: true, residency: true },
    });
    if (!customer) return { fee: 0 };

    const tariff = await this.prisma.tariffSetting.findUnique({
      where: {
        category_residency_operation: {
          category: customer.tariff_category,
          residency: customer.residency,
          operation,
        },
      },
    });
    if (!tariff) return { fee: 0 };

    const percent = Number(tariff.percent_fee || 0);
    const fixed = Number(tariff.fixed_fee || 0);
    const safePercent = Number.isFinite(percent) && percent > 0 ? percent : 0;
    const safeFixed = Number.isFinite(fixed) && fixed > 0 ? fixed : 0;

    return {
      fee: baseAmount * (safePercent / 100) + safeFixed,
    };
  }

  private async createWithdrawTransaction(
    client:
      | PrismaClient
      | {
          transaction: PrismaClient['transaction'];
        },
    customerId: number,
    amount: number,
    address: string,
    txHash: string,
    feeAmount = 0,
  ) {
    return client.transaction.create({
      data: {
        kind: TransactionKind.WITHDRAW_CRYPTO,
        status: TransactionStatus.SUCCESS,
        amount_in: amount.toString(),
        asset_in: 'USDT_TRC20',
        amount_out: amount.toString(),
        asset_out: 'USDT_TRC20',
        fee_amount: feeAmount > 0 ? feeAmount.toString() : null,
        tx_hash: txHash,
        external_address: address,
        sender_customer_id: customerId,
        comment: `USDT withdraw ${amount}`,
      },
    });
  }

  private clampPercent(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
  }

  private splitCommission(
    amount: number,
    centralBankPercent: number,
    bankPercent?: number,
    partnerPercent?: number,
  ): {
    centralBankShare: number;
    bankShare: number;
    partnerShare: number;
  } {
    const centralPercent = this.clampPercent(centralBankPercent);
    const bank = bankPercent != null ? this.clampPercent(bankPercent) : null;
    const partner =
      partnerPercent != null ? this.clampPercent(partnerPercent) : null;
    const explicitTotal =
      bank != null && partner != null ? centralPercent + bank + partner : 0;
    const remainingPercent = Math.max(100 - centralPercent, 0);
    const bankSharePercent =
      bank != null && partner != null
        ? explicitTotal > 0
          ? (bank / explicitTotal) * 100
          : 0
        : remainingPercent / 2;
    const partnerSharePercent =
      bank != null && partner != null
        ? explicitTotal > 0
          ? (partner / explicitTotal) * 100
          : 0
        : remainingPercent / 2;

    return {
      centralBankShare: (amount * centralPercent) / 100,
      bankShare: (amount * bankSharePercent) / 100,
      partnerShare: (amount * partnerSharePercent) / 100,
    };
  }

  private async createCommissionDistributionPostings(
    client:
      | PrismaClient
      | {
          accountingPosting: PrismaClient['accountingPosting'];
        },
    input: {
      transactionId?: number | null;
      paymentOperationId?: number | null;
      postingGroupKey: string;
      feeAmount: number;
      sourceLabel: string;
      transactionRef?: string | null;
      asset?: Asset;
    },
  ): Promise<void> {
    if (!(Number.isFinite(input.feeAmount) && input.feeAmount > 0)) return;

    const adminSettings = await this.settingsService.getAdmin();
    const centralBankPercent = this.clampPercent(
      Number.parseFloat(adminSettings.bank_commission_central_bank_pct),
    );
    const bankPercent = this.clampPercent(
      Number.parseFloat(adminSettings.bank_commission_bank_pct),
    );
    const partnerPercent = this.clampPercent(
      Number.parseFloat(adminSettings.bank_commission_partners_pct),
    );
    const split = this.splitCommission(
      input.feeAmount,
      centralBankPercent,
      bankPercent,
      partnerPercent,
    );
    const partnerConfigs = this.settingsService.parsePartnersJsonForCommission(
      adminSettings.bank_commission_partners_json,
    );
    const partnerTargets = partnerConfigs
      .map((partner, index) => ({
        reference: partner.usdt_wallet?.trim() || '',
        title: partner.title || `Партнер ${index + 1}`,
      }))
      .filter((item) => Boolean(item.reference));

    const targets = [
      {
        reference: adminSettings.central_bank_usdt_wallet?.trim() || '',
        title: 'ЦБ',
        amount: split.centralBankShare,
      },
      {
        reference: adminSettings.bank_usdt_wallet?.trim() || '',
        title: 'Банк',
        amount: split.bankShare,
      },
      ...(partnerTargets.length
        ? partnerTargets.map((partner) => ({
            reference: partner.reference,
            title: partner.title,
            amount: split.partnerShare / partnerTargets.length,
          }))
        : []),
    ].filter((item) => item.reference && item.amount > 0);

    if (!targets.length) return;

    await client.accountingPosting.createMany({
      data: targets.map((target, index) => ({
        posting_group_key: input.postingGroupKey,
        sequence: index + 1,
        transaction_id: input.transactionId ?? null,
        payment_operation_id: input.paymentOperationId ?? null,
        debit_account_no: '21113',
        debit_account_name: 'Транзитный счет комиссий',
        credit_account_no: target.reference,
        credit_account_name: target.title,
        asset: input.asset ?? 'USDT_TRC20',
        amount: target.amount.toString(),
        comment: `${input.sourceLabel}: комиссия`,
        metadata: {
          source_label: input.sourceLabel,
          transaction_ref: input.transactionRef ?? null,
          fee_amount: input.feeAmount,
          fee_split: {
            centralBankPercent,
            bankPercent,
            partnerPercent,
          },
        } as any,
      })),
    });
  }

  async maybeSweepCustomerWallet(
    customerId: number,
    idempotencyHint: string,
  ): Promise<void> {
    const customer = await this.getCustomer(customerId);
    const customerTronAddress =
      customer && this.resolveCustomerTronAddress(customer);
    if (!customerTronAddress || !customer?.private_key) return;

    this.logger.verbose(
      `[sweep] start customer=${customerId} address=${customerTronAddress} idempotencyHint=${idempotencyHint}`,
    );
    let liveBalance: number;
    try {
      liveBalance = await this.getUsdtBalance(customerTronAddress);
    } catch (error) {
      this.logger.warn(
        `USDT sweep skipped for customer=${customerId}: unable to read on-chain balance (${error instanceof Error ? error.message : String(error)})`,
      );
      return;
    }
    this.logger.verbose(
      `[sweep] balance customer=${customerId} address=${customerTronAddress} liveBalance=${liveBalance} threshold=${SWEEP_THRESHOLD}`,
    );
    if (liveBalance <= SWEEP_THRESHOLD) {
      return;
    }

    const sweepKey = this.fallbackIdempotencyKey('usdt-sweep', [
      customerId,
      idempotencyHint,
      customerTronAddress,
      liveBalance,
    ]);
    const existing = await this.findOperationByIdempotencyKey(sweepKey);
    if (existing && existing.status === PaymentOperationStatus.CONFIRMED) {
      return;
    }

    const op =
      existing ??
      (await this.createOperation({
        operation_type: PaymentOperationType.SWEEP,
        idempotency_key: sweepKey,
        customer_id: customerId,
        network: Network.TRON,
        from_address: customerTronAddress,
        to_address: this.getRuntime().treasuryAddress,
        source_kind: OperationAddressKind.USER_WALLET,
        destination_kind: OperationAddressKind.TREASURY,
        asset: 'USDT_TRC20',
        amount: liveBalance,
        initiator_type: OperationInitiatorType.SYSTEM,
        payload: {
          reason: 'balance_threshold',
          threshold: SWEEP_THRESHOLD,
          live_balance: liveBalance,
        },
        status: PaymentOperationStatus.NEW,
      }));

    try {
      const { txHash } = await this.sendUsdt(
        customer.private_key,
        this.getRuntime().treasuryAddress,
        liveBalance,
      );
      this.logger.verbose(
        `[sweep] broadcasted customer=${customerId} txHash=${txHash} amount=${liveBalance}`,
      );
      await this.markBroadcasted(op, txHash, {
        ...((op.payload as UsdtPaymentPayload) ?? {}),
        sweep: true,
      });
      await this.upsertBlockchainTransaction(this.prisma, {
        paymentOperationId: op.id,
        direction: BlockchainTransactionDirection.OUTBOUND,
        asset: 'USDT_TRC20',
        txHash,
        fromAddress: customerTronAddress,
        toAddress: this.getRuntime().treasuryAddress,
        amount: liveBalance,
        status: BlockchainTransactionStatus.BROADCASTED,
        gasPayerAddress: customerTronAddress,
      });
      if (await this.waitForConfirmation(txHash)) {
        const snapshot = await this.fetchChainTransactionSnapshot(txHash).catch(
          () => null,
        );
          await this.upsertBlockchainTransaction(this.prisma, {
            paymentOperationId: op.id,
            direction: BlockchainTransactionDirection.OUTBOUND,
            asset: 'USDT_TRC20',
            txHash,
            fromAddress: customerTronAddress,
            toAddress: this.getRuntime().treasuryAddress,
            amount: liveBalance,
            status: BlockchainTransactionStatus.CONFIRMED,
            gasPayerAddress: customerTronAddress,
            snapshot,
        });
        await this.markConfirmed(op);
        await this.balanceFetchService
          .refreshAllBalancesForUser(customerId, ['USDT_TRC20' as Asset])
          .catch((error) => {
            this.logger.warn(
              `USDT sweep balance refresh failed customer=${customerId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        this.logger.verbose(
          `[sweep] confirmed customer=${customerId} txHash=${txHash} amount=${liveBalance}`,
        );
      }
    } catch (error) {
      await this.markFailed(op, error);
      this.logger.warn(
        `USDT sweep failed for customer=${customerId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async processInternalTransfer(input: {
    senderCustomerId: number;
    receiverCustomerId: number;
    amount: number;
    senderAddress: string;
    receiverAddress: string;
    idempotencyKey?: string;
    payload?: UsdtPaymentPayload;
  }): Promise<StatusOKDto> {
    this.logger.verbose(
      `[internal-transfer] start sender=${input.senderCustomerId} receiver=${input.receiverCustomerId} amount=${input.amount} senderAddress=${input.senderAddress} receiverAddress=${input.receiverAddress} idempotency=${input.idempotencyKey ?? 'null'}`,
    );
    const idempotencyKey = this.resolveUserOperationIdempotencyKey(
      'usdt-internal',
      input.idempotencyKey,
    );

    const existing = await this.findOperationByIdempotencyKey(idempotencyKey);
    if (
      existing?.payload &&
      typeof existing.payload === 'object' &&
      'transaction_id' in existing.payload &&
      existing.status === PaymentOperationStatus.CONFIRMED
    ) {
      return new StatusOKDto(Number((existing.payload as any).transaction_id));
    }

    const op =
      existing ??
      (await this.createOperation({
        operation_type: PaymentOperationType.INTERNAL_TRANSFER,
        idempotency_key: idempotencyKey,
        customer_id: input.senderCustomerId,
        counterparty_customer_id: input.receiverCustomerId,
        network: Network.TRON,
        from_address: input.senderAddress,
        to_address: input.receiverAddress,
        source_kind: OperationAddressKind.INTERNAL_LEDGER,
        destination_kind: OperationAddressKind.INTERNAL_LEDGER,
        asset: 'USDT_TRC20',
        amount: input.amount,
        initiator_type: OperationInitiatorType.USER,
        payload: input.payload ?? {},
        status: PaymentOperationStatus.NEW,
      }));

    try {
      const tariffFee = await this.getCustomerTariffFee(
        input.senderCustomerId,
        this.tariffOperationForWalletTransfer('USDT_TRC20'),
        input.amount,
      );
      const feeAmount = tariffFee.fee > 0 ? tariffFee.fee : 0;
      const receiverNetAmount = Math.max(input.amount - feeAmount, 0);
      this.logger.verbose(
        `[internal-transfer] fee sender=${input.senderCustomerId} receiver=${input.receiverCustomerId} gross=${input.amount} fee=${feeAmount} net=${receiverNetAmount}`,
      );

      const result = await this.prisma.$transaction(async (tx) => {
        const transaction = await this.createTransactionForInternalTransfer(
          tx,
          input.senderCustomerId,
          input.receiverCustomerId,
          input.amount,
          receiverNetAmount,
          feeAmount,
          null,
          'USDT internal transfer',
          input.receiverAddress,
          input.senderAddress,
        );
        if (feeAmount > 0) {
          await this.createCommissionDistributionPostings(tx, {
            transactionId: transaction.id,
            paymentOperationId: op.id,
            postingGroupKey: `usdt-internal-commission-${transaction.id}`,
            feeAmount,
            sourceLabel: 'USDT internal transfer',
            transactionRef: `TX-${transaction.id}`,
            asset: 'USDT_TRC20',
          });
        }

        await this.applyLedgerDelta(tx, {
          paymentOperationId: op.id,
          transactionId: transaction.id,
          customerId: input.senderCustomerId,
          asset: 'USDT_TRC20',
          delta: -input.amount,
          entryType: LedgerEntryType.DEBIT,
          metadata: {
            side: 'sender',
            counterparty_customer_id: input.receiverCustomerId,
            fee_amount: feeAmount,
            ...(input.payload ?? {}),
          },
        });
        this.logger.verbose(
          `[internal-transfer] sender ledger updated customer=${input.senderCustomerId} tx=${transaction.id}`,
        );
        await this.applyLedgerDelta(tx, {
          paymentOperationId: op.id,
          transactionId: transaction.id,
          customerId: input.receiverCustomerId,
          asset: 'USDT_TRC20',
          delta: receiverNetAmount,
          entryType: LedgerEntryType.CREDIT,
          metadata: {
            side: 'receiver',
            counterparty_customer_id: input.senderCustomerId,
            fee_amount: feeAmount,
            ...(input.payload ?? {}),
          },
        });
        this.logger.verbose(
          `[internal-transfer] receiver ledger updated customer=${input.receiverCustomerId} tx=${transaction.id}`,
        );

        await tx.paymentOperation.update({
          where: { id: op.id },
          data: {
            status: PaymentOperationStatus.CONFIRMED,
            confirmed_at: new Date(),
            payload: {
              ...(input.payload ?? {}),
              transaction_id: transaction.id,
              confirmed: true,
            },
            attempt_count: op.attempt_count + 1,
            last_error_code: null,
            last_error_message: null,
          },
        });

        return transaction.id;
      });

      this.logger.verbose(
        `[internal-transfer] confirmed tx=${result} sender=${input.senderCustomerId} receiver=${input.receiverCustomerId}`,
      );

      return new StatusOKDto(result);
    } catch (error) {
      this.logger.warn(
        `[internal-transfer] failed sender=${input.senderCustomerId} receiver=${input.receiverCustomerId} amount=${input.amount}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.markFailed(op, error);
      throw error;
    }
  }

  async processBrowserWalletBridgeTransfer(input: {
    senderCustomerId: number;
    receiverCustomerId: number;
    amount: number;
    senderAddress: string;
    receiverAddress: string;
    senderPrivateKey?: string | null;
    idempotencyKey?: string;
    payload?: UsdtPaymentPayload;
  }): Promise<StatusOKDto> {
    this.logger.verbose(
      `[browser-bridge] start sender=${input.senderCustomerId} receiver=${input.receiverCustomerId} amount=${input.amount} senderAddress=${input.senderAddress} receiverAddress=${input.receiverAddress} idempotency=${input.idempotencyKey ?? 'null'}`,
    );
    const sender = await this.getCustomer(input.senderCustomerId);
    const receiver = await this.getCustomer(input.receiverCustomerId);
    if (!sender || !receiver) {
      throw new BadRequestException('Customer not found');
    }

    const senderIsBrowserWallet = this.isBrowserWalletCustomer(sender);
    const receiverIsBrowserWallet = this.isBrowserWalletCustomer(receiver);
    if (senderIsBrowserWallet === receiverIsBrowserWallet) {
      throw new BadRequestException(
        'Browser wallet bridge requires exactly one browser wallet participant',
      );
    }

    const bridgeDirection = receiverIsBrowserWallet
      ? 'TREASURY_TO_BROWSER'
      : 'BROWSER_TO_TREASURY';
    this.logger.verbose(
      `[browser-bridge] participants senderBrowser=${senderIsBrowserWallet} receiverBrowser=${receiverIsBrowserWallet} direction=${bridgeDirection}`,
    );
    const idempotencyKey = this.resolveUserOperationIdempotencyKey(
      'usdt-browser-bridge',
      input.idempotencyKey,
    );

    const existing = await this.findOperationByIdempotencyKey(idempotencyKey);
    if (
      existing?.payload &&
      typeof existing.payload === 'object' &&
      'transaction_id' in existing.payload &&
      existing.status === PaymentOperationStatus.CONFIRMED
    ) {
      return new StatusOKDto(Number((existing.payload as any).transaction_id));
    }

    const tariffFee = await this.getCustomerTariffFee(
      input.senderCustomerId,
      this.tariffOperationForWalletTransfer('USDT_TRC20'),
      input.amount,
    );
    const feeAmount = tariffFee.fee > 0 ? tariffFee.fee : 0;
    const receiverNetAmount = Math.max(input.amount - feeAmount, 0);
    const senderResolvedAddress = this.resolveCustomerTronAddress(sender);
    const receiverResolvedAddress = this.resolveCustomerTronAddress(receiver);
    const chainSourceAddress = receiverIsBrowserWallet
      ? this.getRuntime().treasuryAddress
      : senderResolvedAddress ?? input.senderAddress;
    const chainDestinationAddress = receiverIsBrowserWallet
      ? receiverResolvedAddress ?? input.receiverAddress
      : this.getRuntime().treasuryAddress;
    const chainSourcePrivateKey = receiverIsBrowserWallet
      ? this.getRuntime().treasuryPrivateKey
      : input.senderPrivateKey ?? sender.private_key;

    if (
      !receiverIsBrowserWallet &&
      senderResolvedAddress &&
      input.senderAddress &&
      !this.sameAddress(senderResolvedAddress, input.senderAddress)
    ) {
      this.logger.warn(
        `[browser-bridge] sender address mismatch customer=${input.senderCustomerId} stored=${input.senderAddress} derived=${senderResolvedAddress}`,
      );
    }
    if (
      receiverIsBrowserWallet &&
      receiverResolvedAddress &&
      input.receiverAddress &&
      !this.sameAddress(receiverResolvedAddress, input.receiverAddress)
    ) {
      this.logger.warn(
        `[browser-bridge] receiver address mismatch customer=${input.receiverCustomerId} stored=${input.receiverAddress} derived=${receiverResolvedAddress}`,
      );
    }

    if (!chainSourcePrivateKey) {
      throw new BadRequestException('Browser wallet private key is missing');
    }

    const op =
      existing ??
      (await this.createOperation({
        operation_type: PaymentOperationType.INTERNAL_TRANSFER,
        idempotency_key: idempotencyKey,
        customer_id: input.senderCustomerId,
        counterparty_customer_id: input.receiverCustomerId,
        network: Network.TRON,
        from_address: chainSourceAddress,
        to_address: chainDestinationAddress,
        source_kind: receiverIsBrowserWallet
          ? OperationAddressKind.TREASURY
          : OperationAddressKind.USER_WALLET,
        destination_kind: receiverIsBrowserWallet
          ? OperationAddressKind.USER_WALLET
          : OperationAddressKind.TREASURY,
        asset: 'USDT_TRC20',
        amount: input.amount,
        initiator_type: OperationInitiatorType.USER,
        payload: {
          ...(input.payload ?? {}),
          source: 'browser-wallet-bridge',
          bridge_direction: bridgeDirection,
          fee_amount: feeAmount,
          sender_is_browser_wallet: senderIsBrowserWallet,
          receiver_is_browser_wallet: receiverIsBrowserWallet,
        },
        status: PaymentOperationStatus.NEW,
      }));

    try {
      const { txHash } = await this.sendUsdt(
        chainSourcePrivateKey,
        chainDestinationAddress,
        input.amount,
      );
      this.logger.verbose(
        `[browser-bridge] broadcasted txHash=${txHash} chainFrom=${chainSourceAddress} chainTo=${chainDestinationAddress} amount=${input.amount}`,
      );

      await this.markBroadcasted(op, txHash, {
        ...((op.payload as UsdtPaymentPayload) ?? {}),
        source: 'browser-wallet-bridge',
        bridge_direction: bridgeDirection,
        fee_amount: feeAmount,
      });

      const snapshot = await this.fetchChainTransactionSnapshot(txHash).catch(
        () => null,
      );

      const result = await this.prisma.$transaction(async (tx) => {
        const transaction = await this.createTransactionForInternalTransfer(
          tx,
          input.senderCustomerId,
          input.receiverCustomerId,
          input.amount,
          receiverNetAmount,
          feeAmount,
          txHash,
          receiverIsBrowserWallet
            ? 'Browser wallet bridge to browser'
            : 'Browser wallet bridge from browser',
          chainDestinationAddress,
          chainSourceAddress,
        );
        if (feeAmount > 0) {
          await this.createCommissionDistributionPostings(tx, {
            transactionId: transaction.id,
            paymentOperationId: op.id,
            postingGroupKey: `usdt-browser-bridge-commission-${transaction.id}`,
            feeAmount,
            sourceLabel: 'USDT browser bridge',
            transactionRef: txHash,
            asset: 'USDT_TRC20',
          });
        }
        this.logger.verbose(
          `[browser-bridge] transaction row created tx=${transaction.id} txHash=${txHash}`,
        );

        await this.applyLedgerDelta(tx, {
          paymentOperationId: op.id,
          transactionId: transaction.id,
          customerId: input.senderCustomerId,
          asset: 'USDT_TRC20',
          delta: -input.amount,
          entryType: LedgerEntryType.DEBIT,
          metadata: {
            side: 'sender',
            bridge_direction: bridgeDirection,
            fee_amount: feeAmount,
            on_chain_from: chainSourceAddress,
            on_chain_to: chainDestinationAddress,
            ...(input.payload ?? {}),
          },
        });
        this.logger.verbose(
          `[browser-bridge] sender ledger updated customer=${input.senderCustomerId} tx=${transaction.id}`,
        );
        await this.applyLedgerDelta(tx, {
          paymentOperationId: op.id,
          transactionId: transaction.id,
          customerId: input.receiverCustomerId,
          asset: 'USDT_TRC20',
          delta: receiverNetAmount,
          entryType: LedgerEntryType.CREDIT,
          metadata: {
            side: 'receiver',
            bridge_direction: bridgeDirection,
            fee_amount: feeAmount,
            on_chain_from: chainSourceAddress,
            on_chain_to: chainDestinationAddress,
            ...(input.payload ?? {}),
          },
        });
        this.logger.verbose(
          `[browser-bridge] receiver ledger updated customer=${input.receiverCustomerId} tx=${transaction.id}`,
        );

        await this.upsertBlockchainTransaction(tx, {
          paymentOperationId: op.id,
          direction: BlockchainTransactionDirection.OUTBOUND,
          asset: 'USDT_TRC20',
          txHash,
          fromAddress: chainSourceAddress,
          toAddress: chainDestinationAddress,
          amount: input.amount,
          status: BlockchainTransactionStatus.CONFIRMED,
          gasPayerAddress: chainSourceAddress,
          snapshot,
        });

        await tx.paymentOperation.update({
          where: { id: op.id },
          data: {
            tx_hash: txHash,
            status: PaymentOperationStatus.BROADCASTED,
            broadcasted_at: op.broadcasted_at ?? new Date(),
            payload: {
              ...((op.payload as UsdtPaymentPayload | undefined) ?? {}),
              transaction_id: transaction.id,
              confirmed: false,
            },
            attempt_count: op.attempt_count + 1,
            last_error_code: null,
            last_error_message: null,
          },
        });

        return transaction.id;
      });
      this.logger.verbose(
        `[browser-bridge] db transaction committed tx=${result} txHash=${txHash}`,
      );

      void this.waitForConfirmation(txHash, 12, 1000)
        .then(async (confirmed) => {
          if (!confirmed) {
            this.logger.warn(
              `Browser wallet bridge tx still not confirmed yet: ${txHash}`,
            );
            return;
          }
          const confirmedSnapshot =
            await this.fetchChainTransactionSnapshot(txHash).catch(() => null);
          await this.prisma.$transaction(async (tx) => {
            await this.upsertBlockchainTransaction(tx, {
              paymentOperationId: op.id,
              direction: BlockchainTransactionDirection.OUTBOUND,
              asset: 'USDT_TRC20',
              txHash,
              fromAddress: chainSourceAddress,
              toAddress: chainDestinationAddress,
              amount: input.amount,
              status: BlockchainTransactionStatus.CONFIRMED,
              gasPayerAddress: chainSourceAddress,
              snapshot: confirmedSnapshot,
            });
            await tx.paymentOperation.update({
              where: { id: op.id },
              data: {
                status: PaymentOperationStatus.CONFIRMED,
                confirmed_at: new Date(),
                payload: {
                  ...((op.payload as UsdtPaymentPayload | undefined) ?? {}),
                  transaction_id: result,
                  confirmed: true,
                },
                last_error_code: null,
                last_error_message: null,
              },
            });
          });
        })
        .catch((error) => {
          this.logger.warn(
            `Browser wallet bridge confirmation watcher failed for tx=${txHash}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });

      if (senderIsBrowserWallet) {
        void this.maybeSweepCustomerWallet(input.senderCustomerId, txHash);
      }
      if (receiverIsBrowserWallet) {
        void this.maybeSweepCustomerWallet(input.receiverCustomerId, txHash);
      }

      return new StatusOKDto(result);
    } catch (error) {
      this.logger.warn(
        `[browser-bridge] failed sender=${input.senderCustomerId} receiver=${input.receiverCustomerId} amount=${input.amount}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.markFailed(op, error);
      throw error;
    }
  }

  async processWithdraw(input: {
    customerId: number;
    amount: number;
    address: string;
    idempotencyKey?: string;
    payload?: UsdtPaymentPayload;
  }): Promise<StatusOKDto> {
    const customer = await this.getCustomer(input.customerId);
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }
    if (customer.status === 'BLOCKED') {
      throw new BadRequestException('User is blocked');
    }

    const idempotencyKey = this.resolveUserOperationIdempotencyKey(
      'usdt-withdraw',
      input.idempotencyKey,
    );

    const existing = await this.findOperationByIdempotencyKey(idempotencyKey);
    if (
      existing?.status === PaymentOperationStatus.CONFIRMED &&
      existing.tx_hash
    ) {
      const tx = await this.prisma.transaction.findFirst({
        where: { tx_hash: existing.tx_hash },
      });
      return new StatusOKDto(tx?.id);
    }

    const op =
      existing ??
      (await this.createOperation({
        operation_type: PaymentOperationType.WITHDRAW,
        idempotency_key: idempotencyKey,
        customer_id: input.customerId,
        network: Network.TRON,
        from_address: customer.address,
        to_address: input.address,
        source_kind: OperationAddressKind.INTERNAL_LEDGER,
        destination_kind: OperationAddressKind.EXTERNAL,
        asset: 'USDT_TRC20',
        amount: input.amount,
        initiator_type: OperationInitiatorType.USER,
        payload: input.payload ?? {},
        status: PaymentOperationStatus.NEW,
      }));

    const tariffFee = await this.getCustomerTariffFee(
      input.customerId,
      this.tariffOperationForWalletTransfer('USDT_TRC20'),
      input.amount,
    );
    const feeAmount = tariffFee.fee > 0 ? tariffFee.fee : 0;
    const totalDebit = input.amount + feeAmount;
    this.logger.verbose(
      `[withdraw] fee customer=${input.customerId} gross=${input.amount} fee=${feeAmount} total_debit=${totalDebit}`,
    );

    let broadcastBlockchainTransaction: { id: number } | null = null;
    try {
      const debitLedgerEntryId = await this.prisma.$transaction(async (tx) => {
        const debitEntry = await this.applyLedgerDelta(tx, {
          paymentOperationId: op.id,
          customerId: input.customerId,
          asset: 'USDT_TRC20',
          delta: -totalDebit,
          entryType: LedgerEntryType.DEBIT,
          metadata: {
            side: 'withdraw',
            destination_address: input.address,
            fee_amount: feeAmount,
            gross_amount: input.amount,
            ...(input.payload ?? {}),
          },
        });

        await tx.paymentOperation.update({
          where: { id: op.id },
          data: {
            status: PaymentOperationStatus.DB_COMMITTED,
            payload: {
              ...(input.payload ?? {}),
              fee_amount: feeAmount,
              gross_amount: input.amount,
              db_committed: true,
              debit_ledger_entry_id: debitEntry.id,
            },
            last_error_code: null,
            last_error_message: null,
          },
        });
        return debitEntry.id;
      });

      const { txHash } = await this.sendUsdt(
        this.getRuntime().treasuryPrivateKey,
        input.address,
        input.amount,
      );
      await this.markBroadcasted(op, txHash, {
        ...(input.payload ?? {}),
        tx_hash: txHash,
        fee_amount: feeAmount,
        gross_amount: input.amount,
      });
      broadcastBlockchainTransaction = await this.upsertBlockchainTransaction(
        this.prisma,
        {
          paymentOperationId: op.id,
          direction: BlockchainTransactionDirection.OUTBOUND,
          asset: 'USDT_TRC20',
          txHash,
          fromAddress: customer.address,
          toAddress: input.address,
          amount: input.amount,
          status: BlockchainTransactionStatus.BROADCASTED,
          gasPayerAddress: this.getRuntime().treasuryAddress,
        },
      );

      if (await this.waitForConfirmation(txHash)) {
        const snapshot = await this.fetchChainTransactionSnapshot(txHash).catch(
          () => null,
        );
        const confirmedTransactionId = await this.prisma.$transaction(
          async (tx) => {
            const blockchainTransaction =
              await this.upsertBlockchainTransaction(tx, {
                paymentOperationId: op.id,
                direction: BlockchainTransactionDirection.OUTBOUND,
                asset: 'USDT_TRC20',
                txHash,
                fromAddress: customer.address,
                toAddress: input.address,
                amount: input.amount,
                status: BlockchainTransactionStatus.CONFIRMED,
                gasPayerAddress: this.getRuntime().treasuryAddress,
                snapshot,
              });
            const transaction = await this.createWithdrawTransaction(
              tx,
              input.customerId,
              input.amount,
              input.address,
              txHash,
              feeAmount,
            );
            if (feeAmount > 0) {
              await this.createCommissionDistributionPostings(tx, {
                transactionId: transaction.id,
                paymentOperationId: op.id,
                postingGroupKey: `usdt-withdraw-commission-${transaction.id}`,
                feeAmount,
                sourceLabel: 'USDT withdraw',
                transactionRef: txHash,
                asset: 'USDT_TRC20',
              });
            }
            if (debitLedgerEntryId > 0) {
              await tx.ledgerEntry.update({
                where: { id: debitLedgerEntryId },
                data: {
                  transaction_id: transaction.id,
                  blockchain_transaction_id: blockchainTransaction.id,
                },
              });
            }

            await tx.paymentOperation.update({
              where: { id: op.id },
              data: {
                status: PaymentOperationStatus.CONFIRMED,
                confirmed_at: new Date(),
                payload: {
                  ...(input.payload ?? {}),
                  tx_hash: txHash,
                  confirmed: true,
                  transaction_id: transaction.id,
                  blockchain_transaction_id: blockchainTransaction.id,
                  debit_ledger_entry_id: debitLedgerEntryId || undefined,
                  fee_amount: feeAmount,
                  gross_amount: input.amount,
                },
                last_error_code: null,
                last_error_message: null,
              },
            });
            return transaction.id;
          },
        );
        return new StatusOKDto(confirmedTransactionId);
      }

      return new StatusOKDto(op.id);
    } catch (error) {
      if (broadcastBlockchainTransaction?.id) {
        await this.prisma.blockchainTransaction.update({
          where: { id: broadcastBlockchainTransaction.id },
          data: { status: BlockchainTransactionStatus.FAILED },
        });
      }
      await this.markFailed(op, error);
      await this.compensateWithdraw(
        op,
        input.customerId,
        totalDebit,
        input.payload,
      );
      throw error;
    }
  }

  private async compensateWithdraw(
    op: PaymentOperation,
    customerId: number,
    amount: number,
    payload?: UsdtPaymentPayload,
  ): Promise<void> {
    const existing = await this.findOperationByIdempotencyKey(`comp:${op.id}`);
    if (existing?.status === PaymentOperationStatus.CONFIRMED) {
      return;
    }

    const compensation =
      existing ??
      (await this.createOperation({
        operation_type: PaymentOperationType.COMPENSATION,
        idempotency_key: `comp:${op.id}`,
        customer_id: customerId,
        network: Network.TRON,
        from_address: op.to_address,
        to_address: op.from_address,
        source_kind: OperationAddressKind.INTERNAL_LEDGER,
        destination_kind: OperationAddressKind.INTERNAL_LEDGER,
        asset: 'USDT_TRC20',
        amount,
        initiator_type: OperationInitiatorType.SYSTEM,
        payload: { ...(payload ?? {}), original_operation_id: op.id },
        reversal_of_id: op.id,
        status: PaymentOperationStatus.NEW,
      }));

    await this.prisma.$transaction(async (tx) => {
      const debitLedgerEntryId = Number(
        ((op.payload as UsdtPaymentPayload | undefined)
          ?.debit_ledger_entry_id ?? 0) as number,
      );
      const compensationEntry = await this.applyLedgerDelta(tx, {
        paymentOperationId: compensation.id,
        customerId,
        asset: 'USDT_TRC20',
        delta: amount,
        entryType: LedgerEntryType.COMPENSATION,
        referenceEntryId: debitLedgerEntryId > 0 ? debitLedgerEntryId : null,
        metadata: {
          original_operation_id: op.id,
          ...(payload ?? {}),
        },
      });
      await tx.paymentOperation.update({
        where: { id: op.id },
        data: {
          status: PaymentOperationStatus.COMPENSATED,
          failed_at: new Date(),
          payload: {
            ...((op.payload as UsdtPaymentPayload | undefined) ?? {}),
            ...(payload ?? {}),
            compensated_by: compensation.id,
            compensation_ledger_entry_id: compensationEntry.id,
          },
        },
      });
      await tx.paymentOperation.update({
        where: { id: compensation.id },
        data: {
          status: PaymentOperationStatus.CONFIRMED,
          confirmed_at: new Date(),
          payload: {
            ...(payload ?? {}),
            compensation: true,
            reference_entry_id:
              debitLedgerEntryId > 0 ? debitLedgerEntryId : undefined,
          },
        },
      });
    });
  }

  private async finalizeWithdrawOperation(
    op: PaymentOperation,
  ): Promise<number | undefined> {
    if (!op.tx_hash) return undefined;

    const snapshot = await this.fetchChainTransactionSnapshot(op.tx_hash).catch(
      () => null,
    );

    return this.prisma.$transaction(async (tx) => {
      const blockchainTransaction = await this.upsertBlockchainTransaction(tx, {
        paymentOperationId: op.id,
        direction: BlockchainTransactionDirection.OUTBOUND,
        asset: op.asset,
        txHash: op.tx_hash ?? null,
        fromAddress: op.from_address,
        toAddress: op.to_address,
        amount: Number(op.amount),
        status: BlockchainTransactionStatus.CONFIRMED,
        gasPayerAddress: this.getRuntime().treasuryAddress,
        snapshot,
      });

      const existingTransaction = await tx.transaction.findFirst({
        where: {
          tx_hash: op.tx_hash,
          sender_customer_id: op.customer_id,
          comment: `USDT withdraw ${Number(op.amount)}`,
        },
        orderBy: { id: 'asc' },
      });

      const transaction =
        existingTransaction ??
        (await this.createWithdrawTransaction(
          tx,
          op.customer_id,
          Number(op.amount),
          op.to_address,
          op.tx_hash!,
          Number((op.payload as UsdtPaymentPayload | undefined)?.fee_amount ?? 0),
        ));

      const debitLedgerEntryId = Number(
        ((op.payload as UsdtPaymentPayload | undefined)
          ?.debit_ledger_entry_id ?? 0) as number,
      );
      if (debitLedgerEntryId > 0) {
        await tx.ledgerEntry.update({
          where: { id: debitLedgerEntryId },
          data: {
            transaction_id: transaction.id,
            blockchain_transaction_id: blockchainTransaction.id,
          },
        });
      }

      await tx.paymentOperation.update({
        where: { id: op.id },
        data: {
          status: PaymentOperationStatus.CONFIRMED,
          confirmed_at: new Date(),
          payload: {
            ...((op.payload as UsdtPaymentPayload | undefined) ?? {}),
            tx_hash: op.tx_hash,
            confirmed: true,
            transaction_id: transaction.id,
            blockchain_transaction_id: blockchainTransaction.id,
            debit_ledger_entry_id: debitLedgerEntryId || undefined,
          },
          last_error_code: null,
          last_error_message: null,
        },
      });

      return transaction.id;
    });
  }

  private async finalizeSweepOperation(op: PaymentOperation): Promise<void> {
    if (!op.tx_hash) return;

    const snapshot = await this.fetchChainTransactionSnapshot(op.tx_hash).catch(
      () => null,
    );
    const blockchainTransaction = await this.upsertBlockchainTransaction(
      this.prisma,
      {
        paymentOperationId: op.id,
        direction: BlockchainTransactionDirection.OUTBOUND,
        asset: op.asset,
        txHash: op.tx_hash,
        fromAddress: op.from_address,
        toAddress: op.to_address,
        amount: Number(op.amount),
        status: BlockchainTransactionStatus.CONFIRMED,
        gasPayerAddress: op.from_address,
        snapshot,
      },
    );

    await this.markConfirmed(op, {
      ...((op.payload as UsdtPaymentPayload | undefined) ?? {}),
      blockchain_transaction_id: blockchainTransaction.id,
      confirmed: true,
    });
  }

  async handleUsdtDepositWebhook(
    dto: {
      tx_hash: string;
      from_address: string;
      to_address: string;
      amount: number;
      idempotency_key?: string;
      payload?: UsdtPaymentPayload;
    },
    webhookSecret?: string,
  ): Promise<StatusOKDto> {
    const expectedSecret = this.getWebhookSecret();
    if (expectedSecret && webhookSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    const customer = await this.findCustomerByTronAddress(dto.to_address);
    if (!customer) {
      throw new BadRequestException('Unknown USDT deposit recipient');
    }
    if (customer.status === 'BLOCKED') {
      throw new BadRequestException('User is blocked');
    }

    const idempotencyKey =
      this.normalizeKey(dto.idempotency_key) ??
      this.fallbackIdempotencyKey('usdt-deposit', [dto.tx_hash]);

    const existing =
      (await this.findOperationByIdempotencyKey(idempotencyKey)) ??
      (await this.findOperationByTxHash(dto.tx_hash));
    if (existing?.status === PaymentOperationStatus.CONFIRMED) {
      return new StatusOKDto(
        Number(
          (existing.payload as UsdtPaymentPayload | undefined)
            ?.transaction_id ?? existing.id,
        ),
      );
    }
    if (
      existing?.payload &&
      typeof existing.payload === 'object' &&
      'transaction_id' in existing.payload
    ) {
      return new StatusOKDto(existing.id);
    }

    const confirmed = await this.isConfirmedTx(dto.tx_hash);
    const op =
      existing ??
      (await this.createOperation({
        operation_type: PaymentOperationType.DEPOSIT,
        idempotency_key: idempotencyKey,
        customer_id: customer.customer_id,
        network: Network.TRON,
        from_address: dto.from_address,
        to_address: dto.to_address,
        source_kind: OperationAddressKind.TREASURY,
        destination_kind: OperationAddressKind.USER_WALLET,
        asset: 'USDT_TRC20',
        amount: dto.amount,
        tx_hash: dto.tx_hash,
        initiator_type: OperationInitiatorType.WEBHOOK,
        payload: dto.payload ?? {},
        webhook_received_at: new Date(),
        status: confirmed
          ? PaymentOperationStatus.BROADCASTED
          : PaymentOperationStatus.NEW,
      }));

    if (!confirmed) {
      await this.markBroadcasted(op, dto.tx_hash, dto.payload ?? {});
      return new StatusOKDto(op.id);
    }

    const transactionId = await this.finalizeDepositOperation({
      customerId: customer.customer_id,
      fromAddress: dto.from_address,
      toAddress: dto.to_address,
      amount: dto.amount,
      txHash: dto.tx_hash,
      operationId: op.id,
      payload: dto.payload ?? {},
    });

    try {
      await this.maybeSweepCustomerWallet(customer.customer_id, dto.tx_hash);
    } catch (error) {
      this.logger.warn(
        `USDT post-deposit sweep failed for customer=${customer.customer_id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return new StatusOKDto(transactionId);
  }

  async reconcileUsdtOperations(): Promise<StatusOKDto> {
    if (this.reconcileRunning) {
      const startedAt = this.reconcileStartedAt ?? 0;
      const elapsedMs = startedAt ? Date.now() - startedAt : 0;
      if (elapsedMs > RECONCILE_INTERVAL_MS * 5) {
        this.logger.warn(
          `USDT reconcile lock was stale for ${elapsedMs}ms, resetting and retrying`,
        );
        this.reconcileRunning = false;
        this.reconcileStartedAt = undefined;
      } else {
        this.logger.warn(
          `USDT reconcile skipped because a previous run is still active (${elapsedMs}ms)`,
        );
        return new StatusOKDto();
      }
    }
    this.reconcileRunning = true;
    this.reconcileStartedAt = Date.now();
    try {
      const ops = await this.prisma.paymentOperation.findMany({
        where: {
          operation_type: {
            in: [
              PaymentOperationType.DEPOSIT,
              PaymentOperationType.INTERNAL_TRANSFER,
              PaymentOperationType.WITHDRAW,
              PaymentOperationType.SWEEP,
              PaymentOperationType.COMPENSATION,
            ],
          },
          status: {
            in: [
              PaymentOperationStatus.NEW,
              PaymentOperationStatus.RESERVED,
              PaymentOperationStatus.DB_COMMITTED,
              PaymentOperationStatus.BROADCASTED,
              PaymentOperationStatus.FAILED,
            ],
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      this.logger.log(`USDT reconcile picked ${ops.length} operation(s)`);

      for (const op of ops) {
        try {
          await this.updateOperation(op.id, {
            last_reconciled_at: new Date(),
          });

          if (op.operation_type === PaymentOperationType.DEPOSIT) {
            const confirmed = op.tx_hash
              ? await this.isConfirmedTx(op.tx_hash)
              : false;
            this.logger.log(
              `USDT reconcile deposit op=${op.id} status=${op.status} tx=${op.tx_hash ?? 'null'} confirmed=${confirmed}`,
            );
            if (op.tx_hash && confirmed) {
              if (op.status !== PaymentOperationStatus.CONFIRMED) {
                const customer = await this.getCustomer(op.customer_id);
                if (!customer) continue;
                const transactionId = await this.finalizeDepositOperation({
                  customerId: op.customer_id,
                  fromAddress: op.from_address,
                  toAddress: op.to_address,
                  amount: Number(op.amount),
                  txHash: op.tx_hash,
                  operationId: op.id,
                  payload:
                    (op.payload as UsdtPaymentPayload | undefined) ?? undefined,
                });
                this.logger.log(
                  `USDT reconcile finalized deposit op=${op.id} transaction=${transactionId}`,
                );
                await this.maybeSweepCustomerWallet(op.customer_id, op.tx_hash);
              }
            }
            continue;
          }

          if (op.operation_type === PaymentOperationType.INTERNAL_TRANSFER) {
            if (
              op.status !== PaymentOperationStatus.CONFIRMED &&
              op.payload &&
              typeof op.payload === 'object' &&
              'transaction_id' in op.payload
            ) {
              await this.updateOperation(op.id, {
                status: PaymentOperationStatus.CONFIRMED,
              });
            }
            continue;
          }

          if (op.operation_type === PaymentOperationType.COMPENSATION) {
            if (op.status !== PaymentOperationStatus.CONFIRMED) {
              await this.updateOperation(op.id, {
                status: PaymentOperationStatus.CONFIRMED,
              });
            }
            continue;
          }

          if (
            op.status === PaymentOperationStatus.DB_COMMITTED ||
            op.status === PaymentOperationStatus.RESERVED ||
            op.status === PaymentOperationStatus.NEW
          ) {
            if (!op.tx_hash) {
              const customer = await this.getCustomer(op.customer_id);
              if (!customer) continue;
              const sourcePrivateKey =
                op.operation_type === PaymentOperationType.SWEEP
                  ? customer.private_key
                  : this.getRuntime().treasuryPrivateKey;
              const destinationAddress =
                op.operation_type === PaymentOperationType.WITHDRAW
                  ? op.to_address
                  : this.getRuntime().treasuryAddress;
              const { txHash } = await this.sendUsdt(
                sourcePrivateKey,
                destinationAddress,
                Number(op.amount),
              );
              await this.markBroadcasted(op, txHash);
              await this.upsertBlockchainTransaction(this.prisma, {
                paymentOperationId: op.id,
                direction: BlockchainTransactionDirection.OUTBOUND,
                asset: op.asset,
                txHash,
                fromAddress: op.from_address,
                toAddress: destinationAddress,
                amount: Number(op.amount),
                status: BlockchainTransactionStatus.BROADCASTED,
                gasPayerAddress:
                  op.operation_type === PaymentOperationType.SWEEP
                    ? op.from_address
                    : this.getRuntime().treasuryAddress,
              });
            }
          }

          if (op.tx_hash && op.status === PaymentOperationStatus.BROADCASTED) {
            if (await this.isConfirmedTx(op.tx_hash)) {
              if (op.operation_type === PaymentOperationType.WITHDRAW) {
                await this.finalizeWithdrawOperation(op);
              } else if (op.operation_type === PaymentOperationType.SWEEP) {
                await this.finalizeSweepOperation(op);
              } else {
                await this.markConfirmed(op);
              }
            }
          }
        } catch (error) {
          this.logger.error(
            `USDT reconcile failed for op=${op.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          await this.markFailed(op, error);
          if (op.operation_type === PaymentOperationType.WITHDRAW) {
            await this.compensateWithdraw(
              op,
              op.customer_id,
              Number(op.amount),
              (op.payload as UsdtPaymentPayload | undefined) ?? undefined,
            );
          }
        }
      }

      return new StatusOKDto();
    } finally {
      this.reconcileRunning = false;
      this.reconcileStartedAt = undefined;
    }
  }
}
