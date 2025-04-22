import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PaymentDto, TransferDto } from './dto/payment.dto';
import { EthereumService } from 'src/config/ethereum/ethereum.service';
import { BricsService } from 'src/config/brics/brics.service';
import { StatusOKDto } from 'src/common/dto/status.dto';
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ethereumService: EthereumService,
    private readonly bricsService: BricsService,
  ) {}

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
    const bricsTransaction =
      await this.bricsService.createTransactionCryptoToFiat(
        amount,
        customer.customer_id,
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
    const customer = await this.prisma.customer.findUnique({
      where: { customer_id: customer_id },
    });
    if (!customer) {
      throw new Error('Customer not found');
    }
    const { amount } = paymentDto;
    const bricsTransaction =
      await this.bricsService.createTransactionFiatToCrypto(
        amount,
        customer.customer_id,
      );
    if (!bricsTransaction) {
      throw new Error('Brics transaction failed');
    }
    const ethTransaction = await this.ethereumService.transferToFiat(
      customer.address,
      amount,
      customer.private_key,
    );
    if (!ethTransaction) {
      throw new Error('Ethereum transaction failed');
    }
    return new StatusOKDto();
  }

  async transfer(
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
      transferDto.phone_number,
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
      customer.address,
      transferDto.amount,
      customer.private_key,
    );
    if (!ethTransaction) {
      throw new Error('Ethereum transaction failed');
    }
    return new StatusOKDto();
  }
}
