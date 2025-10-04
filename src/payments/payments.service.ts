import { Injectable } from '@nestjs/common';
/* eslint-disable max-classes-per-file */

import { ModuleRef } from '@nestjs/core';
import { Asset, PrismaClient } from '@prisma/client';
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
  ) {}

  async getHistory(body: GetTransactions, customer_id: number): Promise<TransactionDto[]> {
    const me = await this.prisma.customer.findUnique({ where: { customer_id } });
    const where: any = {
      OR: [
        { sender_customer_id: customer_id },
        { receiver_customer_id: customer_id },
        me?.address ? { sender_wallet_address: me.address } : undefined,
        me?.address ? { receiver_wallet_address: me.address } : undefined,
      ].filter(Boolean),
    };

    if (body.currency?.length) where.asset = { in: body.currency as any };
    if (body.from_time || body.to_time) {
      where.createdAt = {} as any;
      if (body.from_time) (where.createdAt as any).gte = new Date(body.from_time);
      if (body.to_time) (where.createdAt as any).lte = new Date(body.to_time);
    }

    const items = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: body.skip ?? 0,
      take: body.take ?? 50,
    });

    const mapType = (t: any): TransactionType => {
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
        default:
          return TransactionType.TRANSFER;
      }
    };

    return items.map(t => ({
      currency: (t.asset || 'SOM') as any,
      amount: Number(t.som_amount),
      type: mapType(t),
      successful: t.status === 'SUCCESS',
      created_at: t.createdAt.getTime(),
    }));
  }


    private readonly balanceFetchService: BalanceFetchService,
  ) {}

  async convert(dto: ConvertDto, customer_id: number): Promise<StatusOKDto> {
    const user = await this.prisma.customer.findUniqueOrThrow({ where: { customer_id } });
    const s = await this.settingsService.get();
    const from = dto.asset_from as unknown as Asset;
    const to = dto.asset_to as unknown as Asset;
    const amountFrom = dto.amount_from;
    const esomPerUsd = Number(s.esom_per_usd);

    const addBalance = async (asset: Asset, delta: number) => {
      await this.prisma.userAssetBalance.upsert({
        where: { customer_id_asset: { customer_id, asset } },
        create: { customer_id, asset, balance: delta.toString() },
        update: { balance: { increment: delta.toString() } },
      });
    };

    if (from === 'ESOM' && (to === 'BTC' || to === 'ETH' || to === 'USDT_TRC20')) {
      const usdtAmount = amountFrom / esomPerUsd;
      const order = to === 'USDT_TRC20'
        ? { asset: to, amount_asset: usdtAmount.toString(), price_usd: '1', notional_usdt: usdtAmount.toString() }
        : await this.exchangeService.marketBuy(to, usdtAmount.toString());
      await this.ethereumService.transferToFiat(amountFrom, user.private_key);
      await addBalance(to, Number(order.amount_asset));
      await this.prisma.userTrade.create({
        data: {
          customer_id,
          asset_from: 'ESOM',
          asset_to: to,
          amount_from: amountFrom.toString(),
          amount_to: order.amount_asset,
          price_usd: order.price_usd,
          notional_usdt: order.notional_usdt,
          fee_esom: '0',
        },
      });
      await this.balanceFetchService.refreshAllBalancesForUser(customer_id);
      return new StatusOKDto();
    }

    if ((from === 'BTC' || from === 'ETH' || from === 'USDT_TRC20') && to === 'ESOM') {
      let notionalUsdt = 0;
      if (from === 'USDT_TRC20') {
        notionalUsdt = amountFrom;
      } else {
        const order = await this.exchangeService.marketSell(from, amountFrom.toString());
        notionalUsdt = Number(order.notional_usdt);
      }
      const esomAmount = notionalUsdt * esomPerUsd;
      await this.ethereumService.transferFromFiat(user.address, esomAmount);
      await addBalance(from, -amountFrom);
      await this.prisma.userTrade.create({
        data: {
          customer_id,
          asset_from: from,
          asset_to: 'ESOM',
          amount_from: amountFrom.toString(),
          amount_to: esomAmount.toString(),
          price_usd: '1',
          notional_usdt: notionalUsdt.toString(),
          fee_esom: '0',
        },
      });
      await this.balanceFetchService.refreshAllBalancesForUser(customer_id);
      return new StatusOKDto();
    }

    if ((from === 'BTC' || from === 'ETH' || from === 'USDT_TRC20') && (to === 'BTC' || to === 'ETH' || to === 'USDT_TRC20')) {
      let usdtIntermediate = 0;
      if (from === 'USDT_TRC20') {
        usdtIntermediate = amountFrom;
      } else {
        const sell = await this.exchangeService.marketSell(from, amountFrom.toString());
        usdtIntermediate = Number(sell.notional_usdt);
      }
      if (to === 'USDT_TRC20') {
        await addBalance(from, -amountFrom);
        await addBalance('USDT_TRC20', usdtIntermediate);
        await this.prisma.userTrade.create({ data: { customer_id, asset_from: from, asset_to: 'USDT_TRC20', amount_from: amountFrom.toString(), amount_to: usdtIntermediate.toString(), price_usd: '1', notional_usdt: usdtIntermediate.toString(), fee_esom: '0' } });
        await this.balanceFetchService.refreshAllBalancesForUser(customer_id);
        return new StatusOKDto();
      }
      const buy = await this.exchangeService.marketBuy(to, usdtIntermediate.toString());
      await addBalance(from, -amountFrom);
      await addBalance(to, Number(buy.amount_asset));
      await this.prisma.userTrade.create({ data: { customer_id, asset_from: from, asset_to: to, amount_from: amountFrom.toString(), amount_to: buy.amount_asset, price_usd: buy.price_usd, notional_usdt: buy.notional_usdt, fee_esom: '0' } });
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
    const s = await this.settingsService.get();
    const min = asset === 'BTC' ? Number(s.min_withdraw_btc)
      : asset === 'ETH' ? Number(s.min_withdraw_eth)
      : Number(s.min_withdraw_usdt_trc20);
    if (amount < min) {
      throw new Error('Amount below minimum withdrawal');
    }

    const feeFixed = asset === 'BTC' ? Number(s.btc_withdraw_fee_fixed)
      : asset === 'ETH' ? Number(s.eth_withdraw_fee_fixed)
      : Number(s.usdt_withdraw_fee_fixed);

    const total = amount + feeFixed;

    await this.prisma.$transaction(async (tx) => {
      const bal = await tx.userAssetBalance.findUnique({ where: { customer_id_asset: { customer_id, asset } } });
      const current = Number(bal?.balance ?? 0);
      if (current < total) throw new Error('Insufficient balance including fee');
      await tx.userAssetBalance.update({ where: { customer_id_asset: { customer_id, asset } }, data: { balance: { decrement: total.toString() } } });
      const w = await tx.withdrawRequest.create({ data: { customer_id, asset, address, amount: amount.toString(), fee: feeFixed.toString(), status: 'PENDING' } });
      const { txid } = await this.exchangeService.withdraw(asset, address, amount.toString());
      await tx.withdrawRequest.update({ where: { id: w.id }, data: { status: 'SUBMITTED', txid } });
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
      throw new Error('Customer not found');
    }

    const bricsTransaction = await this.bricsService.createTransactionFiatToCrypto(
      amount,
      customer.customer_id.toString(),
    );
    if (!bricsTransaction) {
      throw new Error('Brics transaction failed');
    }

    const ethTransaction = await this.ethereumService.transferFromFiat(customer.address, amount);
    await this.balanceFetchService.refreshAllBalancesForUser(customer.customer_id);
    if (!ethTransaction?.success) {
      throw new Error('Ethereum transaction failed');
    }

    // record transaction BANK_TO_WALLET
    await this.prisma.transaction.create({ data: {
      kind: 'BANK_TO_WALLET' as any,
      status: 'SUCCESS' as any,
      som_amount: amount.toString(),
      asset: 'ESOM',
      tx_hash: ethTransaction.txHash,
      bank_op_id: bricsTransaction,
      sender_customer_id: customer.customer_id,
      receiver_wallet_address: customer.address,
      comment: 'Fiat->Crypto',
    }});

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
      throw new Error('Customer not found');
    }

    const ethTransaction = await this.ethereumService.transferToFiat(amount, customer.private_key);
    await this.balanceFetchService.refreshAllBalancesForUser(customer.customer_id);
    if (!ethTransaction?.success) {
      throw new Error('Ethereum transaction failed');
    }

    const adminBricsService = await this.moduleRef.create(BricsService);

    const adminAuth = await adminBricsService.auth(
      this.configService.get<string>('ADMIN_LOGIN')!,
      this.configService.get<string>('ADMIN_PASSWORD')!,
    );
    if (!adminAuth) {
      throw new Error('Admin authentication failed');
    }

    const bricsTransaction = await adminBricsService.createTransactionCryptoToFiat(
      amount * (1 - Number(this.configService.get('PLATFORM_FEE'))),
      customer.customer_id.toString(),
    );
    if (!bricsTransaction) {
      throw new Error('Brics transaction failed');
    }

    // record transaction WALLET_TO_BANK (after we know bank_op_id)
    await this.prisma.transaction.create({ data: {
      kind: 'WALLET_TO_BANK' as any,
      status: 'SUCCESS' as any,
      som_amount: amount.toString(),
      asset: 'ESOM',
      tx_hash: ethTransaction.txHash,
      bank_op_id: bricsTransaction,
      sender_customer_id: customer.customer_id,
      comment: 'Crypto->Fiat',
    }});

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
        throw new Error('Address is required for crypto withdrawal');
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
      throw new Error('Customer not found');
    }

    const bricsRecipient = await this.bricsService.findAccount(
      transferDto.phone_number!,
    );
    if (!bricsRecipient) {
      throw new Error('Recipient not found');
    }

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
      throw new Error('Ethereum transaction failed');
    }

    // record transaction WALLET_TO_WALLET
    await this.prisma.transaction.create({ data: {
      kind: 'WALLET_TO_WALLET' as any,
      status: 'SUCCESS' as any,
      som_amount: transferDto.amount.toString(),
      asset: 'ESOM',
      tx_hash: ethTransaction.txHash,
      sender_customer_id: customer.customer_id,
      receiver_customer_id: recipient.customer_id,
      comment: 'ESOM transfer',
    }});

    await this.balanceFetchService.refreshAllBalancesForUser(customer.customer_id);
    if (recipient?.customer_id && recipient.customer_id !== customer.customer_id) {
      await this.balanceFetchService.refreshAllBalancesForUser(recipient.customer_id);
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
      throw new Error('Customer not found');
    }

    const bricsRecipient = await this.bricsService.findAccount(
      transferDto.phone_number!,
    );
    if (!bricsRecipient) {
      throw new Error('Recipient not found');
    }

    const bricsTransaction = await this.bricsService.createTransferFiatToFiat(
      transferDto.amount,
      customer.customer_id.toString(),
      bricsRecipient.CustomerID.toString(),
    );
    if (!bricsTransaction) {
      throw new Error('Brics transaction failed');
    }

    // record transaction BANK_TO_BANK
    await this.prisma.transaction.create({ data: {
      kind: 'BANK_TO_BANK' as any,
      status: 'SUCCESS' as any,
      som_amount: transferDto.amount.toString(),
      asset: 'SOM',
      bank_op_id: bricsTransaction,
      sender_customer_id: customer.customer_id,
      receiver_customer_id: bricsRecipient.CustomerID,
      comment: 'SOM transfer',
    }});

    // adjust SOM cache balances: decrement sender, increment receiver
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
