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
import { TransactionReceiptDto, TransactionReceiptRequestDto } from './dto/transaction-receipt.dto';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
  ) {
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
    @Req() req: { user: UserInfoDto; headers?: { authorization?: string } },
  ): Promise<StatusOKDto> {
    const authHeader = req?.headers?.authorization;
    let authContext: { username?: string; password?: string } | undefined;
    if (authHeader?.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
        const separatorIndex = decoded.indexOf(':');
        if (separatorIndex > 0) {
          authContext = {
            username: decoded.slice(0, separatorIndex),
            password: decoded.slice(separatorIndex + 1),
          };
        }
      } catch {
        // Ignore parse errors: guard already validated credentials.
      }
    }

    return this.paymentsService.convert(dto, req?.user.customer_id, authContext);
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

  @Post('receipt')
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async getReceipt(
    @Body() dto: TransactionReceiptRequestDto,
    @Req() req: { user: UserInfoDto },
  ): Promise<TransactionReceiptDto> {
    return this.paymentsService.getReceipt(dto, req?.user.customer_id);
  }
}
