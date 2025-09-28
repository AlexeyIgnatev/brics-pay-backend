import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
/* NOTE: This controller previously contained mock endpoints. 
   It will be gradually migrated to real data service with Prisma-backed Transaction model.
*/

import { ApiBasicAuth, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';

@ApiTags('Транзакции пользователей')
@ApiBearerAuth('Bearer')
@Controller('transactions')
@UseGuards(AdminAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}


  // New endpoints
  @Get('list')
  @ApiOperation({ summary: 'Список всех операций с фильтрами/сортировкой/пагинацией' })
  async list(
    @Query('kind') kind?: string | string[],
    @Query('status') status?: string | string[],
    @Query('asset') asset?: string | string[],
    @Query('date_from') date_from?: string,
    @Query('date_to') date_to?: string,
    @Query('amount_min') amount_min?: string,
    @Query('amount_max') amount_max?: string,
    @Query('id') id?: string,
    @Query('tx_hash') tx_hash?: string,
    @Query('sender') sender?: string,
    @Query('receiver') receiver?: string,
    @Query('sort_by') sort_by?: string,
    @Query('sort_dir') sort_dir?: 'asc' | 'desc',
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const toArray = (v?: string | string[]) => (v == null ? undefined : Array.isArray(v) ? v : [v]);
    const q = {
      kind: toArray(kind) as any,
      status: toArray(status) as any,
      asset: toArray(asset) as any,
      date_from,
      date_to,
      amount_min: amount_min ? Number(amount_min) : undefined,
      amount_max: amount_max ? Number(amount_max) : undefined,
      id: id ? Number(id) : undefined,
      tx_hash,
      sender,
      receiver,
      sort_by: (sort_by as any) ?? 'createdAt',
      sort_dir: sort_dir ?? 'desc',
      offset: offset ? Number(offset) : 0,
      limit: limit ? Number(limit) : 20,
    };
    return this.transactionsService.list(q);
  }

  @Get('stats/today')
  @ApiOperation({ summary: 'Статистика за сегодня' })
  async statsToday() {
    return this.transactionsService.statsToday();
  }

  // legacy mock endpoints removed
}

