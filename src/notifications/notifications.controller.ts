import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import { NotificationsService } from './notifications.service';
import { NotificationDto } from './dto/notification.dto';
import { PaginateParams } from '../common/params/pagination.params';
import { BasicAuthGuard } from '../common/guards/basic-auth.guard';
import { UserInfoDto } from '../users/dto/user-info.dto';
import { SendFinancialReportRequestDto, SendFinancialReportResponseDto } from './dto/financial-report.dto';
import { PushDataPayloadDto, TestPushToTokenDto } from './dto/push-test.dto';

@Controller('notifications')
@ApiTags('Notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {
  }

  @Get()
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async getNotifications(
    @Query() pagination: PaginateParams,
    @Req() req: { user: UserInfoDto },
  ): Promise<NotificationDto[]> {
    return await this.notificationsService.getNotifications(
      req.user.customer_id,
      pagination.take ?? 10,
      pagination.skip ?? 0,
    );
  }

  @Post('financial-report')
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async sendFinancialReport(
    @Body() body: SendFinancialReportRequestDto,
    @Req() req: { user: UserInfoDto },
  ): Promise<SendFinancialReportResponseDto> {
    return this.notificationsService.sendFinancialReport(body, req.user);
  }

  @Post('push/test/token')
  @ApiBearerAuth('Bearer')
  @UseGuards(AdminAuthGuard)
  async testPushToToken(
    @Body() dto: TestPushToTokenDto,
  ) {
    return this.notificationsService.sendTestPushToToken(dto);
  }

  @Post('push/test/customer/:customerId')
  @ApiBearerAuth('Bearer')
  @UseGuards(AdminAuthGuard)
  async testPushToCustomer(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: PushDataPayloadDto,
  ) {
    return this.notificationsService.sendTestPushToCustomer(customerId, dto);
  }
}
