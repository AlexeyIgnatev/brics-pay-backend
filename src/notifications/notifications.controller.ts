import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { NotificationDto } from './dto/notification.dto';
import { PaginateParams } from '../common/params/pagination.params';
import { BasicAuthGuard } from '../common/guards/basic-auth.guard';
import { UserInfoDto } from '../users/dto/user-info.dto';

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
}
