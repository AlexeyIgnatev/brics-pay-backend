import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import {
  Asset,
  CustomerResidency,
  PrismaClient,
  PushPlatform,
  TariffCategory,
  UserStatus,
} from '@prisma/client';
import { BricsService } from 'src/config/brics/brics.service';
import { EthereumService } from '../config/ethereum/ethereum.service';
import { UserInfoDto } from './dto/user-info.dto';
import { WalletDto } from './dto/wallet.dto';
import { Currency } from './enums/currency';
import { CryptoService } from '../config/crypto/crypto.service';
import { SettingsService } from '../config/settings/settings.service';
import { BrowserWalletRegisterDto } from './dto/browser-wallet.dto';
import { TronService } from '../config/crypto/tron.service';

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly bricsService: BricsService,
    private readonly prisma: PrismaClient,
    private readonly ethereumService: EthereumService,
    private readonly cryptoService: CryptoService,
    private readonly settingsService: SettingsService,
    private readonly tronService: TronService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const browserWallets = await this.prisma.customer.findMany({
      where: {
        OR: [
          { customer_id: { gte: 910_000_000 } },
          {
            first_name: 'Browser',
            middle_name: 'TRON',
            last_name: 'Wallet',
          },
        ],
      },
      select: {
        customer_id: true,
        private_key: true,
      },
    });

    for (const wallet of browserWallets) {
      const privateKey = wallet.private_key?.trim();
      if (!privateKey) continue;
      try {
        const address = this.cryptoService.trxAddressFromPrivateKey(privateKey);
        await this.tronService.bootstrapAccount(address);
        this.logger.verbose(
          `[browser-wallet-bootstrap] ready customer=${wallet.customer_id} address=${address}`,
        );
      } catch (error) {
        this.logger.warn(
          `[browser-wallet-bootstrap] failed customer=${wallet.customer_id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

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
    const existing = await this.prisma.customer.findUnique({
      where: { customer_id: customerId },
      select: { private_key: true },
    });
    const wallet = existing?.private_key?.trim()
      ? {
          privateKey: existing.private_key,
          address: this.ethereumService.getAddressFromPrivateKey(
            existing.private_key,
          ),
        }
      : this.ethereumService.generateAddress();

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

  async registerBrowserWallet(dto: BrowserWalletRegisterDto): Promise<{
    customer_id: number;
    address: string;
    private_key: string;
  }> {
    const privateKey = dto.private_key.trim().replace(/^0x/, '');
    const address = this.cryptoService.trxAddressFromPrivateKey(privateKey);
    const customerId =
      dto.customer_id && dto.customer_id > 0
        ? dto.customer_id
        : await this.getNextBrowserWalletCustomerId();

    await this.prisma.customer.upsert({
      where: { customer_id: customerId },
      create: {
        customer_id: customerId,
        address,
        private_key: privateKey,
        first_name: 'Browser',
        middle_name: 'TRON',
        last_name: 'Wallet',
        phone: '',
        email: '',
        tariff_category: TariffCategory.K1,
        residency: CustomerResidency.RESIDENT,
        status: UserStatus.ACTIVE,
      },
      update: {
        address,
        private_key: privateKey,
      },
    });

    await this.tronService.bootstrapAccount(address);

    return {
      customer_id: customerId,
      address,
      private_key: privateKey,
    };
  }

  private async getNextBrowserWalletCustomerId(): Promise<number> {
    const base = 910_000_000;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const candidate = base + Math.floor(Math.random() * 90_000_000);
      const existing = await this.prisma.customer.findUnique({
        where: { customer_id: candidate },
        select: { customer_id: true },
      });
      if (!existing) {
        return candidate;
      }
    }

    throw new Error('Unable to allocate browser wallet customer id');
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
    const tariffs = await this.settingsService.getTariffs();
    const tariffRows = tariffs.filter(
      (row) =>
        row.category === user.tariff_category &&
        row.residency === user.residency,
    );
    const tariffPercentFor = (operation: string): number => {
      const aliasOperation =
        operation === 'SOM_TO_USDT_TRC20'
          ? 'ESOM_TO_USDT_TRC20'
          : operation === 'USDT_TRC20_TO_SOM'
            ? 'USDT_TRC20_TO_ESOM'
            : operation;
      const row = tariffRows.find((item) => item.operation === aliasOperation);
      return Number(row?.percent_fee ?? 0) / 100;
    };

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
    const esomBuyFee = tariffPercentFor('SOM_TO_ESOM');
    const esomSellFee = tariffPercentFor('ESOM_TO_SOM');
    const usdtBuyFee = tariffPercentFor('ESOM_TO_USDT_TRC20');
    const usdtSellFee = tariffPercentFor('USDT_TRC20_TO_ESOM');

    const usdtBaseEsom = 1 * esomPerUsd;

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
        buy_rate: 1.0 - esomBuyFee,
        sell_rate: 1.0 - esomSellFee,
      },
      {
        currency: Currency.USDT_TRC20,
        address: this.cryptoService.trxAddressFromPrivateKey(user.private_key),
        balance: Number(usdtBalanceRec?.balance ?? 0),
        buy_rate: usdtBaseEsom * (1 + usdtBuyFee),
        sell_rate: usdtBaseEsom * (1 - usdtSellFee),
      },
    ];
  }
}
