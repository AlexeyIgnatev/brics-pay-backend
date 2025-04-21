import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { BricsService } from 'src/config/brics/brics.service';
import { LoginDto, LoginResponseDto } from './login.dto';
import { EthereumService } from '../config/ethereum/ethereum.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly bricsService: BricsService,
    private readonly prisma: PrismaClient,
    private readonly ethereumService: EthereumService,
  ) {}

  async getUserInfo(loginDto: LoginDto): Promise<LoginResponseDto> {
    const auth = await this.bricsService.auth(
      loginDto.username,
      loginDto.password,
    );
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
      user = await this.prisma.customer.create({
        data: {
          customer_id: customerInfo.CustomerID,
          address: userAddress.address,
          private_key: userAddress.privateKey,
        },
      });
    }

    const [somBalance, tokenBalance] = await Promise.all([
      this.bricsService.getSomBalance(),
      this.ethereumService.getTokenBalance(user.address),
    ]);

    return {
      customer_id: customerInfo.CustomerID,
      balance: {
        SOM: somBalance,
        ESOM: tokenBalance,
      },
      first_name: customerInfo.CustomerName,
      middle_name: customerInfo.Otchestvo,
      last_name: customerInfo.Surname,
      phone: customerInfo.ContactPhone1,
      email: customerInfo.EMail,
    };
  }
}
