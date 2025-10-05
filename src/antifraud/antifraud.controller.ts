import { Body, Controller, Get, Param, Patch, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaClient } from '@prisma/client';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import { UpdateRuleDto } from './dto/antifraud.dtos';

@ApiTags('Антифрод')
@ApiBearerAuth('Bearer')
@UseGuards(AdminAuthGuard)
@Controller('antifraud')
export class AntiFraudController {
  constructor(private readonly prisma: PrismaClient) {}

  @Get('rules')
  @ApiOperation({ summary: 'Список правил' })
  async listRules() {
    return this.prisma.antiFraudRule.findMany({ orderBy: { key: 'asc' } });
  }

  @Put('rules/:key')
  @ApiOperation({ summary: 'Обновить параметры правила' })
  async updateRule(@Param('key') key: string, @Body() dto: UpdateRuleDto) {
    return this.prisma.antiFraudRule.update({ where: { key: key as any }, data: dto as any });
  }

  @Get('cases')
  @ApiOperation({ summary: 'Открытые случаи антифрода' })
  async cases() {
    return this.prisma.antiFraudCase.findMany({ where: { status: 'OPEN' as any }, include: { transaction: true } });
  }

  @Patch('cases/:id/approve')
  @ApiOperation({ summary: 'Одобрить транзакцию (завершить) и закрыть случай' })
  async approve(@Param('id') id: string) {
    const c = await this.prisma.antiFraudCase.findUnique({ where: { id: Number(id) }, include: { transaction: true } });
    if (!c) return null;
    await this.prisma.$transaction([
      this.prisma.transaction.update({ where: { id: c.transaction_id }, data: { status: 'SUCCESS' as any } }),
      this.prisma.antiFraudCase.update({ where: { id: c.id }, data: { status: 'APPROVED' as any } }),
    ]);
    return { ok: true };
  }

  @Patch('cases/:id/reject')
  @ApiOperation({ summary: 'Отклонить транзакцию и закрыть случай; откатить списание' })
  async reject(@Param('id') id: string) {
    const c = await this.prisma.antiFraudCase.findUnique({ where: { id: Number(id) }, include: { transaction: true } });
    if (!c) return null;
    // NOTE: Возврат средств должен производиться в рамках вашей бизнес-логики балансов. Здесь только маркируем.
    await this.prisma.$transaction([
      this.prisma.transaction.update({ where: { id: c.transaction_id }, data: { status: 'REJECTED' as any } }),
      this.prisma.antiFraudCase.update({ where: { id: c.id }, data: { status: 'REJECTED' as any } }),
    ]);
    return { ok: true };
  }
}
