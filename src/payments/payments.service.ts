import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { PaymentDto, TransferDto } from './dto/payment.dto';
import { EthereumService } from 'src/config/ethereum/ethereum.service';
import { BricsService } from 'src/config/brics/brics.service';
import { StatusOKDto } from 'src/common/dto/status.dto';
import { ConfigService } from '@nestjs/config';
import { Currency } from '../users/enums/currency';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ethereumService: EthereumService,
    private readonly bricsService: BricsService,
    private readonly moduleRef: ModuleRef,
    private readonly configService: ConfigService,
  ) {
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
