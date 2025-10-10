import { BadRequestException, Injectable, Logger } from '@nestjs/common';
/* eslint-disable max-classes-per-file */
import { ModuleRef } from '@nestjs/core';
import { Asset, PrismaClient, Transaction, TransactionKind, TransactionStatus } from '@prisma/client';
import { AntiFraudService } from '../antifraud/antifraud.service';
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

    const mapType = (t: Transaction): TransactionType => {
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
    };

    // По умолчанию показываем входящую сторону (asset_in/amount_in)
    const rows: TransactionDto[] = [];
    const filterSet = body.currency?.length ? new Set(body.currency) : null;

    for (const t of items) {
      const inCurrency = (t.asset_in || 'SOM') as unknown as Currency;
      const baseRow: TransactionDto = {
        currency: inCurrency,
        amount: Number(t.amount_in),
        type: mapType(t),
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
            currency: outCurrency,
            amount: Number(t.amount_out),
            type: mapType(t),
            successful: true,
            created_at: t.createdAt.getTime(),
          });
        }
      }
    }
    return rows;
  }

  async convert(dto: ConvertDto, customer_id: number): Promise<StatusOKDto> {
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
      const allowed = await this.antiFraud.shouldAllowTransaction({
        kind: TransactionKind.CONVERSION,
        amount_in: amountFrom,
        asset_in: 'ESOM',
        asset_out: to,
        sender_customer_id: customer_id,
        comment: `Convert ESOM->${to}`,
      });
      this.logger.verbose(`[convert ESOM->${to}] antifraud allowed=${allowed}`);
      if (!allowed) throw new BadRequestException('Rejected by anti-fraud');

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
      const allowed = await this.antiFraud.shouldAllowTransaction({
        kind: TransactionKind.CONVERSION,
        amount_in: amountFrom,
        asset_in: from,
        asset_out: 'ESOM',
        sender_customer_id: customer_id,
        comment: `Convert ${from}->ESOM`,
      });
      this.logger.verbose(`[convert ${from}->ESOM] antifraud allowed=${allowed}`);
      if (!allowed) throw new BadRequestException('Rejected by anti-fraud');

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
      const allowed = await this.antiFraud.shouldAllowTransaction({
        kind: TransactionKind.CONVERSION,
        amount_in: amountFrom,
        asset_in: from,
        asset_out: to,
        sender_customer_id: customer_id,
        comment: `Convert ${from}->${to}`,
      });
      this.logger.verbose(`[convert ${from}->${to}] antifraud allowed=${allowed}`);
      if (!allowed) throw new BadRequestException('Rejected by anti-fraud');

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

    const customer = await this.prisma.customer.findUnique({
      where: { customer_id: customer_id },
    });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

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

    const bricsTransaction = await this.bricsService.createTransactionFiatToCrypto(
      amount,
      customer.customer_id.toString(),
    );
    if (!bricsTransaction) {
      throw new BadRequestException('Brics transaction failed');
    }

    const ethTransaction = await this.ethereumService.transferFromFiat(customer.address, amount);
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
        amount_out: amount.toString(),
        asset_out: 'ESOM',
        tx_hash: ethTransaction.txHash,
        bank_op_id: bricsTransaction,
        sender_customer_id: customer.customer_id,
        receiver_wallet_address: customer.address,
        comment: 'Fiat->Crypto',
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

    const customer = await this.prisma.customer.findUnique({
      where: { customer_id: customer_id },
    });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

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

    const bricsTransaction = await adminBricsService.createTransactionCryptoToFiat(
      amount * (1 - Number(this.configService.get('PLATFORM_FEE'))),
      customer.customer_id.toString(),
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
        amount_out: amount.toString(),
        asset_out: 'SOM',
        tx_hash: ethTransaction.txHash,
        bank_op_id: bricsTransaction,
        sender_customer_id: customer.customer_id,
        comment: 'Crypto->Fiat',
      },
    });

    // increment SOM cached balance by amount (minus platform fee already handled by bank operation)
    await this.prisma.userAssetBalance.upsert({
      where: { customer_id_asset: { customer_id: customer.customer_id, asset: 'SOM' as Asset } },
      create: { customer_id: customer.customer_id, asset: 'SOM' as Asset, balance: amount.toString() },
      update: { balance: { increment: amount.toString() } },
    });

    return new StatusOKDto();
  }

  async transfer(
    transferDto: TransferDto,
    customer_id: number,
  ): Promise<StatusOKDto> {
    if (transferDto.currency == Currency.ESOM) {
      return this.transferESom(transferDto, customer_id);
    } else if (transferDto.currency == Currency.SOM) {
      return this.transferSom(transferDto, customer_id);
    } else if (
      transferDto.currency == Currency.BTC ||
      transferDto.currency == Currency.ETH ||
      transferDto.currency == Currency.USDT_TRC20
    ) {
      if (!transferDto.address) {
        throw new BadRequestException('Address is required for crypto withdrawal');
      }
      const asset = transferDto.currency as unknown as Asset;
      return this.withdrawCrypto(asset, transferDto.address, transferDto.amount, customer_id);
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

    const bricsTransaction = await this.bricsService.createTransferFiatToFiat(
      transferDto.amount,
      customer.customer_id.toString(),
      bricsRecipient.CustomerID.toString(),
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
        comment: 'SOM transfer',
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
}
