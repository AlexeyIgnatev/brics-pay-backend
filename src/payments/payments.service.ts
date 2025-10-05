import { Injectable } from '@nestjs/common';
/* eslint-disable max-classes-per-file */

import { ModuleRef } from '@nestjs/core';
import { Asset, PrismaClient } from '@prisma/client';
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

    if (body.currency?.length) where.asset_out = { in: body.currency as any };
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
      switch (t.kind as string) {
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

    return items.map(t => ({
      currency: (t.asset_out || 'SOM') as any,
      amount: Number(t.amount_out),
      type: mapType(t),
      successful: t.status === 'SUCCESS',
      created_at: t.createdAt.getTime(),
    }));
  }

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
      const tx1 = await this.prisma.transaction.create({ data: ({
        kind: 'CONVERSION' as any,
        status: 'PENDING' as any,
        amount_in: amountFrom.toString(),
        asset_in: 'ESOM',
        amount_out: order.amount_asset,
        asset_out: to,
        price_usd: order.price_usd,
        notional_usd: order.notional_usdt,
        sender_customer_id: customer_id,
        comment: `Convert ESOM->${to} (pending antifraud)`,
      } as any)});
      const trig1 = await this.antiFraud.checkAndOpenCaseIfTriggered(tx1.id, { kind: 'CONVERSION' as any, amount: amountFrom, asset: 'ESOM', sender_customer_id: customer_id });
      if (trig1) throw new Error('Transaction has been held by anti-fraud');
      await this.prisma.transaction.update({ where: { id: tx1.id }, data: { status: 'SUCCESS' as any, comment: `Convert ESOM->${to}` } });
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
      const tx2 = await this.prisma.transaction.create({ data: ({
        kind: 'CONVERSION' as any,
        status: 'PENDING' as any,
        amount_in: amountFrom.toString(),
        asset_in: from,
        amount_out: esomAmount.toString(),
        asset_out: 'ESOM',
        price_usd: '1',
        notional_usd: notionalUsdt.toString(),
        sender_customer_id: customer_id,
        comment: `Convert ${from}->ESOM (pending antifraud)`,
      } as any)});
      const trig2 = await this.antiFraud.checkAndOpenCaseIfTriggered(tx2.id, { kind: 'CONVERSION' as any, amount: esomAmount, asset: 'ESOM', sender_customer_id: customer_id });
      if (trig2) throw new Error('Transaction has been held by anti-fraud');
      await this.prisma.transaction.update({ where: { id: tx2.id }, data: { status: 'SUCCESS' as any, comment: `Convert ${from}->ESOM` } });
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
        const tx3 = await this.prisma.transaction.create({ data: ({
          kind: 'CONVERSION' as any,
          status: 'PENDING' as any,
          amount_in: amountFrom.toString(),
          asset_in: from,
          amount_out: usdtIntermediate.toString(),
          asset_out: 'USDT_TRC20',
          price_usd: '1',
          notional_usd: usdtIntermediate.toString(),
          sender_customer_id: customer_id,
          comment: `Convert ${from}->USDT_TRC20 (pending antifraud)`,
        } as any)});
        const trig3 = await this.antiFraud.checkAndOpenCaseIfTriggered(tx3.id, { kind: 'CONVERSION' as any, amount: usdtIntermediate, asset: 'USDT_TRC20', sender_customer_id: customer_id });
        if (trig3) throw new Error('Transaction has been held by anti-fraud');
        await this.prisma.transaction.update({ where: { id: tx3.id }, data: { status: 'SUCCESS' as any, comment: `Convert ${from}->USDT_TRC20` } });
        await this.balanceFetchService.refreshAllBalancesForUser(customer_id);
        return new StatusOKDto();
      }
      const buy = await this.exchangeService.marketBuy(to, usdtIntermediate.toString());
      await addBalance(from, -amountFrom);
      await addBalance(to, Number(buy.amount_asset));
      const tx4 = await this.prisma.transaction.create({ data: ({
        kind: 'CONVERSION' as any,
        status: 'PENDING' as any,
        amount_in: amountFrom.toString(),
        asset_in: from,
        amount_out: buy.amount_asset,
        asset_out: to,
        price_usd: buy.price_usd,
        notional_usd: buy.notional_usdt,
        sender_customer_id: customer_id,
        comment: `Convert ${from}->${to} (pending antifraud)`,
      } as any)});
      const trig4 = await this.antiFraud.checkAndOpenCaseIfTriggered(tx4.id, { kind: 'CONVERSION' as any, amount: Number(buy.amount_asset), asset: to, sender_customer_id: customer_id });
      if (trig4) throw new Error('Transaction has been held by anti-fraud');
      await this.prisma.transaction.update({ where: { id: tx4.id }, data: { status: 'SUCCESS' as any, comment: `Convert ${from}->${to}` } });
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
      await tx.transaction.create({ data: ({
        kind: 'WITHDRAW_CRYPTO' as any,
        status: 'SUCCESS' as any,
        amount: amount.toString(),

        asset,
        amount_in: amount.toString(),
        asset_in: asset,
        amount_out: amount.toString(),
        asset_out: asset,
        fee_amount: feeFixed.toString(),
        tx_hash: txid,
        external_address: address,
        sender_customer_id: customer_id,
        comment: `Withdraw ${amount} ${asset}`,
      } as any)});
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

    // record transaction BANK_TO_WALLET (PENDING + antifraud)
    const tx5 = await this.prisma.transaction.create({ data: ({
      kind: 'BANK_TO_WALLET' as any,
      status: 'PENDING' as any,
      amount: amount.toString(),
      asset: 'ESOM',
      amount_in: amount.toString(),
      asset_in: 'SOM',
      amount_out: amount.toString(),
      asset_out: 'ESOM',
      tx_hash: ethTransaction.txHash,
      bank_op_id: bricsTransaction,
      sender_customer_id: customer.customer_id,
      receiver_wallet_address: customer.address,
      comment: 'Fiat->Crypto (pending antifraud)',
    } as any)});
    const trig5 = await this.antiFraud.checkAndOpenCaseIfTriggered(tx5.id, { kind: 'BANK_TO_WALLET' as any, amount, asset: 'ESOM', sender_customer_id: customer.customer_id, receiver_customer_id: customer.customer_id });
    if (trig5) throw new Error('Transaction has been held by anti-fraud');
    await this.prisma.transaction.update({ where: { id: tx5.id }, data: { status: 'SUCCESS' as any, comment: 'Fiat->Crypto' } });

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

    // record transaction WALLET_TO_BANK (PENDING + antifraud)
    const tx6 = await this.prisma.transaction.create({ data: ({
      kind: 'WALLET_TO_BANK' as any,
      status: 'PENDING' as any,
      amount: amount.toString(),
      asset: 'ESOM',
      amount_in: amount.toString(),
      asset_in: 'ESOM',
      amount_out: amount.toString(),
      asset_out: 'SOM',
      tx_hash: ethTransaction.txHash,
      bank_op_id: bricsTransaction,
      sender_customer_id: customer.customer_id,
      comment: 'Crypto->Fiat (pending antifraud)',
    } as any)});
    const trig6 = await this.antiFraud.checkAndOpenCaseIfTriggered(tx6.id, { kind: 'WALLET_TO_BANK' as any, amount, asset: 'ESOM', sender_customer_id: customer.customer_id });
    if (trig6) throw new Error('Transaction has been held by anti-fraud');
    await this.prisma.transaction.update({ where: { id: tx6.id }, data: { status: 'SUCCESS' as any, comment: 'Crypto->Fiat' } });

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

    // create PENDING and hold funds (ESOM) is reflected by chain transfer already; mark pending before anti-fraud check
    const tx = await this.prisma.transaction.create({ data: ({
      kind: 'WALLET_TO_WALLET' as any,
      status: 'PENDING' as any,
      amount: transferDto.amount.toString(),
      asset: 'ESOM',
      amount_in: transferDto.amount.toString(),
      asset_in: 'ESOM',
      amount_out: transferDto.amount.toString(),
      asset_out: 'ESOM',
      tx_hash: ethTransaction.txHash,
      sender_customer_id: customer.customer_id,
      receiver_customer_id: recipient.customer_id,
      comment: 'ESOM transfer (pending antifraud)',
    } as any)});

    const triggered = await this.antiFraud.checkAndOpenCaseIfTriggered(tx.id, {
      kind: 'WALLET_TO_WALLET' as any,
      amount: transferDto.amount,
      asset: 'ESOM',
      sender_customer_id: customer.customer_id,
      receiver_customer_id: recipient.customer_id,
    });

    if (triggered) {
      throw new Error('Transaction has been held by anti-fraud');
    }

    // finalize SUCCESS if no antifraud
    await this.prisma.transaction.update({ where: { id: tx.id }, data: { status: 'SUCCESS' as any, comment: 'ESOM transfer' } });

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

    // создаем транзакцию в статусе PENDING, удерживаем сумму у отправителя, но не зачисляем получателю
    const tx = await this.prisma.transaction.create({ data: ({
      kind: 'BANK_TO_BANK' as any,
      status: 'PENDING' as any,
      amount: transferDto.amount.toString(),
      asset: 'SOM',
      amount_in: transferDto.amount.toString(),
      asset_in: 'SOM',
      amount_out: transferDto.amount.toString(),
      asset_out: 'SOM',
      sender_customer_id: customer.customer_id,
      receiver_customer_id: bricsRecipient.CustomerID,
      comment: 'SOM transfer (pending antifraud)',
    } as any)});

    // списываем со счета отправителя (кэш баланс), получателю пока не начисляем
    await this.prisma.userAssetBalance.upsert({
      where: { customer_id_asset: { customer_id: customer.customer_id, asset: 'SOM' as Asset } },
      create: { customer_id: customer.customer_id, asset: 'SOM' as Asset, balance: (-transferDto.amount).toString() },
      update: { balance: { decrement: transferDto.amount.toString() } },
    });

    // антифрод проверка
    const triggered = await this.antiFraud.checkAndOpenCaseIfTriggered(tx.id, {
      kind: 'BANK_TO_BANK' as any,
      amount: transferDto.amount,
      asset: 'SOM',
      sender_customer_id: customer.customer_id,
      receiver_customer_id: bricsRecipient.CustomerID,
    });
    if (triggered) {
      throw new Error('Transaction has been held by anti-fraud');
    }

    // антифрод не сработал — выполняем реальный перевод и завершаем транзакцию
    const bricsTransaction = await this.bricsService.createTransferFiatToFiat(
      transferDto.amount,
      customer.customer_id.toString(),
      bricsRecipient.CustomerID.toString(),
    );
    if (!bricsTransaction) {
      throw new Error('Brics transaction failed');
    }
    await this.prisma.transaction.update({ where: { id: tx.id }, data: { status: 'SUCCESS' as any, bank_op_id: bricsTransaction, comment: 'SOM transfer' } });
    await this.prisma.userAssetBalance.upsert({
      where: { customer_id_asset: { customer_id: bricsRecipient.CustomerID, asset: 'SOM' as Asset } },
      create: { customer_id: bricsRecipient.CustomerID, asset: 'SOM' as Asset, balance: transferDto.amount.toString() },
      update: { balance: { increment: transferDto.amount.toString() } },
    });

    return new StatusOKDto();
  }
}
