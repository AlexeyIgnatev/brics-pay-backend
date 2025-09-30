import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import { TransactionsListDto } from './dto/transactions-list.dto';

@ApiTags('Транзакции пользователей')
@ApiBearerAuth('Bearer')
@Controller('transactions')
@UseGuards(AdminAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get('list')
  @ApiOperation({ summary: 'Список всех операций с фильтрами/сортировкой/пагинацией' })
  async list(@Query() query: TransactionsListDto) {
    return this.transactionsService.list(query);
  }

  @Get('stats/today')
  @ApiOperation({ summary: 'Статистика за сегодня' })
  async statsToday() {
    return this.transactionsService.statsToday();
  }
}

