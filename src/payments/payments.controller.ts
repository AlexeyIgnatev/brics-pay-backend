import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TransferDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';
import { BasicAuthGuard } from 'src/common/guards/basic-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { UserInfoDto } from '../users/dto/user-info.dto';
import { GetTransactions } from './dto/get-transactions.dto';
import { TransactionDto } from './dto/transaction.dto';
import { StatusOKDto } from '../common/dto/status.dto';
import { ConvertDto } from './dto/convert.dto';
import {
  TransactionReceiptDto,
  TransactionReceiptRequestDto,
} from './dto/transaction-receipt.dto';
import { SettingsService } from '../config/settings/settings.service';
import { PaymentFeeDto } from './dto/payment-fee.dto';
import { UsdtDepositWebhookDto } from './dto/usdt-deposit.dto';
import { UsdtTreasuryOrchestratorService } from './usdt-treasury-orchestrator.service';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import { BrowserWalletTransferDto } from './dto/browser-wallet-transfer.dto';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly settingsService: SettingsService,
    private readonly usdtTreasuryOrchestrator: UsdtTreasuryOrchestratorService,
  ) {}

  @Post('browser-wallet/transfer')
  @ApiBearerAuth('Bearer')
  @UseGuards(AdminAuthGuard)
  async browserWalletTransfer(
    @Body() dto: BrowserWalletTransferDto,
  ): Promise<StatusOKDto> {
    return this.paymentsService.transfer(
      {
        amount: dto.amount,
        address: dto.address,
        currency: dto.currency,
        idempotency_key: dto.idempotency_key,
      },
      dto.customer_id,
    );
  }

  @Post('transfer')
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async transfer(
    @Body() transferDto: TransferDto,
    @Req() req: { user: UserInfoDto },
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ): Promise<StatusOKDto> {
    if (idempotencyKey) {
      transferDto.idempotency_key = idempotencyKey;
    }
    return this.paymentsService.transfer(transferDto, req?.user.customer_id);
  }

  @Get('fees')
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async getFees(@Req() req: { user: UserInfoDto }): Promise<PaymentFeeDto[]> {
    return this.settingsService.getTariffs();
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
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString(
          'utf-8',
        );
        const separatorIndex = decoded.indexOf(':');
        if (separatorIndex > 0) {
          authContext = {
            username: decoded.slice(0, separatorIndex),
            password: decoded.slice(separatorIndex + 1),
          };
        }
      } catch {}
    }

    return this.paymentsService.convert(
      dto,
      req?.user.customer_id,
      authContext,
    );
  }

  @Post('history')
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async getHistory(
    @Body() getTransactions: GetTransactions,
    @Req() req: { user: UserInfoDto },
  ): Promise<TransactionDto[]> {
    return this.paymentsService.getHistory(
      getTransactions,
      req?.user.customer_id,
    );
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

  @Post('usdt/deposit-webhook')
  async usdtDepositWebhook(
    @Body() dto: UsdtDepositWebhookDto,
    @Headers('x-webhook-secret') webhookSecret?: string,
  ): Promise<StatusOKDto> {
    return this.usdtTreasuryOrchestrator.handleUsdtDepositWebhook(
      dto,
      webhookSecret,
    );
  }

  @Post('usdt/reconcile')
  async reconcileUsdtTreasury(): Promise<StatusOKDto> {
    return this.usdtTreasuryOrchestrator.reconcileUsdtOperations();
  }
}
