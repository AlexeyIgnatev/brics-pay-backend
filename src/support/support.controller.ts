import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SupportTicketStatus } from '@prisma/client';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import { BasicAuthGuard } from '../common/guards/basic-auth.guard';
import { PaginateParams } from '../common/params/pagination.params';
import { UserInfoDto } from '../users/dto/user-info.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SupportMessageDto } from './dto/support-message.dto';
import { SupportTicketDto, SupportTicketsListDto } from './dto/support-ticket.dto';
import { SupportTicketsQueryDto } from './dto/support-ticket-query.dto';
import { SupportService } from './support.service';

@Controller(['support', 'api/support'])
@ApiTags('Support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('history')
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async getHistory(
    @Query() pagination: PaginateParams,
    @Req() req: { user: UserInfoDto },
  ): Promise<SupportMessageDto[]> {
    return this.supportService.getSupportHistory(
      req.user.customer_id,
      pagination.take ?? 200,
      pagination.skip ?? 0,
    );
  }

  @Post('message')
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async sendMessage(
    @Body() dto: SendMessageDto,
    @Req() req: { user: UserInfoDto },
  ): Promise<SupportMessageDto> {
    return this.supportService.sendMessage(req.user.customer_id, dto.text);
  }

  @Get('admin/tickets')
  @ApiBearerAuth('Bearer')
  @UseGuards(AdminAuthGuard)
  async listAdminTickets(
    @Query() query: SupportTicketsQueryDto,
  ): Promise<SupportTicketsListDto> {
    return this.supportService.listTickets(
      query.status as SupportTicketStatus | undefined,
      query.offset ?? 0,
      query.limit ?? 20,
    );
  }

  @Get('admin/tickets/:id/messages')
  @ApiBearerAuth('Bearer')
  @UseGuards(AdminAuthGuard)
  async getAdminTicketMessages(
    @Param('id', ParseIntPipe) ticketId: number,
  ): Promise<SupportMessageDto[]> {
    return this.supportService.getTicketMessages(ticketId);
  }

  @Post('admin/tickets/:id/messages')
  @ApiBearerAuth('Bearer')
  @UseGuards(AdminAuthGuard)
  async sendAdminTicketMessage(
    @Param('id', ParseIntPipe) ticketId: number,
    @Body() dto: SendMessageDto,
    @Req() req: { admin: { id: number } },
  ): Promise<SupportMessageDto> {
    return this.supportService.replyToTicket(ticketId, Number(req.admin.id), dto.text);
  }

  @Patch('admin/tickets/:id/close')
  @ApiBearerAuth('Bearer')
  @UseGuards(AdminAuthGuard)
  async closeAdminTicket(
    @Param('id', ParseIntPipe) ticketId: number,
    @Req() req: { admin: { id: number } },
  ): Promise<SupportTicketDto> {
    return this.supportService.closeTicket(ticketId, Number(req.admin.id));
  }
}
