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
  PaymentOperation,
  PaymentOperationStatus,
  PaymentOperationType,
  PrismaClient,
  TransactionKind,
  TransactionStatus,
} from '@prisma/client';
import TronWeb from 'tronweb';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { CryptoService } from '../config/crypto/crypto.service';
import { BricsService } from 'src/config/brics/brics.service';
import { StatusOKDto } from 'src/common/dto/status.dto';

const USDT_DECIMALS = 6;
const SWEEP_THRESHOLD = 10;
const RECONCILE_INTERVAL_MS = 60_000;

type UsdtPaymentPayload = Record<string, unknown>;

interface UsdtRuntime {
  rpcUrl: string;
  tokenAddress: string;
  treasuryPrivateKey: string;
  treasuryAddress: string;
  tronWeb: any;
}

@Injectable()
export class UsdtTreasuryOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(UsdtTreasuryOrchestratorService.name);
  private runtime?: UsdtRuntime;
  private reconcileTimer?: NodeJS.Timeout;
  private reconcileRunning = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly configService: ConfigService,
    private readonly cryptoService: CryptoService,
    private readonly bricsService: BricsService,
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
      (this.configService.get<string>('USDT_RPC_URL') ||
        this.configService.get<string>('RPC_URL')) &&
        (this.configService.get<string>('USDT_TOKEN_ADDRESS') ||
          this.configService.get<string>('TOKEN_ADDRESS')) &&
        this.getTreasuryPrivateKey(),
    );
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

    const rpcUrl =
      this.configService.get<string>('USDT_RPC_URL') ||
      this.configService.get<string>('RPC_URL');
    const tokenAddress =
      this.configService.get<string>('USDT_TOKEN_ADDRESS') ||
      this.configService.get<string>('TOKEN_ADDRESS');
    const treasuryPrivateKey = this.getTreasuryPrivateKey();
    if (!rpcUrl || !tokenAddress || !treasuryPrivateKey) {
      throw new BadRequestException('USDT treasury runtime config is missing');
    }

    const treasuryAddress =
      this.cryptoService.trxAddressFromPrivateKey(treasuryPrivateKey);
    const TronWebCtor = TronWeb as unknown as new (options: {
      fullHost: string;
      privateKey: string;
    }) => any;
    const tronWeb = new TronWebCtor({
      fullHost: rpcUrl,
      privateKey: treasuryPrivateKey,
    });
    this.runtime = {
      rpcUrl,
      tokenAddress,
      treasuryPrivateKey,
      treasuryAddress,
      tronWeb,
    };
    return this.runtime;
  }

  private getTronWeb(): any {
    return this.getRuntime().tronWeb;
  }

  private normalizeKey(value?: string | null): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
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
    const balance = await contract.balanceOf(address).call();
    return Number(balance) / 10 ** USDT_DECIMALS;
  }

  private async sendUsdt(
    fromPrivateKey: string,
    toAddress: string,
    amount: number,
  ): Promise<{ txHash: string }> {
    const contract = this.getTronWeb().contract(
      [
        {
          constant: false,
          inputs: [
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          name: 'transfer',
          outputs: [],
          type: 'function',
          stateMutability: 'nonpayable',
          payable: false,
        },
      ],
      this.getRuntime().tokenAddress,
    );

    const amountSun = BigInt(Math.floor(amount * 10 ** USDT_DECIMALS));
    if (!(amountSun > 0n)) {
      throw new BadRequestException('USDT amount must be greater than 0');
    }

    const txHash = await contract
      .transfer(toAddress, amountSun.toString())
      .send(
        {
          feeLimit: 100_000_000,
          shouldPollResponse: false,
        },
        fromPrivateKey,
      );

    if (!txHash || typeof txHash !== 'string') {
      throw new BadRequestException('Failed to broadcast TRC20 transfer');
    }

    return { txHash };
  }

  private async isConfirmedTx(txHash: string): Promise<boolean> {
    try {
      const info = await this.getTronWeb().trx.getTransactionInfo(txHash);
      return info?.receipt?.result === 'SUCCESS' || !info?.result;
    } catch {
      return false;
    }
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
    data: Partial<
      Pick<
        PaymentOperation,
        | 'status'
        | 'tx_hash'
        | 'last_error'
        | 'payload'
        | 'attempt_count'
        | 'reversal_of_id'
      >
    >,
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
    reversal_of_id?: number | null;
  }): Promise<PaymentOperation> {
    return this.prisma.paymentOperation.create({
      data: {
        operation_type: input.operation_type,
        idempotency_key: input.idempotency_key,
        customer_id: input.customer_id,
        counterparty_customer_id: input.counterparty_customer_id ?? null,
        from_address: input.from_address,
        to_address: input.to_address,
        asset: input.asset,
        amount: input.amount.toString(),
        tx_hash: input.tx_hash ?? null,
        status: input.status ?? PaymentOperationStatus.NEW,
        payload: input.payload as any,
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
    const lastError = error instanceof Error ? error.message : String(error);
    return this.updateOperation(op.id, {
      status: PaymentOperationStatus.FAILED,
      last_error: lastError,
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
      payload: (payload ??
        (op.payload as UsdtPaymentPayload | undefined) ??
        undefined) as any,
      attempt_count: op.attempt_count + 1,
      last_error: null,
    });
  }

  private async markConfirmed(
    op: PaymentOperation,
    payload?: UsdtPaymentPayload,
  ): Promise<PaymentOperation> {
    return this.updateOperation(op.id, {
      status: PaymentOperationStatus.CONFIRMED,
      payload: (payload ??
        (op.payload as UsdtPaymentPayload | undefined) ??
        undefined) as any,
      last_error: null,
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
    txHash: string | null,
    comment: string,
    receiverWalletAddress?: string,
  ) {
    return client.transaction.create({
      data: {
        kind: TransactionKind.WALLET_TO_WALLET,
        status: TransactionStatus.SUCCESS,
        amount_in: amount.toString(),
        asset_in: 'USDT_TRC20',
        amount_out: amount.toString(),
        asset_out: 'USDT_TRC20',
        tx_hash: txHash,
        sender_customer_id: customerId,
        receiver_customer_id: counterpartyCustomerId,
        receiver_wallet_address: receiverWalletAddress,
        comment,
      },
    });
  }

  private async createWithdrawTransaction(
    customerId: number,
    amount: number,
    address: string,
    txHash: string,
  ) {
    return this.prisma.transaction.create({
      data: {
        kind: TransactionKind.WITHDRAW_CRYPTO,
        status: TransactionStatus.SUCCESS,
        amount_in: amount.toString(),
        asset_in: 'USDT_TRC20',
        amount_out: amount.toString(),
        asset_out: 'USDT_TRC20',
        tx_hash: txHash,
        external_address: address,
        sender_customer_id: customerId,
        comment: `USDT withdraw ${amount}`,
      },
    });
  }

  private async maybeSweepCustomerWallet(
    customerId: number,
    idempotencyHint: string,
  ): Promise<void> {
    const customer = await this.getCustomer(customerId);
    if (!customer?.address || !customer.private_key) return;

    let liveBalance: number;
    try {
      liveBalance = await this.getUsdtBalance(customer.address);
    } catch (error) {
      this.logger.warn(
        `USDT sweep skipped for customer=${customerId}: unable to read on-chain balance (${error instanceof Error ? error.message : String(error)})`,
      );
      return;
    }
    if (liveBalance <= SWEEP_THRESHOLD) {
      return;
    }

    const sweepKey = this.fallbackIdempotencyKey('usdt-sweep', [
      customerId,
      idempotencyHint,
      customer.address,
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
        from_address: customer.address,
        to_address: this.getRuntime().treasuryAddress,
        asset: 'USDT_TRC20',
        amount: liveBalance,
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
      await this.markBroadcasted(op, txHash, {
        ...((op.payload as UsdtPaymentPayload) ?? {}),
        sweep: true,
      });
      if (await this.waitForConfirmation(txHash)) {
        await this.markConfirmed(op);
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
    const idempotencyKey =
      this.normalizeKey(input.idempotencyKey) ??
      this.fallbackIdempotencyKey('usdt-internal', [
        input.senderCustomerId,
        input.receiverCustomerId,
        input.amount,
        input.senderAddress,
        input.receiverAddress,
      ]);

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
        from_address: input.senderAddress,
        to_address: input.receiverAddress,
        asset: 'USDT_TRC20',
        amount: input.amount,
        payload: input.payload ?? {},
        status: PaymentOperationStatus.NEW,
      }));

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const senderBalance = await tx.userAssetBalance.findUnique({
          where: {
            customer_id_asset: {
              customer_id: input.senderCustomerId,
              asset: 'USDT_TRC20',
            },
          },
        });
        const current = Number(senderBalance?.balance ?? 0);
        if (current + 1e-12 < input.amount) {
          throw new BadRequestException('Insufficient USDT balance');
        }

        await tx.userAssetBalance.upsert({
          where: {
            customer_id_asset: {
              customer_id: input.senderCustomerId,
              asset: 'USDT_TRC20',
            },
          },
          create: {
            customer_id: input.senderCustomerId,
            asset: 'USDT_TRC20',
            balance: (-input.amount).toString(),
          },
          update: { balance: { decrement: input.amount.toString() } },
        });
        await tx.userAssetBalance.upsert({
          where: {
            customer_id_asset: {
              customer_id: input.receiverCustomerId,
              asset: 'USDT_TRC20',
            },
          },
          create: {
            customer_id: input.receiverCustomerId,
            asset: 'USDT_TRC20',
            balance: input.amount.toString(),
          },
          update: { balance: { increment: input.amount.toString() } },
        });

        const transaction = await this.createTransactionForInternalTransfer(
          tx,
          input.senderCustomerId,
          input.receiverCustomerId,
          input.amount,
          null,
          'USDT internal transfer',
          input.receiverAddress,
        );

        await tx.paymentOperation.update({
          where: { id: op.id },
          data: {
            status: PaymentOperationStatus.CONFIRMED,
            payload: {
              ...(input.payload ?? {}),
              transaction_id: transaction.id,
              confirmed: true,
            },
            attempt_count: op.attempt_count + 1,
            last_error: null,
          },
        });

        return transaction.id;
      });

      return new StatusOKDto(result);
    } catch (error) {
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

    const idempotencyKey =
      this.normalizeKey(input.idempotencyKey) ??
      this.fallbackIdempotencyKey('usdt-withdraw', [
        input.customerId,
        input.amount,
        input.address,
      ]);

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
        from_address: customer.address,
        to_address: input.address,
        asset: 'USDT_TRC20',
        amount: input.amount,
        payload: input.payload ?? {},
        status: PaymentOperationStatus.NEW,
      }));

    try {
      await this.prisma.$transaction(async (tx) => {
        const balance = await tx.userAssetBalance.findUnique({
          where: {
            customer_id_asset: {
              customer_id: input.customerId,
              asset: 'USDT_TRC20',
            },
          },
        });
        const current = Number(balance?.balance ?? 0);
        if (current + 1e-12 < input.amount) {
          throw new BadRequestException('Insufficient USDT balance');
        }

        await tx.userAssetBalance.update({
          where: {
            customer_id_asset: {
              customer_id: input.customerId,
              asset: 'USDT_TRC20',
            },
          },
          data: { balance: { decrement: input.amount.toString() } },
        });

        await tx.paymentOperation.update({
          where: { id: op.id },
          data: {
            status: PaymentOperationStatus.DB_COMMITTED,
            payload: { ...(input.payload ?? {}), db_committed: true },
            last_error: null,
          },
        });
      });

      const { txHash } = await this.sendUsdt(
        this.getRuntime().treasuryPrivateKey,
        input.address,
        input.amount,
      );
      await this.markBroadcasted(op, txHash, {
        ...(input.payload ?? {}),
        tx_hash: txHash,
      });

      if (await this.waitForConfirmation(txHash)) {
        await this.markConfirmed(op, {
          ...(input.payload ?? {}),
          tx_hash: txHash,
          confirmed: true,
        });
        const transaction = await this.createWithdrawTransaction(
          input.customerId,
          input.amount,
          input.address,
          txHash,
        );
        await this.updateOperation(op.id, {
          payload: {
            ...(input.payload ?? {}),
            tx_hash: txHash,
            transaction_id: transaction.id,
          },
        });
        return new StatusOKDto(transaction.id);
      }

      return new StatusOKDto(op.id);
    } catch (error) {
      await this.markFailed(op, error);
      await this.compensateWithdraw(
        op,
        input.customerId,
        input.amount,
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
        from_address: op.to_address,
        to_address: op.from_address,
        asset: 'USDT_TRC20',
        amount,
        payload: { ...(payload ?? {}), original_operation_id: op.id },
        reversal_of_id: op.id,
        status: PaymentOperationStatus.NEW,
      }));

    await this.prisma.$transaction(async (tx) => {
      await tx.userAssetBalance.upsert({
        where: {
          customer_id_asset: { customer_id: customerId, asset: 'USDT_TRC20' },
        },
        create: {
          customer_id: customerId,
          asset: 'USDT_TRC20',
          balance: amount.toString(),
        },
        update: { balance: { increment: amount.toString() } },
      });
      await tx.paymentOperation.update({
        where: { id: op.id },
        data: {
          status: PaymentOperationStatus.COMPENSATED,
          payload: { ...(payload ?? {}), compensated_by: compensation.id },
        },
      });
      await tx.paymentOperation.update({
        where: { id: compensation.id },
        data: {
          status: PaymentOperationStatus.CONFIRMED,
          payload: { ...(payload ?? {}), compensation: true },
        },
      });
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

    const customer = await this.prisma.customer.findFirst({
      where: { address: dto.to_address },
      select: {
        customer_id: true,
        address: true,
        private_key: true,
        status: true,
      },
    });
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
      return new StatusOKDto(existing.id);
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
        from_address: dto.from_address,
        to_address: dto.to_address,
        asset: 'USDT_TRC20',
        amount: dto.amount,
        tx_hash: dto.tx_hash,
        payload: dto.payload ?? {},
        status: confirmed
          ? PaymentOperationStatus.BROADCASTED
          : PaymentOperationStatus.NEW,
      }));

    if (!confirmed) {
      await this.markBroadcasted(op, dto.tx_hash, dto.payload ?? {});
      return new StatusOKDto(op.id);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userAssetBalance.upsert({
        where: {
          customer_id_asset: {
            customer_id: customer.customer_id,
            asset: 'USDT_TRC20',
          },
        },
        create: {
          customer_id: customer.customer_id,
          asset: 'USDT_TRC20',
          balance: dto.amount.toString(),
        },
        update: { balance: { increment: dto.amount.toString() } },
      });

      const transaction = await tx.transaction.create({
        data: {
          kind: TransactionKind.WALLET_TO_WALLET,
          status: TransactionStatus.SUCCESS,
          amount_in: dto.amount.toString(),
          asset_in: 'USDT_TRC20',
          amount_out: dto.amount.toString(),
          asset_out: 'USDT_TRC20',
          tx_hash: dto.tx_hash,
          sender_wallet_address: dto.from_address,
          receiver_customer_id: customer.customer_id,
          receiver_wallet_address: dto.to_address,
          comment: 'USDT deposit',
        },
      });

      await tx.paymentOperation.update({
        where: { id: op.id },
        data: {
          status: PaymentOperationStatus.CONFIRMED,
          payload: {
            ...(dto.payload ?? {}),
            transaction_id: transaction.id,
            confirmed: true,
          },
          last_error: null,
        },
      });
    });

    try {
      await this.maybeSweepCustomerWallet(customer.customer_id, dto.tx_hash);
    } catch (error) {
      this.logger.warn(
        `USDT post-deposit sweep failed for customer=${customer.customer_id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return new StatusOKDto(op.id);
  }

  async reconcileUsdtOperations(): Promise<StatusOKDto> {
    if (this.reconcileRunning) {
      return new StatusOKDto();
    }
    this.reconcileRunning = true;
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

      for (const op of ops) {
        try {
          if (op.operation_type === PaymentOperationType.DEPOSIT) {
            if (op.tx_hash && (await this.isConfirmedTx(op.tx_hash))) {
              if (op.status !== PaymentOperationStatus.CONFIRMED) {
                const customer = await this.getCustomer(op.customer_id);
                if (!customer) continue;
                await this.prisma.$transaction(async (tx) => {
                  await tx.userAssetBalance.upsert({
                    where: {
                      customer_id_asset: {
                        customer_id: op.customer_id,
                        asset: 'USDT_TRC20',
                      },
                    },
                    create: {
                      customer_id: op.customer_id,
                      asset: 'USDT_TRC20',
                      balance: op.amount.toString(),
                    },
                    update: { balance: { increment: op.amount.toString() } },
                  });
                  await tx.paymentOperation.update({
                    where: { id: op.id },
                    data: { status: PaymentOperationStatus.CONFIRMED },
                  });
                });
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
            }
          }

          if (op.tx_hash && op.status === PaymentOperationStatus.BROADCASTED) {
            if (await this.isConfirmedTx(op.tx_hash)) {
              await this.markConfirmed(op);
            }
          }
        } catch (error) {
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
    }
  }
}
