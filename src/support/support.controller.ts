import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BasicAuthGuard } from '../common/guards/basic-auth.guard';
import { PaginateParams } from '../common/params/pagination.params';
import { UserInfoDto } from '../users/dto/user-info.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SupportMessageDto } from './dto/support-message.dto';
import { SupportService } from './support.service';

@Controller(['support', 'api/support'])
@ApiTags('Support')
@ApiBearerAuth('Basic')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('message')
  @UseGuards(BasicAuthGuard)
  async getMessages(
    @Query() pagination: PaginateParams,
    @Req() req: { user: UserInfoDto },
  ): Promise<SupportMessageDto[]> {
    return this.supportService.getSupportMessages(
      req.user.customer_id,
      pagination.take ?? 40,
      pagination.skip ?? 0,
    );
  }

  @Post('message')
  @UseGuards(BasicAuthGuard)
  async sendMessage(
    @Body() dto: SendMessageDto,
    @Req() req: { user: UserInfoDto },
  ): Promise<SupportMessageDto> {
    return this.supportService.sendMessage(req.user.customer_id, dto.text);
  }
}

