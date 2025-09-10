import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { BricsService } from 'src/config/brics/brics.service';
import { EthereumService } from '../config/ethereum/ethereum.service';
import { UserInfoDto } from './dto/user-info.dto';
import { WalletDto } from './dto/wallet.dto';
import { Currency } from './enums/currency';
import { CryptoService } from '../config/crypto/crypto.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly bricsService: BricsService,
    private readonly prisma: PrismaClient,
    private readonly ethereumService: EthereumService,
    private readonly cryptoService: CryptoService,
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

    if (!user) {
      const userAddress = this.ethereumService.generateAddress();
      await this.prisma.customer.create({
        data: {
          customer_id: customerInfo.CustomerID,
          address: userAddress.address,
          private_key: userAddress.privateKey,
        },
      });
    }

    return {
      customer_id: customerInfo.CustomerID,
      first_name: customerInfo.CustomerNameTranslit || customerInfo.CustomerName,
      middle_name: customerInfo.OtchestvoTranslit || customerInfo.Otchestvo,
      last_name: customerInfo.SurnameTranslit || customerInfo.Surname,
      phone: customerInfo.ContactPhone1 || '',
      email: customerInfo.EMail || '',
    };
  }

  async getUserWallets(userInfo: UserInfoDto): Promise<WalletDto[]> {
    let user = await this.prisma.customer.findUniqueOrThrow({
      where: {
        customer_id: userInfo.customer_id,
      },
    });

    const [somBalance, tokenBalance] = await Promise.all([
      this.bricsService.getSomBalance(),
      this.ethereumService.getEsomBalance(user.address),
    ]);

    return [
      {
        currency: Currency.SOM,
        address: userInfo.phone,
        balance: somBalance,
        buy_rate: 1.0,
        sell_rate: 1.0,
      },
      {
        currency: Currency.ESOM,
        address: user.address,
        balance: tokenBalance,
        buy_rate: 1.0,
        sell_rate: 1.0,
      },
      {
        currency: Currency.BTC,
        address: this.cryptoService.btcBech32AddressFromPrivateKey(user.private_key),
        balance: 0.0,
        buy_rate: 1.0,
        sell_rate: 1.0,
      },
      {
        currency: Currency.ETH,
        address: this.cryptoService.ethAddressFromPrivateKey(user.private_key),
        balance: 0.0,
        buy_rate: 1.0,
        sell_rate: 1.0,
      },
      {
        currency: Currency.USDT_TRC20,
        address: this.cryptoService.trxAddressFromPrivateKey(user.private_key),
        balance: 0.0,
        buy_rate: 1.0,
        sell_rate: 1.0,
      },
    ];
  }
}
