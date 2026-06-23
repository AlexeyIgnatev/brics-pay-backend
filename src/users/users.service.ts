import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaClient, Asset, PushPlatform } from '@prisma/client';
import { BricsService } from 'src/config/brics/brics.service';
import { EthereumService } from '../config/ethereum/ethereum.service';
import { UserInfoDto } from './dto/user-info.dto';
import { WalletDto } from './dto/wallet.dto';
import { Currency } from './enums/currency';
import { SettingsService } from '../config/settings/settings.service';
import { ShkeeperWalletService } from '../config/exchange/shkeeper-wallet.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly bricsService: BricsService,
    private readonly prisma: PrismaClient,
    private readonly ethereumService: EthereumService,
    private readonly settingsService: SettingsService,
    private readonly shkeeperWalletService: ShkeeperWalletService,
  ) {}

  private toPushPlatform(platform: 'android' | 'ios'): PushPlatform {
    return platform === 'ios' ? PushPlatform.IOS : PushPlatform.ANDROID;
  }

  async updateLastLogin(customerId: number, ip?: string, device?: string) {
    try {
      await this.prisma.customer.update({
        where: { customer_id: customerId },
        data: { last_login_at: new Date(), last_login_ip: ip, last_login_device: device },
      });
    } catch (_) {
      // ignore if user not created yet; getUserInfo will handle creation
    }
  }

  async saveFcmToken(customerId: number, token: string, platform: 'android' | 'ios'): Promise<void> {
    const trimmedToken = token.trim();
    const pushPlatform = this.toPushPlatform(platform);

    await this.prisma.userPushToken.upsert({
      where: { token: trimmedToken },
      create: {
        customer_id: customerId,
        token: trimmedToken,
        platform: pushPlatform,
        is_active: true,
      },
      update: {
        customer_id: customerId,
        platform: pushPlatform,
        is_active: true,
        last_error: null,
      },
    });
  }

  async updatePushSettings(customerId: number, pushEnabled: boolean): Promise<void> {
    await this.prisma.customer.update({
      where: { customer_id: customerId },
      data: { push_enabled: pushEnabled },
    });
  }

  async getUserInfo(username: string, password: string): Promise<UserInfoDto> {
    this.logger.log(`getUserInfo start username=${username}`);

    const auth = await this.bricsService.auth(username, password);
    if (!auth) {
      this.logger.warn(`getUserInfo auth failed username=${username}`);
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
      this.logger.log(`getUserInfo creating customer customerId=${customerInfo.CustomerID}`);
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
      this.logger.log(`getUserInfo updating existing customer customerId=${customerInfo.CustomerID} storedAddress=${user.address}`);
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

    this.logger.log(`getUserInfo syncing SHKeeper wallet customerId=${customerInfo.CustomerID}`);
    const usdtWallet = await this.shkeeperWalletService.ensureUsdtWallet(customerInfo.CustomerID);
    this.logger.log(`getUserInfo SHKeeper wallet result customerId=${customerInfo.CustomerID} address=${usdtWallet.address} created=${usdtWallet.created}`);
    if (usdtWallet.created) {
      await this.prisma.userAssetBalance.upsert({
        where: { customer_id_asset: { customer_id: customerInfo.CustomerID, asset: 'USDT_TRC20' as Asset } },
        create: { customer_id: customerInfo.CustomerID, asset: 'USDT_TRC20' as Asset, balance: '0' },
        update: { balance: '0' },
      });
      this.logger.log(`getUserInfo reset USDT balance to 0 customerId=${customerInfo.CustomerID}`);
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

    const usdtWallet = await this.shkeeperWalletService.ensureUsdtWallet(user.customer_id);
    if (usdtWallet.created) {
      await this.prisma.userAssetBalance.upsert({
        where: { customer_id_asset: { customer_id: user.customer_id, asset: 'USDT_TRC20' as Asset } },
        create: { customer_id: user.customer_id, asset: 'USDT_TRC20' as Asset, balance: '0' },
        update: { balance: '0' },
      });
    }

    const [somLive, esomBalance, settings, usdtBalanceRec] = await Promise.all([
      this.bricsService.getSomBalance(),
      this.ethereumService.getEsomBalance(user.address),
      this.settingsService.get(),
      this.prisma.userAssetBalance.findUnique({
        where: {
          customer_id_asset: {
            customer_id: user.customer_id,
            asset: 'USDT_TRC20' as Asset,
          },
        },
      }),
    ]);

    await this.prisma.userAssetBalance.upsert({
      where: { customer_id_asset: { customer_id: user.customer_id, asset: 'SOM' as Asset } },
      create: { customer_id: user.customer_id, asset: 'SOM' as Asset, balance: somLive.toString() },
      update: { balance: somLive.toString() },
    });

    const esomPerUsd = Number(settings.esom_per_usd);
    const usdtUsd = 1;

    const usdtBaseEsom = usdtUsd * esomPerUsd;

    const usdtFee = Number(settings.usdt_trade_fee_pct) / 100;

    const usdtBuy = usdtBaseEsom * (1 + usdtFee);
    const usdtSell = usdtBaseEsom * (1 - usdtFee);

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
        currency: Currency.USDT_TRC20,
        address: usdtWallet.address,
        balance: Number(usdtBalanceRec?.balance ?? 0),
        buy_rate: usdtBuy,
        sell_rate: usdtSell,
      },
    ];
  }
}
