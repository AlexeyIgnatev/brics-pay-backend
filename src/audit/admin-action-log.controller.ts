import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../config/prisma/prisma.service';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import { AdminActionLogsQueryDto, AdminActionLogsResponseDto } from './dto/admin-action-log.dto';

@ApiTags('Админ-логи')
@ApiBearerAuth('Bearer')
@UseGuards(AdminAuthGuard)
@Controller('audit')
export class AdminActionLogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('admin-actions')
  @ApiOperation({ summary: 'Список действий администраторов', description: 'Пагинация и сортировка. Только для администраторов' })
  @ApiOkResponse({ type: AdminActionLogsResponseDto })
  async list(@Query() query: AdminActionLogsQueryDto): Promise<AdminActionLogsResponseDto> {
    const where: any = {};
    if (query.admin_id != null) where.admin_id = query.admin_id;
    if (query.action_query) where.action = { contains: query.action_query, mode: 'insensitive' };

    const orderBy = { [query.sort_by || 'createdAt']: query.sort_dir || 'desc' } as any;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.adminActionLog.count({ where }),
      this.prisma.adminActionLog.findMany({ where, orderBy, skip: query.offset ?? 0, take: query.limit ?? 20 }),
    ]);

    return { total, offset: query.offset ?? 0, limit: query.limit ?? 20, items };
  }
}
