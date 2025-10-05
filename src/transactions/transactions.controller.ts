import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import { TransactionsListDto } from './dto/transactions-list.dto';
import { TransactionsListResponseDto } from './dto/transactions-list.dto';
import { TransactionsStatsQueryDto, TransactionsStatsResponseDto, TransactionsStatsTodayDto } from './dto/transactions-stats.dto';

@ApiTags('Транзакции пользователей')
@ApiBearerAuth('Bearer')
@Controller('transactions')
@UseGuards(AdminAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get('list')
  @ApiOperation({ summary: 'Список всех операций с фильтрами/сортировкой/пагинацией' })
  @ApiOkResponse({ type: TransactionsListResponseDto })
  async list(@Query() query: TransactionsListDto): Promise<TransactionsListResponseDto> {
    return this.transactionsService.list(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Статистика транзакций с фильтрами/группировкой' })
  @ApiOkResponse({ type: TransactionsStatsResponseDto })
  async stats(@Query() query: TransactionsStatsQueryDto): Promise<TransactionsStatsResponseDto> {
    return this.transactionsService.stats(query);
  }

  @Get('stats/today')
  @ApiOperation({ summary: 'Статистика за сегодня' })
  @ApiOkResponse({ type: TransactionsStatsTodayDto })
  async statsToday(): Promise<TransactionsStatsTodayDto> {
    return this.transactionsService.statsToday();
  }
}

