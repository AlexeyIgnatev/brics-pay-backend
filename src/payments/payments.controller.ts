import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { PaymentDto, TransferDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';
import { BasicAuthGuard } from 'src/common/guards/basic-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { UserInfoDto } from '../users/dto/user-info.dto';
import { GetTransactions } from './dto/get-transactions.dto';
import { TransactionDto } from './dto/transaction.dto';
import { StatusOKDto } from '../common/dto/status.dto';
import { ConvertDto } from './dto/convert.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {
  }

  @Post('fiat-to-crypto')
  @UseGuards(BasicAuthGuard)
  @ApiBearerAuth('Basic')
  async fiatToCrypto(
    @Body() paymentDto: PaymentDto,
    @Req() req: { user: UserInfoDto },
  ): Promise<StatusOKDto>  {
    return this.paymentsService.fiatToCrypto(paymentDto, req?.user.customer_id);
  }

  @Post('crypto-to-fiat')
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async cryptoToFiat(
    @Body() paymentDto: PaymentDto,
    @Req() req: { user: UserInfoDto },
  ): Promise<StatusOKDto>  {
    return this.paymentsService.cryptoToFiat(paymentDto, req?.user.customer_id);
  }

  @Post('transfer')
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async transfer(
    @Body() transferDto: TransferDto,
    @Req() req: { user: UserInfoDto },
  ): Promise<StatusOKDto> {
    return this.paymentsService.transfer(transferDto, req?.user.customer_id);
  }

  @Post('convert')
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async convert(
    @Body() dto: ConvertDto,
    @Req() req: { user: UserInfoDto },
  ): Promise<StatusOKDto>  {
    return this.paymentsService.convert(dto, req?.user.customer_id);
  }


  @Post('history')
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async getHistory(
    @Body() getTransactions: GetTransactions,
    @Req() req: { user: UserInfoDto },
  ): Promise<TransactionDto[]> {
    return this.paymentsService.getHistory(getTransactions, req?.user.customer_id);
  }
}
