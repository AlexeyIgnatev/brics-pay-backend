import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
/* eslint-disable max-classes-per-file */
import { ModuleRef } from '@nestjs/core';
import { Asset, PrismaClient, Transaction, TransactionKind, TransactionStatus } from '@prisma/client';
import { AntiFraudDecision, AntiFraudService } from '../antifraud/antifraud.service';
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

import { GetTransactions } from './dto/get-transactions.dto';
import { ReceiptConversionSide, TransactionReceiptDto, TransactionReceiptRequestDto } from './dto/transaction-receipt.dto';
import { TransactionDto } from './dto/transaction.dto';
import { TransactionType } from './enums/transaction-type';

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
  ) {
  }

  private readonly logger = new (Logger as any)('PaymentsService');

  private antiFraudRejectMessage(flow: string, decision: AntiFraudDecision): string {
    const parts: string[] = [`flow=${flow}`];
    if (decision.rule_key) parts.push(`rule=${decision.rule_key}`);
    if (decision.case_id != null) parts.push(`case_id=${decision.case_id}`);
    if (decision.transaction_id != null) parts.push(`transaction_id=${decision.transaction_id}`);
    if (decision.reason) parts.push(`reason=${decision.reason}`);
    return `Rejected by anti-fraud (${parts.join(', ')})`;
  }

  private buildClientFio(customer: {
    customer_id: number;
    first_name?: string | null;
    middle_name?: string | null;
    last_name?: string | null;
  } | null): string {
    const fullName = [customer?.last_name, customer?.first_name, customer?.middle_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    return fullName || `Client #${customer?.customer_id ?? 'N/A'}`;
  }

  // Business format requested by ABS task: SS:MM:HH.
  private formatAbsTime(date: Date): string {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${ss}:${mm}:${hh}`;
  }

  private buildAbsTransactionRef(): string {
    return `ABS-${Date.now()}`;
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

  private calcSomEsomConversionFee(
    amount: number,
    settings: { esom_som_conversion_fee_pct?: string; esom_som_conversion_fee_min?: string },
  ): { fee: number; net: number; pct: number; minFee: number } {
    const pct = Number(settings.esom_som_conversion_fee_pct ?? 0);
    const minFee = Number(settings.esom_som_conversion_fee_min ?? 0);
    const safePct = Number.isFinite(pct) && pct > 0 ? pct : 0;
    const safeMinFee = Number.isFinite(minFee) && minFee > 0 ? minFee : 0;
    const feeByPct = amount * (safePct / 100);
    const fee = Math.max(feeByPct, safeMinFee);
    const net = Math.max(amount - fee, 0);
    return { fee, net, pct: safePct, minFee: safeMinFee };
  }

  private mapType(t: Transaction, customer_id: number): TransactionType {
    switch (t.kind) {
      case 'BANK_TO_BANK':
        if (t.sender_customer_id === customer_id) return TransactionType.EXPENSE;
        if (t.receiver_customer_id === customer_id) return TransactionType.INCOME;
        return TransactionType.TRANSFER;
      case 'BANK_TO_WALLET':
        return TransactionType.CONVERSION;
      case 'WALLET_TO_BANK':
        return TransactionType.CONVERSION;
      case 'WALLET_TO_WALLET':
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
    return `****${raw.slice(-4)}`;
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

    const isConversion = (t.kind === 'CONVERSION' || t.kind === 'BANK_TO_WALLET' || t.kind === 'WALLET_TO_BANK')
      && t.status === TransactionStatus.SUCCESS
      && t.asset_in !== t.asset_out;

    if (isConversion && requested.conversion_side === ReceiptConversionSide.OUT) {
      return { currency: outCurrency, amount: outAmount };
    }

    return { currency: inCurrency, amount: inAmount };
  }

  private buildRecipientFullName(t: {
    receiver_customer?: {
      first_name: string | null;
      middle_name: string | null;
      last_name: string | null;
    } | null;
    receiver_customer_id: number | null;
  }): string {
    const fullName = [t.receiver_customer?.last_name, t.receiver_customer?.first_name, t.receiver_customer?.middle_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (fullName) return fullName;
    if (t.receiver_customer_id != null) return `Customer #${t.receiver_customer_id}`;
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
    if (this.isBankKind(t.kind) && t.sender_customer_id != null) return `Bank account of customer #${t.sender_customer_id}`;
    if (t.bank_op_id != null) return `Bank operation #${t.bank_op_id}`;
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
    const targetWallet = t.external_address || t.receiver_wallet_address || t.receiver_customer?.address;
    if (targetWallet) return this.maskAccount(targetWallet);
    if (this.isBankKind(t.kind) && t.receiver_customer_id != null) return `Bank account of customer #${t.receiver_customer_id}`;
    if (t.bank_op_id != null) return `Bank operation #${t.bank_op_id}`;
    return 'N/A';
  }


  async getHistory(body: GetTransactions, customer_id: number): Promise<TransactionDto[]> {
    const me = await this.prisma.customer.findUnique({ where: { customer_id } });
    const userOr = [
      { sender_customer_id: customer_id },
      { receiver_customer_id: customer_id },
      me?.address ? { sender_wallet_address: me.address } : undefined,
      me?.address ? { receiver_wallet_address: me.address } : undefined,
    ].filter(Boolean);

    const where: any = { OR: userOr };

    if (body.currency?.length) {
      const assets = body.currency.map(c => c as unknown as Asset);
      const currencyOr = [
        { asset_out: { in: assets } },
        { asset_in: { in: assets } },
      ];
      // Объединяем фильтр пользователя И фильтр валюты через AND
      where.AND = [{ OR: userOr }, { OR: currencyOr }];
      delete where.OR;
    }
    if (body.from_time || body.to_time) {
      where.createdAt = {} as { gte?: Date; lte?: Date };
      if (body.from_time) (where.createdAt as { gte?: Date }).gte = new Date(body.from_time);
      if (body.to_time) (where.createdAt as { lte?: Date }).lte = new Date(body.to_time);
    }

    const items: Transaction[] = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: body.skip ?? 0,
      take: body.take ?? 50,
    });

    // По умолчанию показываем входящую сторону (asset_in/amount_in)
    const rows: TransactionDto[] = [];
    const filterSet = body.currency?.length ? new Set(body.currency) : null;

    for (const t of items) {
      const inCurrency = (t.asset_in || 'SOM') as unknown as Currency;
      const baseRow: TransactionDto = {
        id: t.id,
        currency: inCurrency,
        amount: Number(t.amount_in),
        type: this.mapType(t, customer_id),
        successful: t.status === 'SUCCESS',
        created_at: t.createdAt.getTime(),
      };
      if (!filterSet || filterSet.has(inCurrency)) rows.push(baseRow);

      // Если успешная конвертация и валюты различаются — добавить вторую строку с out
      const isConversion = t.kind === 'CONVERSION' || t.kind === 'BANK_TO_WALLET' || t.kind === 'WALLET_TO_BANK';
      if (t.status === 'SUCCESS' && isConversion && t.asset_in && t.asset_out && t.asset_in !== t.asset_out) {
        const outCurrency = (t.asset_out || 'SOM') as unknown as Currency;
        if (!filterSet || filterSet.has(outCurrency)) {
          rows.push({
            id: t.id,
            currency: outCurrency,
            amount: Number(t.amount_out),
            type: this.mapType(t, customer_id),
            successful: true,
            created_at: t.createdAt.getTime(),
          });
        }
      }
    }
    return rows;
  }

  async getReceipt(dto: TransactionReceiptRequestDto, customer_id: number): Promise<TransactionReceiptDto> {
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
    const isMine = tx.sender_customer_id === customer_id
      || tx.receiver_customer_id === customer_id
      || (!!myAddress && (
        tx.sender_wallet_address?.toLowerCase() === myAddress
        || tx.receiver_wallet_address?.toLowerCase() === myAddress
      ));

    if (!isMine) throw new ForbiddenException('Transaction does not belong to user');

    const side = this.getDisplaySide(tx, dto);

    return {
      successful: tx.status === TransactionStatus.SUCCESS,
      amount: side.amount,
      type: this.mapType(tx, customer_id),
      currency: side.currency,
      created_at: tx.createdAt.getTime(),
      fee: Number(tx.fee_amount ?? 0),
      account_details: this.buildAccountDetails(tx),
      recipient_full_name: this.buildRecipientFullName(tx),
      paid_from_account: this.buildPaidFromAccount(tx),
      receipt_number: `TX-${tx.id}-${tx.createdAt.getTime()}`,
    };
  }

  async convert(dto: ConvertDto, customer_id: number): Promise<StatusOKDto> {
    const me = await this.prisma.customer.findUnique({ where: { customer_id } });
    if (me && me.status === 'BLOCKED') {
      throw new BadRequestException('User is blocked');
    }
    this.logger.verbose(`[convert] start customer=${customer_id} from=${dto.asset_from} to=${dto.asset_to} amount_from=${dto.amount_from}`);
    const user = await this.prisma.customer.findUniqueOrThrow({ where: { customer_id } });
    const s = await this.settingsService.get();
    const from = dto.asset_from as unknown as Asset;
    const to = dto.asset_to as unknown as Asset;
    const amountFrom = dto.amount_from;
    const esomPerUsd = Number(s.esom_per_usd);
    this.logger.verbose(`[convert] settings esom_per_usd=${esomPerUsd}`);

    const addBalance = async (asset: Asset, delta: number) => {
      await this.prisma.userAssetBalance.upsert({
        where: { customer_id_asset: { customer_id, asset } },
        create: { customer_id, asset, balance: delta.toString() },
        update: { balance: { increment: delta.toString() } },
      });
    };

    const feePctForAsset = (asset: Asset): number => {
      switch (asset) {
        case 'BTC':
          return Number(s.btc_trade_fee_pct || 0);
        case 'ETH':
          return Number(s.eth_trade_fee_pct || 0);
        case 'USDT_TRC20':
          return Number(s.usdt_trade_fee_pct || 0);
        default:
          return 0;
      }
    };

    const feePctForTrade = (fromA: Asset, toA: Asset): number => {
      if (fromA === 'ESOM') return feePctForAsset(toA);
      if (toA === 'ESOM') return feePctForAsset(fromA);
      return Math.max(feePctForAsset(fromA), feePctForAsset(toA));
    };

    const applyFee = (gross: number, pct: number) => {
      const fee = gross * (pct / 100);
      const net = Math.max(gross - fee, 0);
      return { net, fee };
    };

    // ESOM -> CRYPTO
    if (from === 'ESOM' && (to === 'BTC' || to === 'ETH' || to === 'USDT_TRC20')) {
      const antiFraudDecision = await this.antiFraud.checkTransactionDetailed({
        kind: TransactionKind.CONVERSION,
        amount_in: amountFrom,
        asset_in: 'ESOM',
        asset_out: to,
        sender_customer_id: customer_id,
        comment: `Convert ESOM->${to}`,
      });
      this.logger.verbose(
        `[convert ESOM->${to}] antifraud allowed=${antiFraudDecision.allowed}`
        + (antiFraudDecision.reason ? ` reason=${antiFraudDecision.reason}` : ''),
      );
      if (!antiFraudDecision.allowed) {
        throw new BadRequestException(this.antiFraudRejectMessage(`ESOM->${to}`, antiFraudDecision));
      }

      const feePct = feePctForTrade(from, to);
      const usdtAmount = amountFrom / esomPerUsd;
      let grossOut = 0;
      let priceUsd = '1';
      let notionalUsdt = usdtAmount.toString();
      if (to === 'USDT_TRC20') {
        grossOut = usdtAmount;
      } else {
        const buy = await this.exchangeService.marketBuy(to, usdtAmount.toString());
        grossOut = Number(buy.amount_asset);
        priceUsd = buy.price_usd;
        notionalUsdt = buy.notional_usdt;
        this.logger.verbose(`[convert ESOM->${to}] marketBuy price_usd=${buy.price_usd} amount_asset=${buy.amount_asset} notional_usdt=${buy.notional_usdt}`);
      }
      const { net, fee } = applyFee(grossOut, feePct);

      await this.ethereumService.transferToFiat(amountFrom, user.private_key);
      await addBalance(to, net);
      this.logger.verbose(`[convert ESOM->${to}] feePct=${feePct}% fee=${fee} net_out=${net}`);

      await this.prisma.transaction.create({
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
      // Refresh only ESOM balance to avoid overwriting exchange-held balances
      await this.balanceFetchService.refreshAllBalancesForUser(customer_id, ['ESOM' as Asset]);
      return new StatusOKDto();
    }

    // CRYPTO -> ESOM
    if ((from === 'BTC' || from === 'ETH' || from === 'USDT_TRC20') && to === 'ESOM') {
      const antiFraudDecision = await this.antiFraud.checkTransactionDetailed({
        kind: TransactionKind.CONVERSION,
        amount_in: amountFrom,
        asset_in: from,
        asset_out: 'ESOM',
        sender_customer_id: customer_id,
        comment: `Convert ${from}->ESOM`,
      });
      this.logger.verbose(
        `[convert ${from}->ESOM] antifraud allowed=${antiFraudDecision.allowed}`
        + (antiFraudDecision.reason ? ` reason=${antiFraudDecision.reason}` : ''),
      );
      if (!antiFraudDecision.allowed) {
        throw new BadRequestException(this.antiFraudRejectMessage(`${from}->ESOM`, antiFraudDecision));
      }

      const feePct = feePctForTrade(from, to);
      let notionalUsdt = 0;
      if (from === 'USDT_TRC20') {
        notionalUsdt = amountFrom;
      } else {
        const sell = await this.exchangeService.marketSell(from, amountFrom.toString());
        notionalUsdt = Number(sell.notional_usdt);
        this.logger.verbose(`[convert ${from}->ESOM] marketSell notional_usdt=${notionalUsdt}`);
      }
      const grossEsom = notionalUsdt * esomPerUsd;
      const { net: netEsom, fee: feeEsom } = applyFee(grossEsom, feePct);

      await this.ethereumService.transferFromFiat(user.address, netEsom);
      await addBalance(from, -amountFrom);

      await this.prisma.transaction.create({
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
      // Refresh only ESOM balance after mint
      await this.balanceFetchService.refreshAllBalancesForUser(customer_id, ['ESOM' as Asset]);
      return new StatusOKDto();
    }

    // CRYPTO -> CRYPTO
    if ((from === 'BTC' || from === 'ETH' || from === 'USDT_TRC20') && (to === 'BTC' || to === 'ETH' || to === 'USDT_TRC20')) {
      const antiFraudDecision = await this.antiFraud.checkTransactionDetailed({
        kind: TransactionKind.CONVERSION,
        amount_in: amountFrom,
        asset_in: from,
        asset_out: to,
        sender_customer_id: customer_id,
        comment: `Convert ${from}->${to}`,
      });
      this.logger.verbose(
        `[convert ${from}->${to}] antifraud allowed=${antiFraudDecision.allowed}`
        + (antiFraudDecision.reason ? ` reason=${antiFraudDecision.reason}` : ''),
      );
      if (!antiFraudDecision.allowed) {
        throw new BadRequestException(this.antiFraudRejectMessage(`${from}->${to}`, antiFraudDecision));
      }

      const feePct = feePctForTrade(from, to);

      let usdtIntermediate = 0;
      if (from === 'USDT_TRC20') {
        usdtIntermediate = amountFrom;
      } else {
        const sell = await this.exchangeService.marketSell(from, amountFrom.toString());
        usdtIntermediate = Number(sell.notional_usdt);
      }

      let buy = await this.exchangeService.marketBuy(to, usdtIntermediate.toString());
      this.logger.verbose(`[convert ${from}->${to}] marketBuy price_usd=${buy.price_usd} amount_asset=${buy.amount_asset} notional_usdt=${buy.notional_usdt}`);

      const grossTo = Number(buy.amount_asset);
      const { net: netTo, fee: feeTo } = applyFee(grossTo, feePct);

      await addBalance(from, -amountFrom);
      await addBalance(to, netTo);

      await this.prisma.transaction.create({
        data: {
          kind: TransactionKind.CONVERSION,
          status: TransactionStatus.SUCCESS,
          amount_in: amountFrom.toString(),
          asset_in: from,
          amount_out: netTo.toString(),
          asset_out: to,
          price_usd: buy.price_usd,
          notional_usd: buy.notional_usdt,
          fee_amount: feeTo.toString(),
          sender_customer_id: customer_id,
          comment: `Convert ${from}->${to}`,
        },
      });
      return new StatusOKDto();
    }

    if (from === 'SOM' && to === 'ESOM') {
      return this.fiatToCrypto({ amount: amountFrom }, customer_id);
    }
    if (from === 'ESOM' && to === 'SOM') {
      return this.cryptoToFiat({ amount: amountFrom }, customer_id);
    }

    return new StatusOKDto();
  }

  async withdrawCrypto(asset: Asset, address: string, amount: number, customer_id: number): Promise<StatusOKDto> {
    this.logger.verbose(`[withdrawCrypto] start customer=${customer_id} asset=${asset} amount=${amount} address=${address}`);
    const s = await this.settingsService.get();
    const min = asset === 'BTC' ? Number(s.min_withdraw_btc)
      : asset === 'ETH' ? Number(s.min_withdraw_eth)
        : Number(s.min_withdraw_usdt_trc20);

    const me = await this.prisma.customer.findUnique({ where: { customer_id } });
    if (me && me.status === 'BLOCKED') {
      throw new BadRequestException('User is blocked');
    }

    if (amount < min) {
      throw new BadRequestException('Amount below minimum withdrawal');
    }

    this.logger.verbose(`[withdrawCrypto] min=${min}`);

    const feeFixed = asset === 'BTC' ? Number(s.btc_withdraw_fee_fixed)
      : asset === 'ETH' ? Number(s.eth_withdraw_fee_fixed)
        : Number(s.usdt_withdraw_fee_fixed);

    const total = amount + feeFixed;
    this.logger.verbose(`[withdrawCrypto] fee_fixed=${feeFixed} total_debit=${total}`);

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

    await this.prisma.$transaction(async (tx) => {
      const bal = await tx.userAssetBalance.findUnique({ where: { customer_id_asset: { customer_id, asset } } });
      const current = Number(bal?.balance ?? 0);
      if (current < total) throw new BadRequestException('Insufficient balance including fee');
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
      this.logger.verbose(`[withdrawCrypto] withdrawRequest created id=${w.id}`);
      const { txid } = await this.exchangeService.withdraw(asset, address, amount.toString());
      this.logger.verbose(`[withdrawCrypto] exchange.withdraw submitted txid=${txid}`);
      await tx.withdrawRequest.update({ where: { id: w.id }, data: { status: 'SUBMITTED', txid } });
      await tx.transaction.create({
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
    });

    return new StatusOKDto();
  }

  async fiatToCrypto(
    paymentDto: PaymentDto,
    customer_id: number,
  ): Promise<StatusOKDto> {
    const { amount } = paymentDto;
    const requestedAt = new Date();
    const transactionRef = this.buildAbsTransactionRef();

    const customer = await this.prisma.customer.findUnique({
      where: { customer_id: customer_id },
    });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

    const s = await this.settingsService.get();
    const { fee: conversionFee, net: netAmount, pct: feePct, minFee } = this.calcSomEsomConversionFee(amount, s);
    if (netAmount <= 0) {
      throw new BadRequestException('Amount is too low after conversion commission');
    }
    this.logger.verbose(`[fiatToCrypto] conversion_fee pct=${feePct}% min=${minFee} fee=${conversionFee} net=${netAmount}`);

    const allowed = await this.antiFraud.shouldAllowTransaction({
      kind: TransactionKind.BANK_TO_WALLET,
      amount_in: amount,
      asset_in: 'SOM',
      asset_out: 'ESOM',
      sender_customer_id: customer.customer_id,
      receiver_customer_id: customer.customer_id,
      receiver_wallet_address: customer.address,
      comment: 'Fiat->Crypto',
    });
    if (!allowed) throw new BadRequestException('Rejected by anti-fraud');

    const paymentPurpose = this.buildCreditPurpose(
      customer.customer_id,
      transactionRef,
      this.buildClientFio(customer),
      requestedAt,
    );
    const bricsTransaction = await this.bricsService.createTransactionFiatToCrypto(
      amount,
      customer.customer_id.toString(),
      paymentPurpose,
    );
    if (!bricsTransaction) {
      throw new BadRequestException('Brics transaction failed');
    }

    const ethTransaction = await this.ethereumService.transferFromFiat(customer.address, netAmount);
    await this.balanceFetchService.refreshAllBalancesForUser(customer.customer_id, ['ESOM' as Asset]);
    if (!ethTransaction?.success) {
      throw new BadRequestException('Ethereum transaction failed');
    }

    await this.prisma.transaction.create({
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
        comment: `Fiat->Crypto (${transactionRef})`,
      },
    });

    // decrement SOM cached balance by amount
    await this.prisma.userAssetBalance.upsert({
      where: { customer_id_asset: { customer_id: customer.customer_id, asset: 'SOM' as Asset } },
      create: { customer_id: customer.customer_id, asset: 'SOM' as Asset, balance: (-amount).toString() },
      update: { balance: { decrement: amount.toString() } },
    });

    return new StatusOKDto();
  }

  async cryptoToFiat(
    paymentDto: PaymentDto,
    customer_id: number,
  ): Promise<StatusOKDto> {
    const { amount } = paymentDto;
    const requestedAt = new Date();
    const transactionRef = this.buildAbsTransactionRef();

    const customer = await this.prisma.customer.findUnique({
      where: { customer_id: customer_id },
    });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

    const s = await this.settingsService.get();
    const { fee: conversionFee, net: netAmount, pct: feePct, minFee } = this.calcSomEsomConversionFee(amount, s);
    if (netAmount <= 0) {
      throw new BadRequestException('Amount is too low after conversion commission');
    }
    this.logger.verbose(`[cryptoToFiat] conversion_fee pct=${feePct}% min=${minFee} fee=${conversionFee} net=${netAmount}`);

    const allowed = await this.antiFraud.shouldAllowTransaction({
      kind: TransactionKind.WALLET_TO_BANK,
      amount_in: amount,
      asset_in: 'ESOM',
      asset_out: 'SOM',
      sender_customer_id: customer.customer_id,
      comment: 'Crypto->Fiat',
    });
    if (!allowed) throw new BadRequestException('Rejected by anti-fraud');

    const ethTransaction = await this.ethereumService.transferToFiat(amount, customer.private_key);
    await this.balanceFetchService.refreshAllBalancesForUser(customer.customer_id, ['ESOM' as Asset]);
    if (!ethTransaction?.success) {
      throw new BadRequestException('Ethereum transaction failed');
    }

    const adminBricsService = await this.moduleRef.create(BricsService);

    const adminAuth = await adminBricsService.auth(
      this.configService.get<string>('ADMIN_LOGIN')!,
      this.configService.get<string>('ADMIN_PASSWORD')!,
    );
    if (!adminAuth) {
      throw new BadRequestException('Admin authentication failed');
    }

    const ctAccountNo = this.configService.get<string>('CT_ACCOUNT_NO') || 'N/A';
    const paymentPurpose = this.buildDebitPurpose(
      ctAccountNo,
      transactionRef,
      this.buildClientFio(customer),
      requestedAt,
    );
    const bricsTransaction = await adminBricsService.createTransactionCryptoToFiat(
      netAmount,
      customer.customer_id.toString(),
      paymentPurpose,
    );
    if (!bricsTransaction) {
      throw new BadRequestException('Brics transaction failed');
    }

    await this.prisma.transaction.create({
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
        comment: `Crypto->Fiat (${transactionRef})`,
      },
    });

    // increment SOM cached balance by net amount after commission
    await this.prisma.userAssetBalance.upsert({
      where: { customer_id_asset: { customer_id: customer.customer_id, asset: 'SOM' as Asset } },
      create: { customer_id: customer.customer_id, asset: 'SOM' as Asset, balance: netAmount.toString() },
      update: { balance: { increment: netAmount.toString() } },
    });

    return new StatusOKDto();
  }

  async transfer(
    transferDto: TransferDto,
    customer_id: number,
  ): Promise<StatusOKDto> {
    const me = await this.prisma.customer.findUnique({ where: { customer_id } });
    if (me && me.status === 'BLOCKED') {
      throw new BadRequestException('User is blocked');
    }

    if (transferDto.currency == Currency.ESOM) {
      return this.transferESom(transferDto, customer_id);
    } else if (transferDto.currency == Currency.SOM) {
      return this.transferSom(transferDto, customer_id);
    } else if (
      transferDto.currency == Currency.BTC ||
      transferDto.currency == Currency.ETH ||
      transferDto.currency == Currency.USDT_TRC20
    ) {
      const asset = transferDto.currency as unknown as Asset;
      if (transferDto.address) {
        return this.withdrawCrypto(asset, transferDto.address, transferDto.amount, customer_id);
      }
      if (transferDto.phone_number) {
        return this.transferCryptoByPhone(asset, transferDto.amount, transferDto.phone_number, customer_id);
      }
      throw new Error('Either address or phone_number is required for crypto transfer');
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

    // антифрод-предчек: отменяем операцию без побочных эффектов, если сработал
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

    await this.prisma.transaction.create({
      data: {
        kind: TransactionKind.WALLET_TO_WALLET,
        status: TransactionStatus.SUCCESS,
        amount_in: transferDto.amount.toString(),
        asset_in: 'ESOM',
        amount_out: transferDto.amount.toString(),
        asset_out: 'ESOM',
        tx_hash: ethTransaction.txHash,
        sender_customer_id: customer.customer_id,
        receiver_customer_id: recipient.customer_id,
        comment: 'ESOM transfer',
      },
    });

    await this.balanceFetchService.refreshAllBalancesForUser(customer.customer_id, ['ESOM' as Asset]);
    if (recipient?.customer_id && recipient.customer_id !== customer.customer_id) {
      await this.balanceFetchService.refreshAllBalancesForUser(recipient.customer_id, ['ESOM' as Asset]);
    }
    return new StatusOKDto();
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

    // предчек антифрода
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
    await this.prisma.transaction.create({
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

    // Начисляем получателю кеш-баланс СОМ и списываем у отправителя
    await this.prisma.userAssetBalance.upsert({
      where: { customer_id_asset: { customer_id: customer.customer_id, asset: 'SOM' as Asset } },
      create: { customer_id: customer.customer_id, asset: 'SOM' as Asset, balance: (-transferDto.amount).toString() },
      update: { balance: { decrement: transferDto.amount.toString() } },
    });
    await this.prisma.userAssetBalance.upsert({
      where: { customer_id_asset: { customer_id: bricsRecipient.CustomerID, asset: 'SOM' as Asset } },
      create: { customer_id: bricsRecipient.CustomerID, asset: 'SOM' as Asset, balance: transferDto.amount.toString() },
      update: { balance: { increment: transferDto.amount.toString() } },
    });

    return new StatusOKDto();
  }


  private async transferCryptoByPhone(asset: Asset, amount: number, phone: string, sender_id: number): Promise<StatusOKDto> {
    this.logger.verbose(`[transferCryptoByPhone] asset=${asset} amount=${amount} phone=${phone} sender=${sender_id}`);
    const sender = await this.prisma.customer.findUnique({ where: { customer_id: sender_id } });
    if (!sender) throw new Error('Sender not found');

    const bricsRecipient = await this.bricsService.findAccount(phone);
    if (!bricsRecipient) throw new Error('Recipient not found');
    const receiver_id = bricsRecipient.CustomerID;

    // Антифрод-предчек (без ончейн операций)
    const allowed = await this.antiFraud.shouldAllowTransaction({
      kind: TransactionKind.WALLET_TO_WALLET,
      amount_in: amount,
      asset_in: asset,
      asset_out: asset,
      sender_customer_id: sender_id,
      receiver_customer_id: receiver_id,
      comment: `Crypto transfer by phone (${asset})`,
    });
    if (!allowed) throw new BadRequestException('Rejected by anti-fraud');

    // Обеспечиваем наличие записи получателя в нашей БД (кошелек может быть не нужен, но Customer обязателен)
    let recipient = await this.prisma.customer.findUnique({ where: { customer_id: receiver_id } });
    if (!recipient) {
      // создаем техн. запись с пустым кошельком? У нас address обязательный. Сгенерируем, как в ESOM переводе.
      const recipientAddress = this.ethereumService.generateAddress();
      recipient = await this.prisma.customer.create({
        data: {
          customer_id: receiver_id,
          address: recipientAddress.address,
          private_key: recipientAddress.privateKey,
        },
      });
    }

    // Атомарно списываем у отправителя и начисляем получателю в таблице кеш-балансов
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
      if (current < amount) throw new Error('Insufficient balance');
      await tx.userAssetBalance.update({
        where: { customer_id_asset: { customer_id: sender_id, asset } },
        data: { balance: { decrement: amount.toString() } },
      });
      await tx.userAssetBalance.upsert({
        where: { customer_id_asset: { customer_id: receiver_id, asset } },
        create: { customer_id: receiver_id, asset, balance: amount.toString() },
        update: { balance: { increment: amount.toString() } },
      });
      await tx.transaction.create({
        data: {
          kind: TransactionKind.WALLET_TO_WALLET,
          status: TransactionStatus.SUCCESS,
          amount_in: amount.toString(),
          asset_in: asset,
          amount_out: amount.toString(),
          asset_out: asset,
          sender_customer_id: sender_id,
          receiver_customer_id: receiver_id,
          comment: `Crypto transfer by phone (${asset})`,
        },
      });
    });

    return new StatusOKDto();
  }
}
