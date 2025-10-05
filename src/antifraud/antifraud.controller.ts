import { Body, Controller, Get, Param, Patch, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Asset } from '@prisma/client';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import { UpdateRuleDto } from './dto/antifraud.dtos';
import { BricsService } from '../config/brics/brics.service';
import { AntiFraudService } from './antifraud.service';

@ApiTags('Антифрод')
@ApiBearerAuth('Bearer')
@UseGuards(AdminAuthGuard)
@Controller('antifraud')
export class AntiFraudController {
  constructor(private readonly antiFraud: AntiFraudService, private readonly brics: BricsService) {}

  @Get('rules')
  @ApiOperation({ summary: 'Список правил' })
  async listRules() {
    return this.antiFraud.listRules();
  }

  @Put('rules/:key')
  @ApiOperation({ summary: 'Обновить параметры правила' })
  async updateRule(@Param('key') key: string, @Body() dto: UpdateRuleDto) {
    return this.antiFraud.updateRule(key as any, dto);
  }

  @Get('cases')
  @ApiOperation({ summary: 'Открытые случаи антифрода' })
  async cases() {
    return this.antiFraud.listOpenCases();
  }

  @Patch('cases/:id/approve')
  @ApiOperation({ summary: 'Одобрить транзакцию (для будущих идентичных операций) и закрыть случай' })
  async approve(@Param('id') id: string) {
    return this.antiFraud.adminApprove(Number(id));
  }

  @Patch('cases/:id/reject')
  @ApiOperation({ summary: 'Отклонить транзакцию и закрыть случай (без финансовых операций)' })
  async reject(@Param('id') id: string) {
    return this.antiFraud.adminReject(Number(id));
  }
}
