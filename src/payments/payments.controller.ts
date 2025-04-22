import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { PaymentDto, TransferDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';
import { BasicAuthGuard } from 'src/common/guards/basic-auth.guard';
import { LoginResponseDto } from 'src/users/login.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('fiat-to-crypto')
  @UseGuards(BasicAuthGuard)
  async fiatToCrypto(
    @Body() paymentDto: PaymentDto,
    @Req() req: { user: LoginResponseDto },
  ) {
    return this.paymentsService.fiatToCrypto(paymentDto, req?.user.customer_id);
  }

  @Post('crypto-to-fiat')
  @UseGuards(BasicAuthGuard)
  async cryptoToFiat(
    @Body() paymentDto: PaymentDto,
    @Req() req: { user: LoginResponseDto },
  ) {
    return this.paymentsService.cryptoToFiat(paymentDto, req?.user.customer_id);
  }

  @Post('transfer')
  @UseGuards(BasicAuthGuard)
  async transfer(
    @Body() transferDto: TransferDto,
    @Req() req: { user: LoginResponseDto },
  ) {
    return this.paymentsService.transfer(transferDto, req?.user.customer_id);
  }
}
