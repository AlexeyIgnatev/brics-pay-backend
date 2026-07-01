import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaClient, Asset, PushPlatform } from '@prisma/client';
import { BricsService } from 'src/config/brics/brics.service';
import { EthereumService } from '../config/ethereum/ethereum.service';
import { UserInfoDto } from './dto/user-info.dto';
import { WalletDto } from './dto/wallet.dto';
import { Currency } from './enums/currency';
import { CryptoService } from '../config/crypto/crypto.service';
import { SettingsService } from '../config/settings/settings.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly bricsService: BricsService,
    private readonly prisma: PrismaClient,
    private readonly ethereumService: EthereumService,
    private readonly cryptoService: CryptoService,
    private readonly settingsService: SettingsService,
  ) {}

  private toPushPlatform(platform: 'android' | 'ios'): PushPlatform {
    return platform === 'ios' ? PushPlatform.IOS : PushPlatform.ANDROID;
  }

  private buildCustomerProfileData(customerInfo: {
    CustomerNameTranslit?: string;
    CustomerName?: string;
    OtchestvoTranslit?: string;
    Otchestvo?: string;
    SurnameTranslit?: string;
    Surname?: string;
    ContactPhone1?: string;
    EMail?: string;
  }) {
    return {
      first_name:
        customerInfo.CustomerNameTranslit || customerInfo.CustomerName || '',
      middle_name:
        customerInfo.OtchestvoTranslit || customerInfo.Otchestvo || '',
      last_name: customerInfo.SurnameTranslit || customerInfo.Surname || '',
      phone: customerInfo.ContactPhone1 || '',
      email: customerInfo.EMail || '',
    };
  }

  private isValidCustomerWallet(user: {
    address: string | null;
    private_key: string | null;
  }): boolean {
    if (!user.address?.trim() || !user.private_key?.trim()) {
      return false;
    }

    try {
      const expectedAddress = this.ethereumService
        .getAddressFromPrivateKey(user.private_key)
        .trim()
        .toLowerCase();

      return (
        this.ethereumService.validateAddress(user.address) &&
        user.address.trim().toLowerCase() === expectedAddress
      );
    } catch {
      return false;
    }
  }

  private async repairCustomerWallet(
    customerId: number,
    profileData: {
      first_name: string;
      middle_name: string;
      last_name: string;
      phone: string;
      email: string;
    },
  ): Promise<void> {
    const wallet = this.ethereumService.generateAddress();

    await this.prisma.customer.upsert({
      where: { customer_id: customerId },
      create: {
        customer_id: customerId,
        address: wallet.address,
        private_key: wallet.privateKey,
        ...profileData,
      },
      update: {
        address: wallet.address,
        private_key: wallet.privateKey,
        ...profileData,
      },
    });
  }

  async updateLastLogin(customerId: number, ip?: string, device?: string) {
    try {
      await this.prisma.customer.update({
        where: { customer_id: customerId },
        data: {
          last_login_at: new Date(),
          last_login_ip: ip,
          last_login_device: device,
        },
      });
    } catch (_) {}
  }

  async saveFcmToken(
    customerId: number,
    token: string,
    platform: 'android' | 'ios',
  ): Promise<void> {
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

  async updatePushSettings(
    customerId: number,
    pushEnabled: boolean,
  ): Promise<void> {
    await this.prisma.customer.update({
      where: { customer_id: customerId },
      data: { push_enabled: pushEnabled },
    });
  }

  async getUserInfo(username: string, password: string): Promise<UserInfoDto> {
    const auth = await this.bricsService.auth(username, password);
    if (!auth) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    const customerInfo = await this.bricsService.getCustomerInfo();
    const profileData = this.buildCustomerProfileData(customerInfo);
    let user = await this.prisma.customer.findUnique({
      where: {
        customer_id: customerInfo.CustomerID,
      },
    });

    if (!user) {
      await this.repairCustomerWallet(customerInfo.CustomerID, profileData);
      user = await this.prisma.customer.findUnique({
        where: {
          customer_id: customerInfo.CustomerID,
        },
      });
    } else {
      const data: {
        first_name?: string;
        middle_name?: string;
        last_name?: string;
        phone?: string;
        email?: string;
      } = {};

      if (!user.first_name && profileData.first_name) {
        data.first_name = profileData.first_name;
      }
      if (!user.middle_name && profileData.middle_name) {
        data.middle_name = profileData.middle_name;
      }
      if (!user.last_name && profileData.last_name) {
        data.last_name = profileData.last_name;
      }
      if (!user.phone && profileData.phone) {
        data.phone = profileData.phone;
      }
      if (!user.email && profileData.email) {
        data.email = profileData.email;
      }

      if (!this.isValidCustomerWallet(user)) {
        await this.repairCustomerWallet(customerInfo.CustomerID, profileData);
        user = await this.prisma.customer.findUnique({
          where: {
            customer_id: customerInfo.CustomerID,
          },
        });
      } else if (Object.keys(data).length) {
        await this.prisma.customer.update({
          where: { customer_id: customerInfo.CustomerID },
          data,
        });
      }
    }

    return {
      customer_id: customerInfo.CustomerID,
      ...profileData,
    };
  }

  async getUserWallets(userInfo: UserInfoDto): Promise<WalletDto[]> {
    let user = await this.prisma.customer.findUniqueOrThrow({
      where: { customer_id: userInfo.customer_id },
    });

    if (!this.isValidCustomerWallet(user)) {
      await this.repairCustomerWallet(user.customer_id, {
        first_name: userInfo.first_name,
        middle_name: userInfo.middle_name,
        last_name: userInfo.last_name,
        phone: userInfo.phone,
        email: userInfo.email,
      });
      user = await this.prisma.customer.findUniqueOrThrow({
        where: { customer_id: userInfo.customer_id },
      });
    }

    const fallbackSettings = {
      esom_per_usd: '1',
      esom_som_conversion_fee_pct: '0',
      esom_som_conversion_fee_min: '0',
      usdt_trade_fee_pct: '0',
      usdt_withdraw_fee_fixed: '0',
      min_withdraw_usdt_trc20: '0',
    };

    const [somLiveResult, esomBalanceResult, settingsResult] =
      await Promise.allSettled([
        this.bricsService.getSomBalance(),
        this.ethereumService.getEsomBalance(user.address),
        this.settingsService.get(),
      ]);

    if (somLiveResult.status === 'rejected') {
      console.warn(
        `Failed to fetch SOM balance for customer=${user.customer_id}: ${somLiveResult.reason}`,
      );
    }
    if (esomBalanceResult.status === 'rejected') {
      console.warn(
        `Failed to fetch ESOM balance for customer=${user.customer_id}: ${esomBalanceResult.reason}`,
      );
    }
    if (settingsResult.status === 'rejected') {
      console.warn(
        `Failed to fetch settings for customer=${user.customer_id}: ${settingsResult.reason}`,
      );
    }
    const somLive =
      somLiveResult.status === 'fulfilled' ? somLiveResult.value : 0;
    const esomBalance =
      esomBalanceResult.status === 'fulfilled' ? esomBalanceResult.value : 0;
    const settings =
      settingsResult.status === 'fulfilled'
        ? settingsResult.value
        : fallbackSettings;

    await this.prisma.userAssetBalance.upsert({
      where: {
        customer_id_asset: {
          customer_id: user.customer_id,
          asset: 'SOM' as Asset,
        },
      },
      create: {
        customer_id: user.customer_id,
        asset: 'SOM' as Asset,
        balance: somLive.toString(),
      },
      update: { balance: somLive.toString() },
    });

    const esomPerUsd = Number(settings.esom_per_usd);
    const usdtFee = Number(settings.usdt_trade_fee_pct) / 100;

    const usdtBaseEsom = 1 * esomPerUsd;
    const usdtBuy = usdtBaseEsom * (1 + usdtFee);
    const usdtSell = usdtBaseEsom * (1 - usdtFee);

    const usdtBalanceRec = await this.prisma.userAssetBalance.findUnique({
      where: {
        customer_id_asset: {
          customer_id: user.customer_id,
          asset: 'USDT_TRC20' as Asset,
        },
      },
    });

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
        address: this.cryptoService.trxAddressFromPrivateKey(user.private_key),
        balance: Number(usdtBalanceRec?.balance ?? 0),
        buy_rate: usdtBuy,
        sell_rate: usdtSell,
      },
    ];
  }
}
