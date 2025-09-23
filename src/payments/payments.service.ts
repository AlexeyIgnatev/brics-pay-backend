import { Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ethereumService: EthereumService,
    private readonly bricsService: BricsService,
    private readonly moduleRef: ModuleRef,
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
    private readonly exchangeService: BybitExchangeService,
  ) {
  }


  async convert(dto: ConvertDto, customer_id: number): Promise<StatusOKDto> {
    // Универсальная конвертация между ESOM/SOM/BTC/ETH/USDT_TRC20
    // 1) ESOM/SOM — используем существующую логику (Brics/EthereumService) и комиссию esom_som_conversion_fee_pct
    // 2) Crypto — реальная торговля на Bybit в парах к USDT

    const user = await this.prisma.customer.findUniqueOrThrow({ where: { customer_id } });
    const s = await this.settingsService.get();

    const from = dto.asset_from as unknown as Asset;
    const to = dto.asset_to as unknown as Asset;
    const amountFrom = dto.amount_from;

    const esomPerUsd = Number(s.esom_per_usd);

    const adjustTrade = (asset: Asset, baseEsom: number, buy: boolean) => {
      const feePct = asset === 'BTC' ? Number(s.btc_trade_fee_pct) / 100
        : asset === 'ETH' ? Number(s.eth_trade_fee_pct) / 100
        : asset === 'USDT_TRC20' ? Number(s.usdt_trade_fee_pct) / 100
        : 0;
      return buy ? baseEsom * (1 + feePct) : baseEsom * (1 - feePct);
    };

    // Helper to change DB balance
    const addBalance = async (asset: Asset, delta: number) => {
      await this.prisma.userAssetBalance.upsert({
        where: { customer_id_asset: { customer_id, asset } },
        create: { customer_id, asset, balance: delta.toString() },
        update: { balance: { increment: delta.toString() } },
      });
    };

    // ESOM/SOM conversions are already implemented in existing methods; we only orchestrate when they are part of a trade

    if (from === 'ESOM' && (to === 'BTC' || to === 'ETH' || to === 'USDT_TRC20')) {
      // ESOM -> USDT (через курс) -> купить целевой ассет на Bybit
      const usdtAmount = amountFrom / esomPerUsd; // без доп комиссии — торговая комиссия применится в бирже/цене
      const order = to === 'USDT_TRC20'
        ? { asset: to, amount_asset: usdtAmount.toString(), price_usd: '1', notional_usdt: usdtAmount.toString() }
        : await this.exchangeService.marketBuy(to, usdtAmount.toString());

      // Списать ESOM у пользователя на админский кошелёк (burn-like) через существующую механику
      await this.ethereumService.transferToFiat(amountFrom, user.private_key);

      // Обновить внутренние балансы: начислить купленный asset
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
      return new StatusOKDto();
    }

    if ((from === 'BTC' || from === 'ETH' || from === 'USDT_TRC20') && to === 'ESOM') {
      // Продать на Bybit за USDT (кроме USDT) -> конвертировать USDT в ESOM -> начислить ESOM пользователю из админского кошелька (mint-like)
      let notionalUsdt = 0;
      if (from === 'USDT_TRC20') {
        notionalUsdt = amountFrom;
      } else {
        const order = await this.exchangeService.marketSell(from, amountFrom.toString());
        notionalUsdt = Number(order.notional_usdt);
      }
      const esomAmount = notionalUsdt * esomPerUsd;

      // Начислить ESOM пользователю с админского кошелька (transferFromFiat)
      await this.ethereumService.transferFromFiat(user.address, esomAmount);

      // Обновить внутренние балансы: списать проданный asset
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
      return new StatusOKDto();
    }

    if ((from === 'BTC' || from === 'ETH' || from === 'USDT_TRC20') && (to === 'BTC' || to === 'ETH' || to === 'USDT_TRC20')) {
      // Крипта -> крипта: через USDT
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
        return new StatusOKDto();
      }
      const buy = await this.exchangeService.marketBuy(to, usdtIntermediate.toString());
      await addBalance(from, -amountFrom);
      await addBalance(to, Number(buy.amount_asset));
      await this.prisma.userTrade.create({ data: { customer_id, asset_from: from, asset_to: to, amount_from: amountFrom.toString(), amount_to: buy.amount_asset, price_usd: buy.price_usd, notional_usdt: buy.notional_usdt, fee_esom: '0' } });
      return new StatusOKDto();
    }

    if (from === 'SOM' && to === 'ESOM') {
      // SOM -> ESOM: используем уже реализованную логику платежей (fiat->crypto)
      return this.fiatToCrypto({ amount: amountFrom }, customer_id);
    }
    if (from === 'ESOM' && to === 'SOM') {
      // ESOM -> SOM: используем уже реализованную логику (crypto->fiat)
      return this.cryptoToFiat({ amount: amountFrom }, customer_id);
    }

    return new StatusOKDto();
  }

  async fiatToCrypto(
    paymentDto: PaymentDto,
    customer_id: number,
  ): Promise<StatusOKDto> {
    this.logger.log('fiatToCrypto', paymentDto, customer_id);

    const { amount } = paymentDto;

    const customer = await this.prisma.customer.findUnique({
      where: { customer_id: customer_id },
    });
    if (!customer) {
      throw new Error('Customer not found');
    }

    const bricsTransaction =
      await this.bricsService.createTransactionFiatToCrypto(

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

        amount,
        customer.customer_id.toString(),
      );
    if (!bricsTransaction) {
      throw new Error('Brics transaction failed');
    }

    const ethTransaction = await this.ethereumService.transferFromFiat(
      customer.address,
      amount,
    );
    if (!ethTransaction) {
      throw new Error('Ethereum transaction failed');
    }

    return new StatusOKDto();
  }

  async cryptoToFiat(
    paymentDto: PaymentDto,
    customer_id: number,
  ): Promise<StatusOKDto> {
    this.logger.log('cryptoToFiat', paymentDto, customer_id);

    const { amount } = paymentDto;

    const customer = await this.prisma.customer.findUnique({
      where: { customer_id: customer_id },
    });
    if (!customer) {
      throw new Error('Customer not found');
    }

    const ethTransaction = await this.ethereumService.transferToFiat(
      amount,
      customer.private_key,
    );
    if (!ethTransaction) {
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

    const bricsTransaction =
      await adminBricsService.createTransactionCryptoToFiat(
        amount * (1 - Number(this.configService.get('PLATFORM_FEE'))),
        customer.customer_id.toString(),
      );
    if (!bricsTransaction) {
      throw new Error('Brics transaction failed');
    }

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
    this.logger.log('transferEsom', transferDto, customer_id);

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
      this.logger.log('Recipient not found, generating address');
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
    if (!ethTransaction) {
      throw new Error('Ethereum transaction failed');
    }

    return new StatusOKDto();
  }

  async transferSom(
    transferDto: TransferDto,
    customer_id: number,
  ): Promise<StatusOKDto> {
    this.logger.log('transferSom', transferDto, customer_id);

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

    const bricsTransaction =
      await this.bricsService.createTransferFiatToFiat(
        transferDto.amount,
        customer.customer_id.toString(),
        bricsRecipient.CustomerID.toString(),
      );
    if (!bricsTransaction) {
      throw new Error('Brics transaction failed');
    }

    return new StatusOKDto();
  }
}
