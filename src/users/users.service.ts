import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaClient, Asset } from '@prisma/client';
import { BricsService } from 'src/config/brics/brics.service';
import { EthereumService } from '../config/ethereum/ethereum.service';
import { UserInfoDto } from './dto/user-info.dto';
import { WalletDto } from './dto/wallet.dto';
import { Currency } from './enums/currency';
import { CryptoService } from '../config/crypto/crypto.service';
import { SettingsService } from '../config/settings/settings.service';
import { BybitExchangeService } from '../config/exchange/bybit.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly bricsService: BricsService,
    private readonly prisma: PrismaClient,
    private readonly ethereumService: EthereumService,
    private readonly cryptoService: CryptoService,
    private readonly settingsService: SettingsService,
    private readonly exchangeService: BybitExchangeService,
  ) {
  }

  async getUserInfo(
    username: string,
    password: string,
  ): Promise<UserInfoDto> {
    const auth = await this.bricsService.auth(username, password);
    if (!auth) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    const customerInfo = await this.bricsService.getCustomerInfo();
    let user = await this.prisma.customer.findUnique({
      where: {
        customer_id: customerInfo.CustomerID,
      },
    });

    const first_name = customerInfo.CustomerNameTranslit || customerInfo.CustomerName;
    const middle_name = customerInfo.OtchestvoTranslit || customerInfo.Otchestvo;
    const last_name = customerInfo.SurnameTranslit || customerInfo.Surname;
    const phone = customerInfo.ContactPhone1 || '';
    const email = customerInfo.EMail || '';

    if (!user) {
      const userAddress = this.ethereumService.generateAddress();
      await this.prisma.customer.create({
        data: {
          customer_id: customerInfo.CustomerID,
          address: userAddress.address,
          private_key: userAddress.privateKey,
          first_name,
          middle_name,
          last_name,
          phone,
          email,
        },
      });
    } else {
      // Обновлять только пустые поля — если админ ранее отредактировал, не перезаписываем
      const data: any = {};
      if (!user.first_name && first_name) data.first_name = first_name;
      if (!user.middle_name && middle_name) data.middle_name = middle_name;
      if (!user.last_name && last_name) data.last_name = last_name;
      if (!user.phone && phone) data.phone = phone;
      if (!user.email && email) data.email = email;
      if (Object.keys(data).length) {
        await this.prisma.customer.update({ where: { customer_id: customerInfo.CustomerID }, data });
      }
    }

    return {
      customer_id: customerInfo.CustomerID,
      first_name,
      middle_name,
      last_name,
      phone,
      email,
    };
  }

  async getUserWallets(userInfo: UserInfoDto): Promise<WalletDto[]> {
    const user = await this.prisma.customer.findUniqueOrThrow({
      where: { customer_id: userInfo.customer_id },
    });

    const [somLive, esomBalance, settings, pricesUsd] = await Promise.all([
      this.bricsService.getSomBalance(),
      this.ethereumService.getEsomBalance(user.address),
      this.settingsService.get(),
      this.exchangeService.getUsdPrices(['BTC' as Asset, 'ETH' as Asset, 'USDT_TRC20' as Asset]),
    ]);

    await this.prisma.userAssetBalance.upsert({
      where: { customer_id_asset: { customer_id: user.customer_id, asset: 'SOM' as Asset } },
      create: { customer_id: user.customer_id, asset: 'SOM' as Asset, balance: somLive.toString() },
      update: { balance: somLive.toString() },
    });

    const esomPerUsd = Number(settings.esom_per_usd);
    const btcUsd = Number(pricesUsd['BTC'] || 0);
    const ethUsd = Number(pricesUsd['ETH'] || 0);
    const usdtUsd = 1;

    const btcBaseEsom = btcUsd * esomPerUsd;
    const ethBaseEsom = ethUsd * esomPerUsd;
    const usdtBaseEsom = usdtUsd * esomPerUsd;

    const btcFee = Number(settings.btc_trade_fee_pct) / 100;
    const ethFee = Number(settings.eth_trade_fee_pct) / 100;
    const usdtFee = Number(settings.usdt_trade_fee_pct) / 100;

    const btcBuy = btcBaseEsom * (1 + btcFee);
    const btcSell = btcBaseEsom * (1 - btcFee);
    const ethBuy = ethBaseEsom * (1 + ethFee);
    const ethSell = ethBaseEsom * (1 - ethFee);
    const usdtBuy = usdtBaseEsom * (1 + usdtFee);
    const usdtSell = usdtBaseEsom * (1 - usdtFee);

    const [btcBalanceRec, ethBalanceRec, usdtBalanceRec] = await Promise.all([
      this.prisma.userAssetBalance.findUnique({
        where: {
          customer_id_asset: {
            customer_id: user.customer_id,
            asset: 'BTC' as Asset,
          },
        },
      }),
      this.prisma.userAssetBalance.findUnique({
        where: {
          customer_id_asset: {
            customer_id: user.customer_id,
            asset: 'ETH' as Asset,
          },
        },
      }),
      this.prisma.userAssetBalance.findUnique({
        where: {
          customer_id_asset: {
            customer_id: user.customer_id,
            asset: 'USDT_TRC20' as Asset,
          },
        },
      }),
    ]);

    return [
      {
        currency: Currency.SOM,
        address: userInfo.phone,
        balance: somLive,
        buy_rate: 1.0,
        sell_rate: 1.0,
      },
      {
        currency: Currency.ESOM,
        address: user.address,
        balance: esomBalance,
        buy_rate: 1.0 - Number(settings.esom_som_conversion_fee_pct) / 100,
        sell_rate: 1.0 - Number(settings.esom_som_conversion_fee_pct) / 100,
      },
      {
        currency: Currency.BTC,
        address: this.cryptoService.btcBech32AddressFromPrivateKey(user.private_key),
        balance: Number(btcBalanceRec?.balance ?? 0),
        buy_rate: btcBuy,
        sell_rate: btcSell,
      },
      {
        currency: Currency.ETH,
        address: this.cryptoService.ethAddressFromPrivateKey(user.private_key),
        balance: Number(ethBalanceRec?.balance ?? 0),
        buy_rate: ethBuy,
        sell_rate: ethSell,
      },
      {
        currency: Currency.USDT_TRC20,
        address: this.cryptoService.trxAddressFromPrivateKey(user.private_key),
        balance: Number(usdtBalanceRec?.balance ?? 0),
        buy_rate: usdtBuy,
        sell_rate: usdtSell,
      },
    ];
  }
}
