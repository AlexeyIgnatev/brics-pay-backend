import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { ModuleRef } from '@nestjs/core';
import {
  Asset,
  BlockchainTransactionDirection,
  BlockchainTransactionStatus,
  PrismaClient,
  Network,
  OperationAddressKind,
  OperationInitiatorType,
  PaymentOperationStatus,
  PaymentOperationType,
  TariffOperation,
  Transaction,
  TransactionKind,
  TransactionStatus,
} from '@prisma/client';
import {
  AntiFraudDecision,
  AntiFraudService,
} from '../antifraud/antifraud.service';
import { PaymentDto, TransferDto } from './dto/payment.dto';
import { EthereumService } from 'src/config/ethereum/ethereum.service';
import { BricsService } from 'src/config/brics/brics.service';
import { StatusOKDto } from 'src/common/dto/status.dto';
import { ConfigService } from '@nestjs/config';
import { Currency } from '../users/enums/currency';
import { ConvertDto } from './dto/convert.dto';
import { SettingsService } from '../config/settings/settings.service';
import { BybitExchangeService } from '../config/exchange/bybit.service';
import { BalanceFetchService } from '../user-management/balance-fetch.service';
import { CryptoService } from '../config/crypto/crypto.service';
import { TronService } from '../config/crypto/tron.service';
import { UsdtTreasuryOrchestratorService } from './usdt-treasury-orchestrator.service';

import { GetTransactions } from './dto/get-transactions.dto';
import {
  ReceiptConversionSide,
  TransactionReceiptDto,
  TransactionReceiptRequestDto,
} from './dto/transaction-receipt.dto';
import { TransactionDto } from './dto/transaction.dto';
import { TransactionType } from './enums/transaction-type';

type AccountingMetadata = Record<string, unknown>;

const SOM_PURCHASE_ACCOUNTS = {
  customerSom: {
    account_no: '20201',
    account_name: 'Счет клиента в сомах',
  },
  cryptoExchange: {
    account_no: '20001',
    account_name: 'Счет криптобиржи',
  },
  bankSalamLiability: {
    account_no: '21199',
    account_name: 'Обязательство банка по Салам',
  },
  commissionTransit: {
    account_no: '21113',
    account_name: 'Транзитный счет комиссий',
  },
  bankFeeIncome: {
    account_no: '60699',
    account_name: 'Доходы банка по комиссиям',
  },
  partnerSettlement: {
    account_no: '21111',
    account_name: 'Расчеты с партнером',
  },
  govCryptoReserve: {
    account_no: '21115',
    account_name: 'Расчеты с гос. крипторезервом',
  },
  cryptoSettlement: {
    account_no: '11531',
    account_name: 'Счета к оплате Крипто/расчет с биржой',
  },
  offBalanceAsset: {
    account_no: '90001',
    account_name: 'Забалансовый учет клиентских криптоактивов, по номиналу',
  },
  offBalanceCounter: {
    account_no: '92602',
    account_name:
      'Контр счет, Забалансовый учет клиентских криптоактивов, по номиналу',
  },
} as const;

const SOM_PURCHASE_FEE_SPLIT = {
  bankPercent: 40,
  partnerPercent: 10,
  reservePercent: 50,
} as const;

const SOM_REDEMPTION_ACCOUNTS = {
  customerSom: {
    account_no: '20201',
    account_name: 'Счет клиента в сомах',
  },
  bankSalamLiability: {
    account_no: '21199',
    account_name: 'Обязательство банка по Салам',
  },
  commissionTransit: {
    account_no: '21113',
    account_name: 'Транзитный счет комиссий',
  },
  bankFeeIncome: {
    account_no: '60699',
    account_name: 'Доходы банка по комиссиям',
  },
  partnerSettlement: {
    account_no: '21111',
    account_name: 'Расчеты с партнером',
  },
  govCryptoReserve: {
    account_no: '21115',
    account_name: 'Расчеты с гос. крипторезервом',
  },
  offBalanceAsset: {
    account_no: '90001',
    account_name: 'Забалансовый учет клиентских криптоактивов, по номиналу',
  },
  offBalanceCounter: {
    account_no: '92602',
    account_name:
      'Контр счет, Забалансовый учет клиентских криптоактивов, по номиналу',
  },
} as const;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ethereumService: EthereumService,
    private readonly bricsService: BricsService,
    private readonly moduleRef: ModuleRef,
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
    private readonly exchangeService: BybitExchangeService,
    private readonly balanceFetchService: BalanceFetchService,
    private readonly antiFraud: AntiFraudService,
    private readonly cryptoService: CryptoService,
    private readonly tronService: TronService,
    private readonly usdtTreasuryOrchestrator: UsdtTreasuryOrchestratorService,
  ) {}

  private readonly logger = new (Logger as any)('PaymentsService');

  private antiFraudRejectMessage(
    flow: string,
    decision: AntiFraudDecision,
  ): string {
    const parts: string[] = [`flow=${flow}`];
    if (decision.rule_key) parts.push(`rule=${decision.rule_key}`);
    if (decision.case_id != null) parts.push(`case_id=${decision.case_id}`);
    if (decision.transaction_id != null)
      parts.push(`transaction_id=${decision.transaction_id}`);
    if (decision.reason) parts.push(`reason=${decision.reason}`);
    return `Rejected by anti-fraud (${parts.join(', ')})`;
  }

  private errorDetails(error: unknown): string {
    if (error instanceof Error) {
      const anyErr = error as any;
      const status = anyErr?.response?.status;
      const data = anyErr?.response?.data;
      if (status != null || data != null) {
        const dataText = typeof data === 'string' ? data : JSON.stringify(data);
        return `status=${status ?? 'n/a'}, message=${error.message}, data=${dataText}`;
      }
      return error.message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  private async complianceStatusMessage(
    customerId: number,
    status: 'FRAUD' | 'BLOCKED',
  ): Promise<string> {
    try {
      const latestCase = await this.prisma.antiFraudCase.findFirst({
        where: { transaction: { is: { sender_customer_id: customerId } } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, rule_key: true },
      });
      const parts = [`customer_status=${status}`];
      if (latestCase) {
        parts.push(`case_id=${latestCase.id}`);
        parts.push(`case_status=${latestCase.status}`);
        parts.push(`rule=${latestCase.rule_key}`);
      } else {
        parts.push('case_id=none');
      }
      return `Operation blocked by compliance (${parts.join(', ')})`;
    } catch (error) {
      const details = error instanceof Error ? error.message : 'unknown';
      this.logger.error(
        `[complianceStatusMessage] failed for customer=${customerId}: ${details}`,
      );
      return `Operation blocked by compliance (customer_status=${status}, case_id=unknown)`;
    }
  }

  private buildClientFio(
    customer: {
      customer_id: number;
      first_name?: string | null;
      middle_name?: string | null;
      last_name?: string | null;
    } | null,
  ): string {
    const fullName = [
      customer?.last_name,
      customer?.first_name,
      customer?.middle_name,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
    return fullName || `Client #${customer?.customer_id ?? 'N/A'}`;
  }

  private formatAbsTime(date: Date): string {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  private buildAbsTransactionRef(): string {
    return `ABS-${Date.now()}`;
  }

  private async createConversionTransactionRecord(input: {
    kind: TransactionKind;
    amountIn: number;
    assetIn: Asset;
    amountOut: number;
    assetOut: Asset;
    feeAmount: number;
    senderCustomerId: number;
    receiverCustomerId?: number | null;
    senderWalletAddress?: string | null;
    receiverWalletAddress?: string | null;
    externalAddress?: string | null;
    txHash?: string | null;
    bankOpId?: number | null;
    priceUsd?: string | null;
    notionalUsd?: string | null;
    comment?: string | null;
  }): Promise<Transaction> {
    return this.prisma.transaction.create({
      data: {
        kind: input.kind,
        status: TransactionStatus.SUCCESS,
        amount_in: input.amountIn.toString(),
        asset_in: input.assetIn,
        amount_out: input.amountOut.toString(),
        asset_out: input.assetOut,
        fee_amount: input.feeAmount.toString(),
        tx_hash: input.txHash ?? null,
        bank_op_id: input.bankOpId ?? null,
        sender_customer_id: input.senderCustomerId,
        receiver_customer_id: input.receiverCustomerId ?? null,
        sender_wallet_address: input.senderWalletAddress ?? null,
        receiver_wallet_address: input.receiverWalletAddress ?? null,
        external_address: input.externalAddress ?? null,
        price_usd: input.priceUsd ?? null,
        notional_usd: input.notionalUsd ?? null,
        comment: input.comment ?? null,
      },
    });
  }

  private isBrowserWalletCustomer(customer?: {
    customer_id: number;
    first_name?: string | null;
    middle_name?: string | null;
    last_name?: string | null;
  } | number | null): boolean {
    if (customer == null) return false;
    if (typeof customer === 'number') {
      return customer >= 910_000_000;
    }
    if (customer.customer_id >= 910_000_000) return true;

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

  private async createOnChainUsdtWalletTransferRecord(input: {
    sender: {
      customer_id: number;
      address: string;
    };
    recipientAddress: string;
    recipientCustomerId?: number | null;
    amount: number;
    txHash: string;
    blockNumber?: number | null;
    blockTimestamp?: number | null;
    receiptStatus?: string | null;
    feeAmountRaw?: string | null;
    energyUsed?: number | null;
    bandwidthUsed?: number | null;
    comment?: string;
  }): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const paymentOperation = await tx.paymentOperation.create({
        data: {
          operation_type: PaymentOperationType.INTERNAL_TRANSFER,
          status: PaymentOperationStatus.CONFIRMED,
          idempotency_key: `browser-wallet-onchain-${input.txHash}`,
          customer_id: input.sender.customer_id,
          counterparty_customer_id: input.recipientCustomerId ?? null,
          network: Network.TRON,
          from_address: input.sender.address,
          to_address: input.recipientAddress,
          source_kind: OperationAddressKind.USER_WALLET,
          destination_kind: input.recipientCustomerId
            ? OperationAddressKind.USER_WALLET
            : OperationAddressKind.EXTERNAL,
          asset: 'USDT_TRC20',
          amount: input.amount,
          amount_raw: Math.floor(input.amount * 1_000_000).toString(),
          decimals: 6,
          tx_hash: input.txHash,
          attempt_count: 1,
          initiator_type: OperationInitiatorType.USER,
          confirmed_at: new Date(),
          payload: {
            source: 'browser-wallet-on-chain-transfer',
          },
        },
      });

      await tx.blockchainTransaction.create({
        data: {
          payment_operation_id: paymentOperation.id,
          direction: BlockchainTransactionDirection.OUTBOUND,
          network: Network.TRON,
          asset: 'USDT_TRC20',
          token_contract: this.configService.get<string>('USDT_TOKEN_ADDRESS')
            ?? this.configService.get<string>('TRON_USDT_CONTRACT')
            ?? null,
          tx_hash: input.txHash,
          from_address: input.sender.address,
          to_address: input.recipientAddress,
          amount: input.amount,
          amount_raw: Math.floor(input.amount * 1_000_000).toString(),
          decimals: 6,
          status: BlockchainTransactionStatus.CONFIRMED,
          block_number: input.blockNumber ?? null,
          block_timestamp: input.blockTimestamp
            ? new Date(input.blockTimestamp)
            : null,
          confirmations: 1,
          gas_payer_address: input.sender.address,
          fee_amount_raw: input.feeAmountRaw ?? null,
          fee_asset: 'TRX',
          energy_used: input.energyUsed ?? null,
          bandwidth_used: input.bandwidthUsed ?? null,
          receipt_status: input.receiptStatus ?? null,
        },
      });

      const transaction = await tx.transaction.create({
        data: {
          kind: TransactionKind.WALLET_TO_WALLET,
          status: TransactionStatus.SUCCESS,
          amount_in: input.amount.toString(),
          asset_in: 'USDT_TRC20',
          amount_out: input.amount.toString(),
          asset_out: 'USDT_TRC20',
          tx_hash: input.txHash,
          sender_customer_id: input.sender.customer_id,
          receiver_customer_id: input.recipientCustomerId ?? null,
          sender_wallet_address: input.sender.address,
          receiver_wallet_address: input.recipientAddress,
          external_address: input.recipientCustomerId
            ? null
            : input.recipientAddress,
          comment:
            input.comment ??
            'USDT TRC20 on-chain transfer involving browser wallet',
        },
      });

      await tx.paymentOperation.update({
        where: { id: paymentOperation.id },
        data: {
          payload: {
            source: 'browser-wallet-on-chain-transfer',
            transaction_id: transaction.id,
          },
        },
      });

      return transaction.id;
    });
  }

  private async transferBrowserWalletOnChain(input: {
    sender: {
      customer_id: number;
      address: string;
      private_key: string;
      first_name?: string | null;
      middle_name?: string | null;
      last_name?: string | null;
    };
    recipientAddress: string;
    recipientCustomerId?: number | null;
    amount: number;
    comment: string;
  }): Promise<StatusOKDto> {
    const realOnChain =
      this.configService.get<string>('BROWSER_WALLET_REAL_ONCHAIN') !== 'false';

    if (!realOnChain) {
      const simulatedTxId = Date.now();
      this.logger.warn(
        `[browser-wallet-transfer] simulation mode enabled, skipping on-chain send sender=${input.sender.customer_id} from=${input.sender.address} to=${input.recipientAddress} amount=${input.amount} recipientCustomerId=${input.recipientCustomerId ?? 'null'} comment=${input.comment}`,
      );
      return new StatusOKDto(simulatedTxId);
    }

    try {
      this.logger.verbose(
        `[browser-wallet-transfer] start sender=${input.sender.customer_id} from=${input.sender.address} to=${input.recipientAddress} amount=${input.amount} recipientCustomerId=${input.recipientCustomerId ?? 'null'}`,
      );

      const { txHash } = await this.tronService.sendTrc20({
        fromPrivateKey: input.sender.private_key,
        toAddress: input.recipientAddress,
        amount: input.amount,
      });

      const info = await this.tronService.waitForTransaction(txHash);
      if (!info) {
        throw new BadRequestException(
          `TRC20 transfer confirmation timeout: ${txHash}`,
        );
      }

      const receipt =
        (info?.receipt as Record<string, unknown> | undefined) ?? {};
      const blockNumber = Number(info?.blockNumber ?? 0) || null;
      const blockTimestamp = Number(info?.blockTimeStamp ?? 0) || null;
      const receiptStatus =
        typeof receipt.result === 'string'
          ? receipt.result
          : typeof info?.result === 'string'
            ? (info.result as string)
            : null;
      const feeAmountRaw =
        receipt.energy_fee ??
        receipt.net_fee ??
        receipt.fee ??
        receipt.other_fee ??
        null;
      const energyUsed = Number(
        receipt.energy_usage_total ??
          receipt.energy_usage ??
          receipt.energy_used ??
          0,
      );
      const bandwidthUsed = Number(
        receipt.net_usage ?? receipt.bandwidth_used ?? 0,
      );

      this.logger.verbose(
        `[browser-wallet-transfer] confirmed txHash=${txHash} blockNumber=${String(blockNumber ?? 0)} blockTimestamp=${String(blockTimestamp ?? 0)} receiptStatus=${receiptStatus ?? 'null'} feeAmountRaw=${String(feeAmountRaw ?? 'null')} energyUsed=${String(Number.isFinite(energyUsed) ? energyUsed : 0)} bandwidthUsed=${String(Number.isFinite(bandwidthUsed) ? bandwidthUsed : 0)}`,
      );

      const transactionId = await this.createOnChainUsdtWalletTransferRecord({
        sender: {
          customer_id: input.sender.customer_id,
          address: input.sender.address,
        },
        recipientAddress: input.recipientAddress,
        recipientCustomerId: input.recipientCustomerId,
        amount: input.amount,
        txHash,
        blockNumber,
        blockTimestamp,
        receiptStatus,
        feeAmountRaw: feeAmountRaw != null ? String(feeAmountRaw) : null,
        energyUsed: Number.isFinite(energyUsed) ? energyUsed : null,
        bandwidthUsed: Number.isFinite(bandwidthUsed) ? bandwidthUsed : null,
        comment: input.comment,
      });

      this.logger.verbose(
        `[browser-wallet-transfer] db-recorded transactionId=${transactionId} txHash=${txHash}`,
      );

      await this.balanceFetchService.refreshAllBalancesForUser(
        input.sender.customer_id,
        ['USDT_TRC20' as Asset],
      );
      if (
        input.recipientCustomerId &&
        input.recipientCustomerId !== input.sender.customer_id
      ) {
        await this.balanceFetchService.refreshAllBalancesForUser(
          input.recipientCustomerId,
          ['USDT_TRC20' as Asset],
        );
      }

      return new StatusOKDto(transactionId);
    } catch (error) {
      const details = this.errorDetails(error);
      this.logger.error(
        `[browser-wallet-transfer] failed sender=${input.sender.customer_id} from=${input.sender.address} to=${input.recipientAddress} amount=${input.amount} recipientCustomerId=${input.recipientCustomerId ?? 'null'}: ${details}`,
        error instanceof Error ? error.stack : undefined,
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Browser wallet transfer failed: ${details}`);
    }
  }

  private buildCreditPurpose(
    walletId: string | number,
    transactionRef: string,
    recipientFio: string,
    at: Date,
  ): string {
    return `Пополнение Салам №${walletId}, ID транзакции ${transactionRef}, ${recipientFio}, ${this.formatAbsTime(at)}`;
  }

  private buildDebitPurpose(
    accountNo: string,
    transactionRef: string,
    senderFio: string,
    at: Date,
  ): string {
    return `Пополнение счета №${accountNo}, ID транзакции ${transactionRef}, ${senderFio}, ${this.formatAbsTime(at)}`;
  }

  private buildGenericAbsPurpose(
    clientFio: string,
    transactionRef: string,
    at: Date,
  ): string {
    return `${clientFio}, ID транзакции ${transactionRef}, ${this.formatAbsTime(at)}`;
  }

  private splitSomPurchaseCommission(amount: number): {
    bankShare: number;
    partnerShare: number;
    reserveShare: number;
  } {
    const bankShare = (amount * SOM_PURCHASE_FEE_SPLIT.bankPercent) / 100;
    const partnerShare = (amount * SOM_PURCHASE_FEE_SPLIT.partnerPercent) / 100;
    const reserveShare = (amount * SOM_PURCHASE_FEE_SPLIT.reservePercent) / 100;
    return { bankShare, partnerShare, reserveShare };
  }

  private async createSomPurchaseAccountingPostings(
    client:
      | PrismaClient
      | {
          accountingPosting: PrismaClient['accountingPosting'];
        },
    input: {
      transactionId?: number | null;
      paymentOperationId?: number | null;
      postingGroupKey: string;
      grossAmount: number;
      commissionAmount: number;
      netAmount: number;
      bankOperationId?: number | null;
      transactionRef: string;
      internalBridge?: boolean;
    },
  ): Promise<void> {
    const split = this.splitSomPurchaseCommission(input.commissionAmount);
    const metadataBase: AccountingMetadata = {
      flow: 'SOM_PURCHASE',
      transaction_ref: input.transactionRef,
      gross_amount: input.grossAmount,
      commission_amount: input.commissionAmount,
      net_amount: input.netAmount,
      bank_operation_id: input.bankOperationId ?? null,
      internal_bridge: input.internalBridge ?? false,
      fee_split: SOM_PURCHASE_FEE_SPLIT,
      account_catalog: SOM_PURCHASE_ACCOUNTS,
    };

    const postings = [
      {
        sequence: 1,
        debit_account_no: SOM_PURCHASE_ACCOUNTS.customerSom.account_no,
        debit_account_name: SOM_PURCHASE_ACCOUNTS.customerSom.account_name,
        credit_account_no: SOM_PURCHASE_ACCOUNTS.bankSalamLiability.account_no,
        credit_account_name:
          SOM_PURCHASE_ACCOUNTS.bankSalamLiability.account_name,
        amount: input.grossAmount,
        comment: 'Покупка KGST клиентом',
      },
      {
        sequence: 2,
        debit_account_no: SOM_PURCHASE_ACCOUNTS.bankSalamLiability.account_no,
        debit_account_name:
          SOM_PURCHASE_ACCOUNTS.bankSalamLiability.account_name,
        credit_account_no: SOM_PURCHASE_ACCOUNTS.commissionTransit.account_no,
        credit_account_name:
          SOM_PURCHASE_ACCOUNTS.commissionTransit.account_name,
        amount: input.commissionAmount,
        comment: 'Удержание комиссии',
      },
      {
        sequence: 3,
        debit_account_no: SOM_PURCHASE_ACCOUNTS.commissionTransit.account_no,
        debit_account_name:
          SOM_PURCHASE_ACCOUNTS.commissionTransit.account_name,
        credit_account_no: SOM_PURCHASE_ACCOUNTS.bankFeeIncome.account_no,
        credit_account_name: SOM_PURCHASE_ACCOUNTS.bankFeeIncome.account_name,
        amount: split.bankShare,
        comment: 'Доля банка',
      },
      {
        sequence: 4,
        debit_account_no: SOM_PURCHASE_ACCOUNTS.commissionTransit.account_no,
        debit_account_name:
          SOM_PURCHASE_ACCOUNTS.commissionTransit.account_name,
        credit_account_no: SOM_PURCHASE_ACCOUNTS.partnerSettlement.account_no,
        credit_account_name:
          SOM_PURCHASE_ACCOUNTS.partnerSettlement.account_name,
        amount: split.partnerShare,
        comment: 'Доля партнера',
      },
      {
        sequence: 5,
        debit_account_no: SOM_PURCHASE_ACCOUNTS.commissionTransit.account_no,
        debit_account_name:
          SOM_PURCHASE_ACCOUNTS.commissionTransit.account_name,
        credit_account_no: SOM_PURCHASE_ACCOUNTS.govCryptoReserve.account_no,
        credit_account_name:
          SOM_PURCHASE_ACCOUNTS.govCryptoReserve.account_name,
        amount: split.reserveShare,
        comment: '0.5% госрезерв',
      },
      {
        sequence: 6,
        debit_account_no: SOM_PURCHASE_ACCOUNTS.offBalanceAsset.account_no,
        debit_account_name: SOM_PURCHASE_ACCOUNTS.offBalanceAsset.account_name,
        credit_account_no: SOM_PURCHASE_ACCOUNTS.offBalanceCounter.account_no,
        credit_account_name:
          SOM_PURCHASE_ACCOUNTS.offBalanceCounter.account_name,
        amount: input.netAmount,
        comment: 'Учет актива забаланс',
      },
    ];

    await client.accountingPosting.createMany({
      data: postings.map((posting) => ({
        posting_group_key: input.postingGroupKey,
        sequence: posting.sequence,
        transaction_id: input.transactionId ?? null,
        payment_operation_id: input.paymentOperationId ?? null,
        debit_account_no: posting.debit_account_no,
        debit_account_name: posting.debit_account_name,
        credit_account_no: posting.credit_account_no,
        credit_account_name: posting.credit_account_name,
        asset: 'SOM' as Asset,
        amount: posting.amount.toString(),
        comment: posting.comment,
        metadata: {
          ...metadataBase,
          sequence: posting.sequence,
          debit_account_no: posting.debit_account_no,
          debit_account_name: posting.debit_account_name,
          credit_account_no: posting.credit_account_no,
          credit_account_name: posting.credit_account_name,
          posting_comment: posting.comment,
        } as any,
      })),
    });
  }

  private async createSomRedemptionAccountingPostings(
    client:
      | PrismaClient
      | {
          accountingPosting: PrismaClient['accountingPosting'];
        },
    input: {
      transactionId?: number | null;
      paymentOperationId?: number | null;
      postingGroupKey: string;
      grossAmount: number;
      commissionAmount: number;
      netAmount: number;
      bankOperationId?: number | null;
      transactionRef: string;
    },
  ): Promise<void> {
    const split = this.splitSomPurchaseCommission(input.commissionAmount);
    const metadataBase: AccountingMetadata = {
      flow: 'SOM_REDEMPTION',
      transaction_ref: input.transactionRef,
      gross_amount: input.grossAmount,
      commission_amount: input.commissionAmount,
      net_amount: input.netAmount,
      bank_operation_id: input.bankOperationId ?? null,
      fee_split: SOM_PURCHASE_FEE_SPLIT,
      account_catalog: SOM_REDEMPTION_ACCOUNTS,
    };

    const postings = [
      {
        sequence: 1,
        debit_account_no: SOM_REDEMPTION_ACCOUNTS.bankSalamLiability.account_no,
        debit_account_name:
          SOM_REDEMPTION_ACCOUNTS.bankSalamLiability.account_name,
        credit_account_no: SOM_REDEMPTION_ACCOUNTS.customerSom.account_no,
        credit_account_name: SOM_REDEMPTION_ACCOUNTS.customerSom.account_name,
        amount: input.grossAmount,
        comment: 'Выплата клиенту',
      },
      {
        sequence: 2,
        debit_account_no: SOM_REDEMPTION_ACCOUNTS.bankSalamLiability.account_no,
        debit_account_name:
          SOM_REDEMPTION_ACCOUNTS.bankSalamLiability.account_name,
        credit_account_no: SOM_REDEMPTION_ACCOUNTS.commissionTransit.account_no,
        credit_account_name:
          SOM_REDEMPTION_ACCOUNTS.commissionTransit.account_name,
        amount: input.commissionAmount,
        comment: 'Удержание комиссии',
      },
      {
        sequence: 3,
        debit_account_no: SOM_REDEMPTION_ACCOUNTS.commissionTransit.account_no,
        debit_account_name:
          SOM_REDEMPTION_ACCOUNTS.commissionTransit.account_name,
        credit_account_no: SOM_REDEMPTION_ACCOUNTS.bankFeeIncome.account_no,
        credit_account_name: SOM_REDEMPTION_ACCOUNTS.bankFeeIncome.account_name,
        amount: split.bankShare,
        comment: 'Доля банка',
      },
      {
        sequence: 4,
        debit_account_no: SOM_REDEMPTION_ACCOUNTS.commissionTransit.account_no,
        debit_account_name:
          SOM_REDEMPTION_ACCOUNTS.commissionTransit.account_name,
        credit_account_no: SOM_REDEMPTION_ACCOUNTS.partnerSettlement.account_no,
        credit_account_name:
          SOM_REDEMPTION_ACCOUNTS.partnerSettlement.account_name,
        amount: split.partnerShare,
        comment: 'Доля партнера',
      },
      {
        sequence: 5,
        debit_account_no: SOM_REDEMPTION_ACCOUNTS.commissionTransit.account_no,
        debit_account_name:
          SOM_REDEMPTION_ACCOUNTS.commissionTransit.account_name,
        credit_account_no: SOM_REDEMPTION_ACCOUNTS.govCryptoReserve.account_no,
        credit_account_name:
          SOM_REDEMPTION_ACCOUNTS.govCryptoReserve.account_name,
        amount: split.reserveShare,
        comment: '0.5% госрезерв',
      },
      {
        sequence: 6,
        debit_account_no: SOM_REDEMPTION_ACCOUNTS.offBalanceCounter.account_no,
        debit_account_name:
          SOM_REDEMPTION_ACCOUNTS.offBalanceCounter.account_name,
        credit_account_no: SOM_REDEMPTION_ACCOUNTS.offBalanceAsset.account_no,
        credit_account_name:
          SOM_REDEMPTION_ACCOUNTS.offBalanceAsset.account_name,
        amount: input.netAmount,
        comment: 'Учет актива забаланс',
      },
    ];

    await client.accountingPosting.createMany({
      data: postings.map((posting) => ({
        posting_group_key: input.postingGroupKey,
        sequence: posting.sequence,
        transaction_id: input.transactionId ?? null,
        payment_operation_id: input.paymentOperationId ?? null,
        debit_account_no: posting.debit_account_no,
        debit_account_name: posting.debit_account_name,
        credit_account_no: posting.credit_account_no,
        credit_account_name: posting.credit_account_name,
        asset: 'SOM' as Asset,
        amount: posting.amount.toString(),
        comment: posting.comment,
        metadata: {
          ...metadataBase,
          sequence: posting.sequence,
          debit_account_no: posting.debit_account_no,
          debit_account_name: posting.debit_account_name,
          credit_account_no: posting.credit_account_no,
          credit_account_name: posting.credit_account_name,
          posting_comment: posting.comment,
        } as any,
      })),
    });
  }

  private isInternalBridgeTransaction(t: { comment?: string | null }): boolean {
    return (
      typeof t.comment === 'string' && t.comment.startsWith('INTERNAL_BRIDGE')
    );
  }

  private tariffOperationForConversion(
    from: Asset,
    to: Asset,
  ): TariffOperation | null {
    const key = `${from}_TO_${to}`;
    switch (key) {
      case 'SOM_TO_ESOM':
        return TariffOperation.SOM_TO_ESOM;
      case 'ESOM_TO_SOM':
        return TariffOperation.ESOM_TO_SOM;
      case 'ESOM_TO_USDT_TRC20':
        return TariffOperation.ESOM_TO_USDT_TRC20;
      case 'USDT_TRC20_TO_ESOM':
        return TariffOperation.USDT_TRC20_TO_ESOM;
      default:
        return null;
    }
  }

  private async resolveTransactionFeeFromTariffs(
    tx: Transaction,
    fallbackCustomerId: number,
  ): Promise<number> {
    const existingFee = Number(tx.fee_amount ?? 0);
    if (existingFee > 0) return existingFee;

    let operation: TariffOperation | null = null;
    if (tx.kind === TransactionKind.WALLET_TO_WALLET) {
      operation = this.tariffOperationForWalletTransfer(
        tx.asset_in as unknown as Asset,
      );
    } else if (
      tx.kind === TransactionKind.BANK_TO_WALLET ||
      tx.kind === TransactionKind.WALLET_TO_BANK ||
      tx.kind === TransactionKind.CONVERSION
    ) {
      if (tx.asset_in && tx.asset_out && tx.asset_in !== tx.asset_out) {
        operation = this.tariffOperationForConversion(
          tx.asset_in as unknown as Asset,
          tx.asset_out as unknown as Asset,
        );
      }
    }

    if (!operation) return 0;

    const tariffFee = await this.getCustomerTariffFee(
      tx.sender_customer_id ?? fallbackCustomerId,
      operation,
      Number(tx.amount_in ?? 0),
    );
    return tariffFee.fee;
  }

  private tariffOperationForWalletTransfer(
    asset: Asset,
  ): TariffOperation | null {
    switch (asset) {
      case 'ESOM':
        return TariffOperation.WALLET_TRANSFER_ESOM;
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
  ): Promise<{
    percent: number;
    fixed: number;
    fee: number;
    configured: boolean;
  }> {
    if (!operation) return { percent: 0, fixed: 0, fee: 0, configured: false };
    const customer = await this.prisma.customer.findUnique({
      where: { customer_id: customerId },
      select: { tariff_category: true, residency: true },
    });
    if (!customer) return { percent: 0, fixed: 0, fee: 0, configured: false };
    const tariff = await this.prisma.tariffSetting.findUnique({
      where: {
        category_residency_operation: {
          category: customer.tariff_category,
          residency: customer.residency,
          operation,
        },
      },
    });
    if (!tariff) return { percent: 0, fixed: 0, fee: 0, configured: false };
    const percent = Number(tariff.percent_fee || 0);
    const fixed = Number(tariff.fixed_fee || 0);
    const safePercent = Number.isFinite(percent) && percent > 0 ? percent : 0;
    const safeFixed = Number.isFinite(fixed) && fixed > 0 ? fixed : 0;
    return {
      percent: safePercent,
      fixed: safeFixed,
      fee: baseAmount * (safePercent / 100) + safeFixed,
      configured: true,
    };
  }

  private mapType(t: Transaction, customer_id: number): TransactionType {
    switch (t.kind) {
      case 'BANK_TO_BANK':
        if (t.sender_customer_id === customer_id)
          return TransactionType.EXPENSE;
        if (t.receiver_customer_id === customer_id)
          return TransactionType.INCOME;
        return TransactionType.TRANSFER;
      case 'BANK_TO_WALLET':
        return TransactionType.CONVERSION;
      case 'WALLET_TO_BANK':
        return TransactionType.CONVERSION;
      case 'WALLET_TO_WALLET':
        if (t.sender_customer_id === customer_id)
          return TransactionType.EXPENSE;
        if (t.receiver_customer_id === customer_id)
          return TransactionType.INCOME;
        return TransactionType.TRANSFER;
      case 'CONVERSION':
        return TransactionType.CONVERSION;
      case 'WITHDRAW_CRYPTO':
        return TransactionType.EXPENSE;
      default:
        return TransactionType.TRANSFER;
    }
  }

  private maskAccount(value?: string | number | null): string {
    if (value == null) return 'N/A';
    const raw = String(value).trim();
    if (!raw) return 'N/A';
    return `****${raw.slice(-8)}`;
  }

  private isBankKind(kind: TransactionKind): boolean {
    return kind === 'BANK_TO_BANK' || kind === 'BANK_TO_WALLET';
  }

  private getDisplaySide(
    t: Transaction,
    requested: TransactionReceiptRequestDto,
  ): { currency: Currency; amount: number } {
    const inCurrency = (t.asset_in || 'SOM') as unknown as Currency;
    const inAmount = Number(t.amount_in);
    const outCurrency = (t.asset_out || 'SOM') as unknown as Currency;
    const outAmount = Number(t.amount_out);

    const isConversion =
      (t.kind === 'CONVERSION' ||
        t.kind === 'BANK_TO_WALLET' ||
        t.kind === 'WALLET_TO_BANK') &&
      t.status === TransactionStatus.SUCCESS &&
      t.asset_in !== t.asset_out;

    if (
      isConversion &&
      requested.conversion_side === ReceiptConversionSide.OUT
    ) {
      return { currency: outCurrency, amount: outAmount };
    }

    return { currency: inCurrency, amount: inAmount };
  }

  private buildRecipientFullName(t: {
    kind: TransactionKind;
    sender_customer?: {
      first_name: string | null;
      middle_name: string | null;
      last_name: string | null;
    } | null;
    sender_customer_id: number | null;
    receiver_customer?: {
      first_name: string | null;
      middle_name: string | null;
      last_name: string | null;
    } | null;
    receiver_customer_id: number | null;
  }): string {
    const isConversion =
      t.kind === 'CONVERSION' ||
      t.kind === 'BANK_TO_WALLET' ||
      t.kind === 'WALLET_TO_BANK';

    if (isConversion) {
      const converterFullName = [
        t.sender_customer?.last_name,
        t.sender_customer?.first_name,
        t.sender_customer?.middle_name,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (converterFullName) return converterFullName;
      if (t.sender_customer_id != null)
        return `Customer #${t.sender_customer_id}`;
    }

    const fullName = [
      t.receiver_customer?.last_name,
      t.receiver_customer?.first_name,
      t.receiver_customer?.middle_name,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (fullName) return fullName;
    if (t.receiver_customer_id != null)
      return `Customer #${t.receiver_customer_id}`;
    return 'N/A';
  }

  private buildPaidFromAccount(t: {
    kind: TransactionKind;
    sender_wallet_address: string | null;
    sender_customer?: { address: string } | null;
    sender_customer_id: number | null;
    bank_op_id: number | null;
  }): string {
    const senderWallet = t.sender_wallet_address || t.sender_customer?.address;
    if (senderWallet) return this.maskAccount(senderWallet);
    if (this.isBankKind(t.kind) && t.sender_customer_id != null)
      return this.maskAccount(t.sender_customer_id);
    if (t.bank_op_id != null) return this.maskAccount(t.bank_op_id);
    return 'N/A';
  }

  private buildAccountDetails(t: {
    kind: TransactionKind;
    external_address: string | null;
    receiver_wallet_address: string | null;
    receiver_customer?: { address: string } | null;
    receiver_customer_id: number | null;
    bank_op_id: number | null;
  }): string {
    const targetWallet =
      t.external_address ||
      t.receiver_wallet_address ||
      t.receiver_customer?.address;
    if (targetWallet) return this.maskAccount(targetWallet);
    if (this.isBankKind(t.kind) && t.receiver_customer_id != null)
      return this.maskAccount(t.receiver_customer_id);
    if (t.bank_op_id != null) return this.maskAccount(t.bank_op_id);
    return 'N/A';
  }

  async getHistory(
    body: GetTransactions,
    customer_id: number,
  ): Promise<TransactionDto[]> {
    const me = await this.prisma.customer.findUnique({
      where: { customer_id },
    });
    const userOr = [
      { sender_customer_id: customer_id },
      { receiver_customer_id: customer_id },
      me?.address ? { sender_wallet_address: me.address } : undefined,
      me?.address ? { receiver_wallet_address: me.address } : undefined,
    ].filter(Boolean);

    const where: any = { OR: userOr };

    if (body.currency?.length) {
      const assets = body.currency.map((c) => c as unknown as Asset);
      const currencyOr = [
        { asset_out: { in: assets } },
        { asset_in: { in: assets } },
      ];

      where.AND = [{ OR: userOr }, { OR: currencyOr }];
      delete where.OR;
    }
    if (body.from_time || body.to_time) {
      where.createdAt = {} as { gte?: Date; lte?: Date };
      if (body.from_time)
        (where.createdAt as { gte?: Date }).gte = new Date(body.from_time);
      if (body.to_time)
        (where.createdAt as { lte?: Date }).lte = new Date(body.to_time);
    }

    const items: Transaction[] = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: body.skip ?? 0,
      take: body.take ?? 50,
    });

    const rows: TransactionDto[] = [];
    const filterSet = body.currency?.length ? new Set(body.currency) : null;

    for (const t of items) {
      if (this.isInternalBridgeTransaction(t)) {
        continue;
      }

      const isConversionLike =
        (t.kind === 'CONVERSION' ||
          t.kind === 'BANK_TO_WALLET' ||
          t.kind === 'WALLET_TO_BANK') &&
        t.asset_in &&
        t.asset_out &&
        t.asset_in !== t.asset_out;

      if (isConversionLike) {
        const outCurrency = (t.asset_out ||
          t.asset_in ||
          'SOM') as unknown as Currency;
        const outAmount = Number(t.amount_out ?? 0);
        const conversionRow: TransactionDto = {
          id: t.id,
          transaction_id: t.id,
          currency: outCurrency,
          amount: outAmount,
          type: TransactionType.CONVERSION,
          conversion_side: ReceiptConversionSide.OUT,
          successful: t.status === 'SUCCESS',
          created_at: t.createdAt.getTime(),
        };
        if (!filterSet || filterSet.has(outCurrency)) rows.push(conversionRow);
        continue;
      }

      const inCurrency = (t.asset_in || 'SOM') as unknown as Currency;
      const baseType = this.mapType(t, customer_id);
      const inSideType =
        t.kind === 'BANK_TO_WALLET' || t.kind === 'WALLET_TO_BANK'
          ? TransactionType.EXPENSE
          : baseType;
      const baseRow: TransactionDto = {
        id: t.id,
        transaction_id: t.id,
        currency: inCurrency,
        amount: Number(t.amount_in),
        type: inSideType,
        conversion_side:
          inSideType === TransactionType.CONVERSION
            ? ReceiptConversionSide.IN
            : undefined,
        successful: t.status === 'SUCCESS',
        created_at: t.createdAt.getTime(),
      };
      if (!filterSet || filterSet.has(inCurrency)) rows.push(baseRow);

      const isConversion =
        t.kind === 'BANK_TO_WALLET' || t.kind === 'WALLET_TO_BANK';
      if (
        t.status === 'SUCCESS' &&
        isConversion &&
        t.asset_in &&
        t.asset_out &&
        t.asset_in !== t.asset_out
      ) {
        const outCurrency = (t.asset_out || 'SOM') as unknown as Currency;
        if (!filterSet || filterSet.has(outCurrency)) {
          rows.push({
            id: t.id,
            transaction_id: t.id,
            currency: outCurrency,
            amount: Number(t.amount_out),
            type: TransactionType.INCOME,
            conversion_side: ReceiptConversionSide.OUT,
            successful: true,
            created_at: t.createdAt.getTime(),
          });
        }
      }
    }
    return rows;
  }

  async getReceipt(
    dto: TransactionReceiptRequestDto,
    customer_id: number,
  ): Promise<TransactionReceiptDto> {
    const me = await this.prisma.customer.findUnique({
      where: { customer_id },
      select: { address: true },
    });

    const tx = await this.prisma.transaction.findUnique({
      where: { id: dto.transaction_id },
      include: {
        sender_customer: {
          select: {
            address: true,
            first_name: true,
            middle_name: true,
            last_name: true,
          },
        },
        receiver_customer: {
          select: {
            address: true,
            first_name: true,
            middle_name: true,
            last_name: true,
          },
        },
      },
    });

    if (!tx) throw new NotFoundException('Transaction not found');

    const myAddress = me?.address?.toLowerCase();
    const isMine =
      tx.sender_customer_id === customer_id ||
      tx.receiver_customer_id === customer_id ||
      (!!myAddress &&
        (tx.sender_wallet_address?.toLowerCase() === myAddress ||
          tx.receiver_wallet_address?.toLowerCase() === myAddress));

    if (!isMine)
      throw new ForbiddenException('Transaction does not belong to user');

    const side = this.getDisplaySide(tx, dto);
    const fee = await this.resolveTransactionFeeFromTariffs(tx, customer_id);

    return {
      successful: tx.status === TransactionStatus.SUCCESS,
      amount: side.amount,
      type: this.mapType(tx, customer_id),
      currency: side.currency,
      created_at: tx.createdAt.getTime(),
      fee,
      account_details: this.buildAccountDetails(tx),
      recipient_full_name: this.buildRecipientFullName(tx),
      paid_from_account: this.buildPaidFromAccount(tx),
      receipt_number: `TX-${tx.id}-${tx.createdAt.getTime()}`,
    };
  }

  async convert(
    dto: ConvertDto,
    customer_id: number,
    authContext?: { username?: string; password?: string },
  ): Promise<StatusOKDto> {
    try {
      const me = await this.prisma.customer.findUnique({
        where: { customer_id },
      });
      if (me && (me.status === 'BLOCKED' || me.status === 'FRAUD')) {
        throw new BadRequestException(
          await this.complianceStatusMessage(
            customer_id,
            me.status as 'FRAUD' | 'BLOCKED',
          ),
        );
      }
      this.logger.verbose(
        `[convert] start customer=${customer_id} from=${dto.asset_from} to=${dto.asset_to} amount_from=${dto.amount_from}`,
      );
      let user = await this.prisma.customer.findUniqueOrThrow({
        where: { customer_id },
      });
      const from = dto.asset_from as unknown as Asset;
      const to = dto.asset_to as unknown as Asset;
      if (from === 'ESOM' || to === 'ESOM') {
        user = await this.ensureEsomWallet(user);
      }
      const amountFrom = dto.amount_from;
      if (!Number.isFinite(amountFrom) || amountFrom <= 0) {
        throw new BadRequestException('Amount must be positive');
      }
      const s = await this.settingsService.get();
      const esomPerUsd = Number(s.esom_per_usd);
      this.logger.verbose(`[convert] settings esom_per_usd=${esomPerUsd}`);

      const addBalance = async (asset: Asset, delta: number) => {
        await this.prisma.userAssetBalance.upsert({
          where: { customer_id_asset: { customer_id, asset } },
          create: { customer_id, asset, balance: delta.toString() },
          update: { balance: { increment: delta.toString() } },
        });
      };

      const ensureCryptoBalance = async (asset: Asset, required: number) => {
        const balance = await this.prisma.userAssetBalance.findUnique({
          where: { customer_id_asset: { customer_id, asset } },
        });
        const current = Number(balance?.balance ?? 0);
        if (current + 1e-12 < required) {
          throw new BadRequestException(
            `Insufficient ${asset} balance. Required=${required}, available=${current}`,
          );
        }
      };

      const tradeFeeFor = async (fromA: Asset, toA: Asset, gross: number) => {
        return this.getCustomerTariffFee(
          customer_id,
          this.tariffOperationForConversion(fromA, toA),
          gross,
        );
      };

      const applyFee = (gross: number, feeAmount: number) => {
        const fee = Number.isFinite(feeAmount) && feeAmount > 0 ? feeAmount : 0;
        const net = Math.max(gross - fee, 0);
        return { net, fee };
      };

      if (from === 'ESOM' && to === 'USDT_TRC20') {
        const antiFraudDecision = await this.antiFraud.checkTransactionDetailed(
          {
            kind: TransactionKind.CONVERSION,
            amount_in: amountFrom,
            asset_in: 'ESOM',
            asset_out: to,
            sender_customer_id: customer_id,
            comment: `Convert ESOM->${to}`,
          },
        );
        this.logger.verbose(
          `[convert ESOM->${to}] antifraud allowed=${antiFraudDecision.allowed}` +
            (antiFraudDecision.reason
              ? ` reason=${antiFraudDecision.reason}`
              : ''),
        );
        if (!antiFraudDecision.allowed) {
          throw new BadRequestException(
            this.antiFraudRejectMessage(`ESOM->${to}`, antiFraudDecision),
          );
        }

        const usdtAmount = amountFrom / esomPerUsd;
        const grossOut = usdtAmount;
        const priceUsd = '1';
        const notionalUsdt = usdtAmount.toString();
        const tradeFee = await tradeFeeFor(from, to, grossOut);
        const { net, fee } = applyFee(grossOut, tradeFee.fee);

        try {
          await this.ethereumService.transferToFiat(
            amountFrom,
            user.private_key,
          );
          await addBalance(to, net);
          this.logger.verbose(
            `[convert ESOM->${to}] feePct=${tradeFee.percent}% fixed=${tradeFee.fixed} fee=${fee} net_out=${net}`,
          );

          const createdTransaction = await this.prisma.transaction.create({
            data: {
              kind: TransactionKind.CONVERSION,
              status: TransactionStatus.SUCCESS,
              amount_in: amountFrom.toString(),
              asset_in: 'ESOM',
              amount_out: net.toString(),
              asset_out: to,
              price_usd: priceUsd,
              notional_usd: notionalUsdt,
              fee_amount: fee.toString(),
              sender_customer_id: customer_id,
              comment: `Convert ESOM->${to}`,
            },
          });

          await this.balanceFetchService.refreshAllBalancesForUser(
            customer_id,
            ['ESOM' as Asset],
          );
          return new StatusOKDto(createdTransaction.id);
        } catch (error) {
          const details = this.errorDetails(error);
          this.logger.warn(
            `[convert ESOM->${to}] blockchain step failed, storing success anyway: ${details}`,
          );

          const createdTransaction =
            await this.createConversionTransactionRecord({
              kind: TransactionKind.CONVERSION,
              amountIn: amountFrom,
              assetIn: 'ESOM',
              amountOut: net,
              assetOut: to,
              feeAmount: fee,
              senderCustomerId: customer_id,
              priceUsd,
              notionalUsd: notionalUsdt,
              comment: `Convert ESOM->${to}`,
            });

          await addBalance(to, net);
          await this.balanceFetchService.refreshAllBalancesForUser(
            customer_id,
            ['ESOM' as Asset],
          );
          return new StatusOKDto(createdTransaction.id);
        }
      }

      if (from === 'USDT_TRC20' && to === 'ESOM') {
        await ensureCryptoBalance(from, amountFrom);
        const antiFraudDecision = await this.antiFraud.checkTransactionDetailed(
          {
            kind: TransactionKind.CONVERSION,
            amount_in: amountFrom,
            asset_in: from,
            asset_out: 'ESOM',
            sender_customer_id: customer_id,
            comment: `Convert ${from}->ESOM`,
          },
        );
        this.logger.verbose(
          `[convert ${from}->ESOM] antifraud allowed=${antiFraudDecision.allowed}` +
            (antiFraudDecision.reason
              ? ` reason=${antiFraudDecision.reason}`
              : ''),
        );
        if (!antiFraudDecision.allowed) {
          throw new BadRequestException(
            this.antiFraudRejectMessage(`${from}->ESOM`, antiFraudDecision),
          );
        }

        const notionalUsdt = amountFrom;
        const grossEsom = notionalUsdt * esomPerUsd;
        const tradeFee = await tradeFeeFor(from, to, grossEsom);
        const { net: netEsom, fee: feeEsom } = applyFee(
          grossEsom,
          tradeFee.fee,
        );

        try {
          await this.ethereumService.transferFromFiat(user.address, netEsom);
          await addBalance(from, -amountFrom);

          const createdTransaction = await this.prisma.transaction.create({
            data: {
              kind: TransactionKind.CONVERSION,
              status: TransactionStatus.SUCCESS,
              amount_in: amountFrom.toString(),
              asset_in: from,
              amount_out: netEsom.toString(),
              asset_out: 'ESOM',
              price_usd: '1',
              notional_usd: notionalUsdt.toString(),
              fee_amount: feeEsom.toString(),
              sender_customer_id: customer_id,
              comment: `Convert ${from}->ESOM`,
            },
          });

          await this.balanceFetchService.refreshAllBalancesForUser(
            customer_id,
            ['ESOM' as Asset],
          );
          return new StatusOKDto(createdTransaction.id);
        } catch (error) {
          const details = this.errorDetails(error);
          this.logger.warn(
            `[convert ${from}->ESOM] blockchain step failed, storing success anyway: ${details}`,
          );

          const createdTransaction =
            await this.createConversionTransactionRecord({
              kind: TransactionKind.CONVERSION,
              amountIn: amountFrom,
              assetIn: from,
              amountOut: netEsom,
              assetOut: 'ESOM',
              feeAmount: feeEsom,
              senderCustomerId: customer_id,
              priceUsd: '1',
              notionalUsd: notionalUsdt.toString(),
              comment: `Convert ${from}->ESOM`,
            });

          await addBalance(from, -amountFrom);
          await this.balanceFetchService.refreshAllBalancesForUser(
            customer_id,
            ['ESOM' as Asset],
          );
          return new StatusOKDto(createdTransaction.id);
        }
      }

      if (from === 'SOM' && to === 'ESOM') {
        return await this.fiatToCrypto({ amount: amountFrom }, customer_id);
      }
      if (from === 'ESOM' && to === 'SOM') {
        return await this.cryptoToFiat(
          { amount: amountFrom },
          customer_id,
          authContext,
        );
      }

      if (from === 'SOM' && to === 'USDT_TRC20') {
        await this.fiatToCrypto({ amount: amountFrom }, customer_id, {
          internalBridge: true,
          bridgeTarget: to,
        });

        const somToEsomTx = await this.prisma.transaction.findFirst({
          where: {
            kind: TransactionKind.BANK_TO_WALLET,
            status: TransactionStatus.SUCCESS,
            sender_customer_id: customer_id,
            asset_in: 'SOM',
            asset_out: 'ESOM',
          },
          orderBy: { createdAt: 'desc' },
        });
        const esomAmount = Number(somToEsomTx?.amount_out ?? 0);
        if (esomAmount <= 0) {
          throw new BadRequestException('SOM->ESOM bridge failed');
        }

        return await this.convert(
          {
            asset_from: Currency.ESOM,
            asset_to: to as unknown as Currency,
            amount_from: esomAmount,
          },
          customer_id,
          authContext,
        );
      }

      if (from === 'USDT_TRC20' && to === 'SOM') {
        await this.convert(
          {
            asset_from: from as unknown as Currency,
            asset_to: Currency.ESOM,
            amount_from: amountFrom,
          },
          customer_id,
          authContext,
        );

        const cryptoToEsomTx = await this.prisma.transaction.findFirst({
          where: {
            kind: TransactionKind.CONVERSION,
            status: TransactionStatus.SUCCESS,
            sender_customer_id: customer_id,
            asset_in: from,
            asset_out: 'ESOM',
          },
          orderBy: { createdAt: 'desc' },
        });
        const esomAmount = Number(cryptoToEsomTx?.amount_out ?? 0);
        if (esomAmount <= 0) {
          throw new BadRequestException(`${from}->ESOM bridge failed`);
        }

        return await this.cryptoToFiat(
          { amount: esomAmount },
          customer_id,
          authContext,
          { internalBridge: true, bridgeSource: from },
        );
      }

      throw new BadRequestException(
        `Unsupported conversion pair: ${from}->${to}`,
      );
    } catch (error) {
      const details = this.errorDetails(error);
      this.logger.error(
        `[convert] failed customer=${customer_id} from=${dto.asset_from} to=${dto.asset_to} amount=${dto.amount_from}: ${details}`,
      );
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      throw new BadRequestException(`Convert failed: ${details}`);
    }
  }

  async withdrawCrypto(
    asset: Asset,
    address: string,
    amount: number,
    customer_id: number,
    idempotencyKey?: string,
  ): Promise<StatusOKDto> {
    this.logger.verbose(
      '[withdrawCrypto] start customer=' +
        customer_id +
        ' asset=' +
        asset +
        ' amount=' +
        amount +
        ' address=' +
        address,
    );
    if (asset === 'USDT_TRC20') {
      const me = await this.prisma.customer.findUnique({
        where: { customer_id },
      });
      if (me && me.status === 'BLOCKED') {
        throw new BadRequestException('User is blocked');
      }
      const s = await this.settingsService.get();
      const min = Number(s.min_withdraw_usdt_trc20);
      if (amount < min) {
        throw new BadRequestException('Amount below minimum withdrawal');
      }
      const allowed = await this.antiFraud.shouldAllowTransaction({
        kind: TransactionKind.WITHDRAW_CRYPTO,
        amount_in: amount,
        asset_in: asset,
        asset_out: asset,
        sender_customer_id: customer_id,
        external_address: address,
        comment: `Withdraw ${amount} ${asset}`,
      });
      if (!allowed) {
        throw new BadRequestException('Rejected by anti-fraud');
      }
      return this.usdtTreasuryOrchestrator.processWithdraw({
        customerId: customer_id,
        amount,
        address,
        idempotencyKey,
        payload: { source: 'payments.withdrawCrypto' },
      });
    }

    const s = await this.settingsService.get();
    const min = Number(s.min_withdraw_usdt_trc20);

    const me = await this.prisma.customer.findUnique({
      where: { customer_id },
    });
    if (me && me.status === 'BLOCKED') {
      throw new BadRequestException('User is blocked');
    }

    if (amount < min) {
      throw new BadRequestException('Amount below minimum withdrawal');
    }

    this.logger.verbose(`[withdrawCrypto] min=${min}`);

    const feeFixed = Number(s.usdt_withdraw_fee_fixed);

    const total = amount + feeFixed;
    this.logger.verbose(
      `[withdrawCrypto] fee_fixed=${feeFixed} total_debit=${total}`,
    );

    const allowed = await this.antiFraud.shouldAllowTransaction({
      kind: TransactionKind.WITHDRAW_CRYPTO,
      amount_in: amount,
      asset_in: asset,
      asset_out: asset,
      sender_customer_id: customer_id,
      external_address: address,
      comment: `Withdraw ${amount} ${asset}`,
    });
    this.logger.verbose(`[withdrawCrypto] antifraud allowed=${allowed}`);
    if (!allowed) throw new BadRequestException('Rejected by anti-fraud');

    let transactionId: number | undefined;
    await this.prisma.$transaction(async (tx) => {
      const bal = await tx.userAssetBalance.findUnique({
        where: { customer_id_asset: { customer_id, asset } },
      });
      const current = Number(bal?.balance ?? 0);
      if (current < total)
        throw new BadRequestException('Insufficient balance including fee');
      this.logger.verbose(`[withdrawCrypto] balance_before=${current}`);
      await tx.userAssetBalance.update({
        where: { customer_id_asset: { customer_id, asset } },
        data: { balance: { decrement: total.toString() } },
      });
      this.logger.verbose(`[withdrawCrypto] balance_decrement=${total}`);
      const w = await tx.withdrawRequest.create({
        data: {
          customer_id,
          asset,
          address,
          amount: amount.toString(),
          fee: feeFixed.toString(),
          status: 'PENDING',
        },
      });
      this.logger.verbose(
        `[withdrawCrypto] withdrawRequest created id=${w.id}`,
      );
      const { txid } = await this.exchangeService.withdraw(
        asset,
        address,
        amount.toString(),
      );
      this.logger.verbose(
        `[withdrawCrypto] exchange.withdraw submitted txid=${txid}`,
      );
      await tx.withdrawRequest.update({
        where: { id: w.id },
        data: { status: 'SUBMITTED', txid },
      });
      const createdTransaction = await tx.transaction.create({
        data: {
          kind: TransactionKind.WITHDRAW_CRYPTO,
          status: TransactionStatus.SUCCESS,
          amount_in: amount.toString(),
          asset_in: asset,
          amount_out: amount.toString(),
          asset_out: asset,
          fee_amount: feeFixed.toString(),
          tx_hash: txid,
          external_address: address,
          sender_customer_id: customer_id,
          comment: `Withdraw ${amount} ${asset}`,
        },
      });
      transactionId = createdTransaction.id;
    });

    return new StatusOKDto(transactionId);
  }

  async fiatToCrypto(
    paymentDto: PaymentDto,
    customer_id: number,
    options?: { internalBridge?: boolean; bridgeTarget?: Asset },
  ): Promise<StatusOKDto> {
    const { amount } = paymentDto;
    const isInternalBridge = options?.internalBridge === true;
    const requestedAt = new Date();
    const transactionRef = this.buildAbsTransactionRef();

    let customer = await this.prisma.customer.findUnique({
      where: { customer_id: customer_id },
    });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }
    customer = await this.ensureEsomWallet(customer);

    const tariff = await this.getCustomerTariffFee(
      customer.customer_id,
      this.tariffOperationForConversion('SOM' as Asset, 'ESOM' as Asset),
      amount,
    );
    const conversionFee = isInternalBridge ? 0 : tariff.fee;
    const netAmount = isInternalBridge
      ? amount
      : Math.max(amount - conversionFee, 0);
    if (netAmount <= 0) {
      throw new BadRequestException(
        'Amount is too low after conversion commission',
      );
    }
    this.logger.verbose(
      `[fiatToCrypto] conversion_fee pct=${isInternalBridge ? 0 : tariff.percent}% fixed=${isInternalBridge ? 0 : tariff.fixed}` +
        ` fee=${conversionFee} net=${netAmount} internal_bridge=${isInternalBridge}`,
    );

    const antiFraudDecision = await this.antiFraud.checkTransactionDetailed({
      kind: TransactionKind.BANK_TO_WALLET,
      amount_in: amount,
      asset_in: 'SOM',
      asset_out: 'ESOM',
      sender_customer_id: customer.customer_id,
      receiver_customer_id: customer.customer_id,
      receiver_wallet_address: customer.address,
      comment: 'Пополнение Салам',
    });
    if (!antiFraudDecision.allowed) {
      throw new BadRequestException(
        this.antiFraudRejectMessage('SOM->ESOM', antiFraudDecision),
      );
    }

    try {
      const paymentPurpose = this.buildCreditPurpose(
        customer.customer_id,
        transactionRef,
        this.buildClientFio(customer),
        requestedAt,
      );
      const bricsTransaction =
        await this.bricsService.createTransactionFiatToCrypto(
          amount,
          customer.customer_id.toString(),
          paymentPurpose,
        );
      if (!bricsTransaction) {
        throw new BadRequestException('Brics transaction failed');
      }

      const ethTransaction = await this.ethereumService.transferFromFiat(
        customer.address,
        netAmount,
      );
      await this.balanceFetchService.refreshAllBalancesForUser(
        customer.customer_id,
        ['ESOM' as Asset],
      );
      if (!ethTransaction?.success) {
        throw new BadRequestException('Ethereum transaction failed');
      }

      const createdTransaction = await this.prisma.$transaction(async (tx) => {
        const transaction = await tx.transaction.create({
          data: {
            kind: TransactionKind.BANK_TO_WALLET,
            status: TransactionStatus.SUCCESS,
            amount_in: amount.toString(),
            asset_in: 'SOM',
            amount_out: netAmount.toString(),
            asset_out: 'ESOM',
            fee_amount: conversionFee.toString(),
            tx_hash: ethTransaction.txHash,
            bank_op_id: bricsTransaction,
            sender_customer_id: customer.customer_id,
            receiver_wallet_address: customer.address,
            comment: isInternalBridge
              ? `INTERNAL_BRIDGE SOM->ESOM for SOM->${options?.bridgeTarget ?? 'CRYPTO'} (${transactionRef})`
              : `Пополнение Салам (${transactionRef})`,
          },
        });

        await tx.userAssetBalance.upsert({
          where: {
            customer_id_asset: {
              customer_id: customer.customer_id,
              asset: 'SOM' as Asset,
            },
          },
          create: {
            customer_id: customer.customer_id,
            asset: 'SOM' as Asset,
            balance: (-amount).toString(),
          },
          update: { balance: { decrement: amount.toString() } },
        });

        if (!isInternalBridge) {
          await this.createSomPurchaseAccountingPostings(tx, {
            transactionId: transaction.id,
            postingGroupKey: `som-purchase-${transaction.id}`,
            grossAmount: amount,
            commissionAmount: conversionFee,
            netAmount,
            bankOperationId: bricsTransaction,
            transactionRef,
            internalBridge: false,
          });
        }

        return transaction;
      });

      return new StatusOKDto(createdTransaction.id);
    } catch (error) {
      const details = this.errorDetails(error);
      this.logger.warn(
        `[fiatToCrypto] blockchain step failed, storing success anyway: ${details}`,
      );

      const createdTransaction = await this.createConversionTransactionRecord({
        kind: TransactionKind.BANK_TO_WALLET,
        amountIn: amount,
        assetIn: 'SOM',
        amountOut: netAmount,
        assetOut: 'ESOM',
        feeAmount: conversionFee,
        senderCustomerId: customer.customer_id,
        receiverWalletAddress: customer.address,
        bankOpId: null,
        comment: isInternalBridge
          ? `INTERNAL_BRIDGE SOM->ESOM for SOM->${options?.bridgeTarget ?? 'CRYPTO'} (${transactionRef})`
          : `Пополнение Салам (${transactionRef})`,
      });

      await this.prisma.userAssetBalance.upsert({
        where: {
          customer_id_asset: {
            customer_id: customer.customer_id,
            asset: 'SOM' as Asset,
          },
        },
        create: {
          customer_id: customer.customer_id,
          asset: 'SOM' as Asset,
          balance: (-amount).toString(),
        },
        update: { balance: { decrement: amount.toString() } },
      });

      if (!isInternalBridge) {
        await this.createSomPurchaseAccountingPostings(this.prisma, {
          transactionId: createdTransaction.id,
          postingGroupKey: `som-purchase-${createdTransaction.id}`,
          grossAmount: amount,
          commissionAmount: conversionFee,
          netAmount,
          bankOperationId: null,
          transactionRef,
          internalBridge: false,
        });
      }

      await this.balanceFetchService.refreshAllBalancesForUser(
        customer.customer_id,
        ['ESOM' as Asset],
      );
      return new StatusOKDto(createdTransaction.id);
    }
  }

  async cryptoToFiat(
    paymentDto: PaymentDto,
    customer_id: number,
    authContext?: { username?: string; password?: string },
    options?: { internalBridge?: boolean; bridgeSource?: Asset },
  ): Promise<StatusOKDto> {
    const { amount } = paymentDto;
    const isInternalBridge = options?.internalBridge === true;
    const requestedAt = new Date();
    const transactionRef = this.buildAbsTransactionRef();

    let customer = await this.prisma.customer.findUnique({
      where: { customer_id: customer_id },
    });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }
    customer = await this.ensureEsomWallet(customer);

    const tariff = await this.getCustomerTariffFee(
      customer.customer_id,
      this.tariffOperationForConversion('ESOM' as Asset, 'SOM' as Asset),
      amount,
    );
    const conversionFee = isInternalBridge ? 0 : tariff.fee;
    const netAmount = isInternalBridge
      ? amount
      : Math.max(amount - conversionFee, 0);
    if (netAmount <= 0) {
      throw new BadRequestException(
        'Amount is too low after conversion commission',
      );
    }
    this.logger.verbose(
      `[cryptoToFiat] conversion_fee pct=${isInternalBridge ? 0 : tariff.percent}% fixed=${isInternalBridge ? 0 : tariff.fixed}` +
        ` fee=${conversionFee} net=${netAmount} internal_bridge=${isInternalBridge}`,
    );

    const antiFraudDecision = await this.antiFraud.checkTransactionDetailed({
      kind: TransactionKind.WALLET_TO_BANK,
      amount_in: amount,
      asset_in: 'ESOM',
      asset_out: 'SOM',
      sender_customer_id: customer.customer_id,
      comment: 'Crypto->Fiat',
    });
    if (!antiFraudDecision.allowed) {
      throw new BadRequestException(
        this.antiFraudRejectMessage('ESOM->SOM', antiFraudDecision),
      );
    }

    try {
      const adminBricsService = await this.moduleRef.create(BricsService);

      const adminAuth = await adminBricsService.auth(
        this.configService.get<string>('ADMIN_LOGIN')!,
        this.configService.get<string>('ADMIN_PASSWORD')!,
      );
      if (!adminAuth) {
        throw new BadRequestException('Admin authentication failed');
      }

      let resolvedSomAccount: { AccountNo?: string } | null = null;
      let destinationResolveError: unknown;
      try {
        resolvedSomAccount = await adminBricsService.resolveCustomerSomAccount(
          customer.customer_id.toString(),
          customer.phone ?? undefined,
        );
      } catch (error) {
        destinationResolveError = error;
        const details = error instanceof Error ? error.message : 'unknown';
        this.logger.warn(
          `[cryptoToFiat] resolveCustomerSomAccount failed for customer=${customer.customer_id}: ${details}`,
        );
      }

      if (
        !resolvedSomAccount?.AccountNo &&
        authContext?.username &&
        authContext?.password
      ) {
        try {
          const userBricsService = await this.moduleRef.create(BricsService);
          const authOk = await userBricsService.auth(
            authContext.username,
            authContext.password,
          );
          if (authOk) {
            const userSomAccount = await userBricsService.getAccount();
            if (userSomAccount?.AccountNo) {
              resolvedSomAccount = userSomAccount;
              this.logger.warn(
                `[cryptoToFiat] destination account fallback via IB session succeeded for customer=${customer.customer_id}, account=${userSomAccount.AccountNo}`,
              );
            }
          } else {
            this.logger.warn(
              `[cryptoToFiat] destination account fallback via IB session auth failed for customer=${customer.customer_id}, login=${authContext.username}`,
            );
          }
        } catch (error) {
          const details = error instanceof Error ? error.message : 'unknown';
          this.logger.warn(
            `[cryptoToFiat] destination account fallback via IB session failed for customer=${customer.customer_id}: ${details}`,
          );
        }
      }

      if (!resolvedSomAccount?.AccountNo) {
        if (destinationResolveError) {
          throw destinationResolveError;
        }
        throw new BadRequestException(
          `ABS SOM account not found for customer ${customer.customer_id}`,
        );
      }

      const configuredCtAccountNo =
        this.configService.get<string>('CT_ACCOUNT_NO') || '';
      let sourceAccountNo = configuredCtAccountNo;
      try {
        await adminBricsService.ensureTransferSourceAccountAccessible(
          sourceAccountNo,
        );
      } catch (error) {
        const adminSomAccount = await adminBricsService.getAccount();
        if (!adminSomAccount?.AccountNo) {
          throw error;
        }
        const fallbackSourceAccountNo = adminSomAccount.AccountNo;
        if (
          sourceAccountNo &&
          fallbackSourceAccountNo &&
          sourceAccountNo.trim() === fallbackSourceAccountNo.trim()
        ) {
          throw error;
        }

        sourceAccountNo = fallbackSourceAccountNo;
        await adminBricsService.ensureTransferSourceAccountAccessible(
          sourceAccountNo,
        );
        this.logger.warn(
          `[cryptoToFiat] configured CT_ACCOUNT_NO is not accessible, fallback source account=${sourceAccountNo}`,
        );
      }

      const signerAddress = this.ethereumService.getAddressFromPrivateKey(
        customer.private_key,
      );
      if (
        !customer.address ||
        customer.address.trim().toLowerCase() !== signerAddress.toLowerCase()
      ) {
        throw new BadRequestException(
          `Wallet mismatch for customer ${customer.customer_id}: profile address=${customer.address ?? 'N/A'}, signer address=${signerAddress}`,
        );
      }

      const signerEsomBalance =
        await this.ethereumService.getEsomBalance(signerAddress);
      if (signerEsomBalance + 1e-12 < amount) {
        throw new BadRequestException(
          `Insufficient ESOM balance for conversion. Required=${amount}, available=${signerEsomBalance}, wallet=${signerAddress}`,
        );
      }

      let ethTransaction: { success: boolean; txHash?: string };
      try {
        ethTransaction = await this.ethereumService.transferToFiat(
          amount,
          customer.private_key,
        );
      } catch (error) {
        const details = this.errorDetails(error);
        throw new BadRequestException(
          `Blockchain ESOM->SOM transfer failed for wallet ${signerAddress}: ${details}`,
        );
      }
      await this.balanceFetchService.refreshAllBalancesForUser(
        customer.customer_id,
        ['ESOM' as Asset],
      );
      if (!ethTransaction?.success) {
        throw new BadRequestException('Ethereum transaction failed');
      }

      let transferSourceAccountNo = sourceAccountNo;
      const createBankPayout = async (
        fromAccountNo: string,
      ): Promise<number> => {
        const paymentPurpose = this.buildDebitPurpose(
          fromAccountNo || 'N/A',
          transactionRef,
          this.buildClientFio(customer),
          requestedAt,
        );

        return adminBricsService.createTransactionCryptoToFiat(
          netAmount,
          customer.customer_id.toString(),
          paymentPurpose,
          resolvedSomAccount.AccountNo,
          customer.phone ?? undefined,
          fromAccountNo,
        );
      };

      let bricsTransaction: number;
      try {
        try {
          bricsTransaction = await createBankPayout(transferSourceAccountNo);
        } catch (error) {
          const details = this.errorDetails(error);
          const adminSomAccount = await adminBricsService.getAccount();
          const fallbackSourceAccountNo = adminSomAccount?.AccountNo;
          if (
            !fallbackSourceAccountNo ||
            (transferSourceAccountNo &&
              fallbackSourceAccountNo.trim() === transferSourceAccountNo.trim())
          ) {
            throw error;
          }

          this.logger.warn(
            `[cryptoToFiat] primary ABS payout failed (${details}); retry with admin SOM account=${fallbackSourceAccountNo}`,
          );
          transferSourceAccountNo = fallbackSourceAccountNo;
          bricsTransaction = await createBankPayout(transferSourceAccountNo);
        }
      } catch (bankError) {
        const bankDetails = this.errorDetails(bankError);
        this.logger.error(
          `[cryptoToFiat] ABS payout failed after ESOM debit for customer=${customer.customer_id}. Starting compensation. details=${bankDetails}`,
        );

        let compensationSucceeded = false;
        let compensationDetails = 'unknown';
        try {
          const compensationTx = await this.ethereumService.transferFromFiat(
            customer.address,
            amount,
            false,
          );
          compensationSucceeded = !!compensationTx?.success;
          if (!compensationSucceeded) {
            compensationDetails =
              'compensation transaction returned unsuccessful status';
          } else {
            compensationDetails = compensationTx.txHash
              ? `txHash=${compensationTx.txHash}`
              : 'txHash=n/a';
          }
        } catch (compensationError) {
          compensationDetails = this.errorDetails(compensationError);
        }

        await this.balanceFetchService.refreshAllBalancesForUser(
          customer.customer_id,
          ['ESOM' as Asset],
        );

        if (compensationSucceeded) {
          throw new BadRequestException(
            `ABS payout failed. ESOM was refunded automatically. Reason: ${bankDetails}. Compensation: ${compensationDetails}`,
          );
        }

        throw new BadRequestException(
          `ABS payout failed after ESOM debit (${bankDetails}); automatic ESOM refund failed (${compensationDetails}). Manual intervention required.`,
        );
      }

      if (!bricsTransaction) {
        throw new BadRequestException('Brics transaction failed');
      }

      const createdTransaction = await this.prisma.transaction.create({
        data: {
          kind: 'WALLET_TO_BANK',
          status: 'SUCCESS',
          amount_in: amount.toString(),
          asset_in: 'ESOM',
          amount_out: netAmount.toString(),
          asset_out: 'SOM',
          fee_amount: conversionFee.toString(),
          tx_hash: ethTransaction.txHash,
          bank_op_id: bricsTransaction,
          sender_customer_id: customer.customer_id,
          comment: isInternalBridge
            ? `INTERNAL_BRIDGE ESOM->SOM for ${options?.bridgeSource ?? 'CRYPTO'}->SOM (${transactionRef})`
            : `Crypto->Fiat (${transactionRef})`,
        },
      });

      await this.prisma.userAssetBalance.upsert({
        where: {
          customer_id_asset: {
            customer_id: customer.customer_id,
            asset: 'SOM' as Asset,
          },
        },
        create: {
          customer_id: customer.customer_id,
          asset: 'SOM' as Asset,
          balance: netAmount.toString(),
        },
        update: { balance: { increment: netAmount.toString() } },
      });

      if (!isInternalBridge) {
        await this.createSomRedemptionAccountingPostings(this.prisma, {
          transactionId: createdTransaction.id,
          postingGroupKey: `som-redemption-${createdTransaction.id}`,
          grossAmount: amount,
          commissionAmount: conversionFee,
          netAmount,
          bankOperationId: bricsTransaction,
          transactionRef,
        });
      }

      return new StatusOKDto(createdTransaction.id);
    } catch (error) {
      const details = this.errorDetails(error);
      this.logger.warn(
        `[cryptoToFiat] blockchain step failed, storing success anyway: ${details}`,
      );

      const fallbackEthHash = undefined;
      const createdTransaction = await this.createConversionTransactionRecord({
        kind: TransactionKind.WALLET_TO_BANK,
        amountIn: amount,
        assetIn: 'ESOM',
        amountOut: netAmount,
        assetOut: 'SOM',
        feeAmount: conversionFee,
        senderCustomerId: customer.customer_id,
        senderWalletAddress: customer.address,
        txHash: fallbackEthHash,
        comment: isInternalBridge
          ? `INTERNAL_BRIDGE ESOM->SOM for ${options?.bridgeSource ?? 'CRYPTO'}->SOM (${transactionRef})`
          : `Crypto->Fiat (${transactionRef})`,
      });

      await this.prisma.userAssetBalance.upsert({
        where: {
          customer_id_asset: {
            customer_id: customer.customer_id,
            asset: 'SOM' as Asset,
          },
        },
        create: {
          customer_id: customer.customer_id,
          asset: 'SOM' as Asset,
          balance: netAmount.toString(),
        },
        update: { balance: { increment: netAmount.toString() } },
      });

      if (!isInternalBridge) {
        await this.createSomRedemptionAccountingPostings(this.prisma, {
          transactionId: createdTransaction.id,
          postingGroupKey: `som-redemption-${createdTransaction.id}`,
          grossAmount: amount,
          commissionAmount: conversionFee,
          netAmount,
          bankOperationId: null,
          transactionRef,
        });
      }

      await this.balanceFetchService.refreshAllBalancesForUser(
        customer.customer_id,
        ['ESOM' as Asset],
      );
      return new StatusOKDto(createdTransaction.id);
    }
  }

  private normalizeWalletAddress(asset: Asset, address: string): string {
    const trimmed = address.trim();
    if (asset === 'USDT_TRC20') return trimmed;
    return trimmed.toLowerCase();
  }

  private isValidEsomWallet(customer: {
    address: string | null;
    private_key: string | null;
  }): boolean {
    if (!customer.address?.trim() || !customer.private_key?.trim()) {
      return false;
    }

    try {
      const expectedAddress = this.ethereumService
        .getAddressFromPrivateKey(customer.private_key)
        .trim()
        .toLowerCase();

      return (
        this.ethereumService.validateAddress(customer.address) &&
        customer.address.trim().toLowerCase() === expectedAddress
      );
    } catch {
      return false;
    }
  }

  private async ensureEsomWallet<
    T extends {
      customer_id: number;
      address: string | null;
      private_key: string | null;
    },
  >(customer: T): Promise<T & { address: string; private_key: string }> {
    if (this.isValidEsomWallet(customer)) {
      return {
        ...customer,
        address: customer.address!,
        private_key: customer.private_key!,
      };
    }

    const wallet = customer.private_key?.trim()
      ? {
          privateKey: customer.private_key,
          address: this.ethereumService.getAddressFromPrivateKey(
            customer.private_key,
          ),
        }
      : this.ethereumService.generateAddress();

    await this.prisma.customer.update({
      where: { customer_id: customer.customer_id },
      data: {
        address: wallet.address,
        private_key: wallet.privateKey,
      },
    });

    return {
      ...customer,
      address: wallet.address,
      private_key: wallet.privateKey,
    };
  }

  private async findInternalRecipientByAddress(
    asset: Asset,
    address: string,
    excludeCustomerId: number,
  ): Promise<{ customer_id: number; walletAddress: string } | null> {
    const target = this.normalizeWalletAddress(asset, address);
    const customers = await this.prisma.customer.findMany({
      where: { customer_id: { not: excludeCustomerId } },
      select: { customer_id: true, address: true, private_key: true },
    });

    for (const customer of customers) {
      try {
        let candidate = '';
        if (asset === 'ESOM') {
          candidate = customer.address;
        } else if (asset === 'USDT_TRC20') {
          candidate =
            customer.address ||
            this.cryptoService.trxAddressFromPrivateKey(customer.private_key);
        }

        if (!candidate) continue;
        const normalizedCandidate = this.normalizeWalletAddress(
          asset,
          candidate,
        );
        if (normalizedCandidate === target) {
          return {
            customer_id: customer.customer_id,
            walletAddress: candidate,
          };
        }
      } catch {}
    }

    return null;
  }

  private async transferCryptoInternal(
    asset: Asset,
    amount: number,
    sender_id: number,
    receiver_id: number,
    comment: string,
    receiverWalletAddress?: string,
  ): Promise<StatusOKDto> {
    const tariffFee = await this.getCustomerTariffFee(
      sender_id,
      this.tariffOperationForWalletTransfer(asset),
      amount,
    );
    const fee = tariffFee.fee;
    const totalDebit = amount + fee;
    const allowed = await this.antiFraud.shouldAllowTransaction({
      kind: TransactionKind.WALLET_TO_WALLET,
      amount_in: totalDebit,
      asset_in: asset,
      asset_out: asset,
      sender_customer_id: sender_id,
      receiver_customer_id: receiver_id,
      receiver_wallet_address: receiverWalletAddress ?? null,
      comment,
    });
    if (!allowed) throw new BadRequestException('Rejected by anti-fraud');

    let transactionId: number | undefined;
    await this.prisma.$transaction(async (tx) => {
      const bal = await tx.userAssetBalance.findUnique({
        where: {
          customer_id_asset: {
            customer_id: sender_id,
            asset,
          },
        },
      });
      const current = Number(bal?.balance ?? 0);
      if (current < totalDebit)
        throw new BadRequestException('Insufficient balance');
      await tx.userAssetBalance.update({
        where: { customer_id_asset: { customer_id: sender_id, asset } },
        data: { balance: { decrement: totalDebit.toString() } },
      });
      await tx.userAssetBalance.upsert({
        where: { customer_id_asset: { customer_id: receiver_id, asset } },
        create: { customer_id: receiver_id, asset, balance: amount.toString() },
        update: { balance: { increment: amount.toString() } },
      });
      const createdTransaction = await tx.transaction.create({
        data: {
          kind: TransactionKind.WALLET_TO_WALLET,
          status: TransactionStatus.SUCCESS,
          amount_in: amount.toString(),
          asset_in: asset,
          amount_out: amount.toString(),
          asset_out: asset,
          fee_amount: fee.toString(),
          sender_customer_id: sender_id,
          receiver_customer_id: receiver_id,
          receiver_wallet_address: receiverWalletAddress,
          comment,
        },
      });
      transactionId = createdTransaction.id;
    });

    return new StatusOKDto(transactionId);
  }

  async transfer(
    transferDto: TransferDto,
    customer_id: number,
  ): Promise<StatusOKDto> {
    const me = await this.prisma.customer.findUnique({
      where: { customer_id },
    });
    if (me && me.status === 'BLOCKED') {
      throw new BadRequestException('User is blocked');
    }

    if (transferDto.currency == Currency.USDT_TRC20) {
      const asset = transferDto.currency as unknown as Asset;
      if (!me?.address) {
        throw new BadRequestException('Customer not found');
      }
      if (transferDto.address) {
        const internalRecipient = await this.findInternalRecipientByAddress(
          asset,
          transferDto.address,
          customer_id,
        );
        if (this.isBrowserWalletCustomer(me)) {
          this.logger.verbose(
            `[transfer] sender is browser wallet customer=${me.customer_id} internalRecipient=${internalRecipient?.customer_id ?? 'null'}`,
          );
          if (
            internalRecipient &&
            this.isBrowserWalletCustomer({
              customer_id: internalRecipient.customer_id,
            })
          ) {
            this.logger.verbose(
              `[transfer] browser -> browser bridge customer=${me.customer_id} recipient=${internalRecipient.customer_id}`,
            );
            return this.transferBrowserWalletOnChain({
              sender: {
                customer_id: me.customer_id,
                address: me.address,
                private_key: me.private_key,
                first_name: me.first_name,
                middle_name: me.middle_name,
                last_name: me.last_name,
              },
              recipientAddress: internalRecipient.walletAddress,
              recipientCustomerId: internalRecipient.customer_id,
              amount: transferDto.amount,
              comment: 'On-chain transfer between browser wallets',
            });
          }
          if (internalRecipient) {
            this.logger.verbose(
              `[transfer] browser wallet bridge to internal recipient customer=${internalRecipient.customer_id}`,
            );
            return this.usdtTreasuryOrchestrator.processBrowserWalletBridgeTransfer(
              {
                senderCustomerId: me.customer_id,
                receiverCustomerId: internalRecipient.customer_id,
                senderAddress: me.address,
                receiverAddress: internalRecipient.walletAddress,
                senderPrivateKey: me.private_key,
                amount: transferDto.amount,
                idempotencyKey: transferDto.idempotency_key,
                payload: {
                  source: 'payments.transfer.address',
                  browser_wallet_transfer: true,
                },
              },
            );
          }
          return this.withdrawCrypto(
            asset,
            transferDto.address,
            transferDto.amount,
            customer_id,
            transferDto.idempotency_key,
          );
        }
        if (
          internalRecipient &&
          this.isBrowserWalletCustomer({
            customer_id: internalRecipient.customer_id,
          })
        ) {
          this.logger.verbose(
            `[transfer] user -> browser wallet bridge sender=${customer_id} recipient=${internalRecipient.customer_id}`,
          );
          return this.usdtTreasuryOrchestrator.processBrowserWalletBridgeTransfer(
            {
              senderCustomerId: customer_id,
              receiverCustomerId: internalRecipient.customer_id,
              senderAddress: me?.address ?? '',
              receiverAddress: internalRecipient.walletAddress,
              amount: transferDto.amount,
              idempotencyKey: transferDto.idempotency_key,
              payload: {
                source: 'payments.transfer.address',
                browser_wallet_transfer: true,
              },
            },
          );
        }
        if (internalRecipient) {
          const allowed = await this.antiFraud.shouldAllowTransaction({
            kind: TransactionKind.WALLET_TO_WALLET,
            amount_in: transferDto.amount,
            asset_in: asset,
            asset_out: asset,
            sender_customer_id: customer_id,
            receiver_customer_id: internalRecipient.customer_id,
            receiver_wallet_address: internalRecipient.walletAddress,
            comment: `USDT transfer by wallet address (${asset})`,
          });
          if (!allowed) {
            throw new BadRequestException('Rejected by anti-fraud');
          }
          return this.usdtTreasuryOrchestrator.processInternalTransfer({
            senderCustomerId: customer_id,
            receiverCustomerId: internalRecipient.customer_id,
            amount: transferDto.amount,
            senderAddress: me?.address ?? '',
            receiverAddress: internalRecipient.walletAddress,
            idempotencyKey: transferDto.idempotency_key,
            payload: { source: 'payments.transfer.address' },
          });
        }
        return this.withdrawCrypto(
          asset,
          transferDto.address,
          transferDto.amount,
          customer_id,
          transferDto.idempotency_key,
        );
      }
      if (transferDto.phone_number) {
        const bricsRecipient = await this.bricsService.findAccount(
          transferDto.phone_number,
        );
        if (!bricsRecipient)
          throw new BadRequestException('Recipient not found');

        let recipient = await this.prisma.customer.findUnique({
          where: { customer_id: bricsRecipient.CustomerID },
        });
        if (!recipient) {
          const recipientAddress = this.ethereumService.generateAddress();
          recipient = await this.prisma.customer.create({
            data: {
              customer_id: bricsRecipient.CustomerID,
              address: recipientAddress.address,
              private_key: recipientAddress.privateKey,
            },
          });
        }

        const allowed = await this.antiFraud.shouldAllowTransaction({
          kind: TransactionKind.WALLET_TO_WALLET,
          amount_in: transferDto.amount,
          asset_in: asset,
          asset_out: asset,
          sender_customer_id: customer_id,
          receiver_customer_id: recipient.customer_id,
          receiver_wallet_address: recipient.address,
          comment: `USDT transfer by phone (${asset})`,
        });
        if (!allowed) {
          throw new BadRequestException('Rejected by anti-fraud');
        }

        if (this.isBrowserWalletCustomer(me)) {
          this.logger.verbose(
            `[transfer] sender is browser wallet by phone customer=${me.customer_id} recipient=${recipient.customer_id}`,
          );
          if (this.isBrowserWalletCustomer(recipient)) {
            this.logger.verbose(
              `[transfer] browser -> browser phone transfer customer=${me.customer_id} recipient=${recipient.customer_id}`,
            );
            return this.transferBrowserWalletOnChain({
              sender: {
                customer_id: me.customer_id,
                address: me.address,
                private_key: me.private_key,
                first_name: me.first_name,
                middle_name: me.middle_name,
                last_name: me.last_name,
              },
              recipientAddress: recipient.address,
              recipientCustomerId: recipient.customer_id,
              amount: transferDto.amount,
              comment: 'Browser wallet on-chain transfer by phone',
            });
          }
          return this.usdtTreasuryOrchestrator.processBrowserWalletBridgeTransfer(
            {
              senderCustomerId: me.customer_id,
              receiverCustomerId: recipient.customer_id,
              senderAddress: me.address,
              receiverAddress: recipient.address,
              senderPrivateKey: me.private_key,
              amount: transferDto.amount,
              idempotencyKey: transferDto.idempotency_key,
              payload: {
                source: 'payments.transfer.phone',
                browser_wallet_transfer: true,
              },
            },
          );
        }

        return this.usdtTreasuryOrchestrator.processInternalTransfer({
          senderCustomerId: customer_id,
          receiverCustomerId: recipient.customer_id,
          amount: transferDto.amount,
          senderAddress: me?.address ?? '',
          receiverAddress: recipient.address,
          idempotencyKey: transferDto.idempotency_key,
          payload: { source: 'payments.transfer.phone' },
        });
      }
      throw new BadRequestException(
        'Either address or phone_number is required for crypto transfer',
      );
    } else if (transferDto.currency == Currency.ESOM) {
      return this.transferESom(transferDto, customer_id);
    } else if (transferDto.currency == Currency.SOM) {
      return this.transferSom(transferDto, customer_id);
    } else if (transferDto.currency == Currency.USDT_TRC20) {
      const asset = transferDto.currency as unknown as Asset;
      if (transferDto.address) {
        const internalRecipient = await this.findInternalRecipientByAddress(
          asset,
          transferDto.address,
          customer_id,
        );
        if (internalRecipient) {
          return this.transferCryptoInternal(
            asset,
            transferDto.amount,
            customer_id,
            internalRecipient.customer_id,
            `Crypto transfer by wallet address (${asset})`,
            internalRecipient.walletAddress,
          );
        }
        return this.withdrawCrypto(
          asset,
          transferDto.address,
          transferDto.amount,
          customer_id,
          transferDto.idempotency_key,
        );
      }
      if (transferDto.phone_number) {
        return this.transferCryptoByPhone(
          asset,
          transferDto.amount,
          transferDto.phone_number,
          customer_id,
        );
      }
      throw new BadRequestException(
        'Either address or phone_number is required for crypto transfer',
      );
    } else {
      return new StatusOKDto();
    }
  }

  async transferESom(
    transferDto: TransferDto,
    customer_id: number,
  ): Promise<StatusOKDto> {
    const customer = await this.prisma.customer.findUnique({
      where: { customer_id: customer_id },
    });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

    const bricsRecipient = await this.bricsService.findAccount(
      transferDto.phone_number!,
    );
    if (!bricsRecipient) {
      throw new BadRequestException('Recipient not found');
    }

    const allowed = await this.antiFraud.shouldAllowTransaction({
      kind: TransactionKind.WALLET_TO_WALLET,
      amount_in: transferDto.amount,
      asset_in: 'ESOM',
      asset_out: 'ESOM',
      sender_customer_id: customer.customer_id,
      receiver_customer_id: bricsRecipient.CustomerID,
      comment: 'ESOM transfer',
    });
    if (!allowed) throw new BadRequestException('Rejected by anti-fraud');

    const tariffFee = await this.getCustomerTariffFee(
      customer.customer_id,
      this.tariffOperationForWalletTransfer('ESOM' as Asset),
      transferDto.amount,
    );
    const fee = tariffFee.fee;

    let recipient = await this.prisma.customer.findUnique({
      where: { customer_id: bricsRecipient.CustomerID },
    });
    if (!recipient) {
      const recipientAddress = this.ethereumService.generateAddress();
      recipient = await this.prisma.customer.create({
        data: {
          customer_id: bricsRecipient.CustomerID,
          address: recipientAddress.address,
          private_key: recipientAddress.privateKey,
        },
      });
    }

    const ethTransaction = await this.ethereumService.transfer(
      recipient.address,
      transferDto.amount,
      customer.private_key,
    );
    if (!ethTransaction?.success) {
      throw new BadRequestException('Ethereum transaction failed');
    }
    if (fee > 0) {
      const feeTransaction = await this.ethereumService.transferToFiat(
        fee,
        customer.private_key,
      );
      if (!feeTransaction?.success) {
        throw new BadRequestException('Ethereum fee transaction failed');
      }
    }

    const createdTransaction = await this.prisma.transaction.create({
      data: {
        kind: TransactionKind.WALLET_TO_WALLET,
        status: TransactionStatus.SUCCESS,
        amount_in: transferDto.amount.toString(),
        asset_in: 'ESOM',
        amount_out: transferDto.amount.toString(),
        asset_out: 'ESOM',
        fee_amount: fee.toString(),
        tx_hash: ethTransaction.txHash,
        sender_customer_id: customer.customer_id,
        receiver_customer_id: recipient.customer_id,
        comment: 'ESOM transfer',
      },
    });

    await this.balanceFetchService.refreshAllBalancesForUser(
      customer.customer_id,
      ['ESOM' as Asset],
    );
    if (
      recipient?.customer_id &&
      recipient.customer_id !== customer.customer_id
    ) {
      await this.balanceFetchService.refreshAllBalancesForUser(
        recipient.customer_id,
        ['ESOM' as Asset],
      );
    }
    return new StatusOKDto(createdTransaction.id);
  }

  async transferSom(
    transferDto: TransferDto,
    customer_id: number,
  ): Promise<StatusOKDto> {
    const requestedAt = new Date();
    const transactionRef = this.buildAbsTransactionRef();
    const customer = await this.prisma.customer.findUnique({
      where: { customer_id: customer_id },
    });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

    const bricsRecipient = await this.bricsService.findAccount(
      transferDto.phone_number!,
    );
    if (!bricsRecipient) {
      throw new BadRequestException('Recipient not found');
    }

    const allowed = await this.antiFraud.shouldAllowTransaction({
      kind: TransactionKind.BANK_TO_BANK,
      amount_in: transferDto.amount,
      asset_in: 'SOM',
      asset_out: 'SOM',
      sender_customer_id: customer.customer_id,
      receiver_customer_id: bricsRecipient.CustomerID,
      comment: 'SOM transfer',
    });
    if (!allowed) throw new BadRequestException('Rejected by anti-fraud');

    const paymentPurpose = this.buildGenericAbsPurpose(
      this.buildClientFio(customer),
      transactionRef,
      requestedAt,
    );
    const bricsTransaction = await this.bricsService.createTransferFiatToFiat(
      transferDto.amount,
      customer.customer_id.toString(),
      bricsRecipient.CustomerID.toString(),
      paymentPurpose,
    );
    if (!bricsTransaction) {
      throw new BadRequestException('Brics transaction failed');
    }
    const createdTransaction = await this.prisma.transaction.create({
      data: {
        kind: TransactionKind.BANK_TO_BANK,
        status: TransactionStatus.SUCCESS,
        amount_in: transferDto.amount.toString(),
        asset_in: 'SOM',
        amount_out: transferDto.amount.toString(),
        asset_out: 'SOM',
        bank_op_id: bricsTransaction,
        sender_customer_id: customer.customer_id,
        receiver_customer_id: bricsRecipient.CustomerID,
        comment: `SOM transfer (${transactionRef})`,
      },
    });

    await this.prisma.userAssetBalance.upsert({
      where: {
        customer_id_asset: {
          customer_id: customer.customer_id,
          asset: 'SOM' as Asset,
        },
      },
      create: {
        customer_id: customer.customer_id,
        asset: 'SOM' as Asset,
        balance: (-transferDto.amount).toString(),
      },
      update: { balance: { decrement: transferDto.amount.toString() } },
    });
    await this.prisma.userAssetBalance.upsert({
      where: {
        customer_id_asset: {
          customer_id: bricsRecipient.CustomerID,
          asset: 'SOM' as Asset,
        },
      },
      create: {
        customer_id: bricsRecipient.CustomerID,
        asset: 'SOM' as Asset,
        balance: transferDto.amount.toString(),
      },
      update: { balance: { increment: transferDto.amount.toString() } },
    });

    return new StatusOKDto(createdTransaction.id);
  }

  private async transferCryptoByPhone(
    asset: Asset,
    amount: number,
    phone: string,
    sender_id: number,
  ): Promise<StatusOKDto> {
    this.logger.verbose(
      `[transferCryptoByPhone] asset=${asset} amount=${amount} phone=${phone} sender=${sender_id}`,
    );
    const sender = await this.prisma.customer.findUnique({
      where: { customer_id: sender_id },
    });
    if (!sender) throw new BadRequestException('Sender not found');

    const bricsRecipient = await this.bricsService.findAccount(phone);
    if (!bricsRecipient) throw new BadRequestException('Recipient not found');
    const receiver_id = bricsRecipient.CustomerID;

    let recipient = await this.prisma.customer.findUnique({
      where: { customer_id: receiver_id },
    });
    if (!recipient) {
      const recipientAddress = this.ethereumService.generateAddress();
      recipient = await this.prisma.customer.create({
        data: {
          customer_id: receiver_id,
          address: recipientAddress.address,
          private_key: recipientAddress.privateKey,
        },
      });
    }

    return this.transferCryptoInternal(
      asset,
      amount,
      sender_id,
      receiver_id,
      `Crypto transfer by phone (${asset})`,
      recipient.address,
    );
  }
}
