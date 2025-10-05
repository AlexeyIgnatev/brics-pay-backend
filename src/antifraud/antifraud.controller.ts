import { Body, Controller, Get, Param, Patch, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Asset, PrismaClient } from '@prisma/client';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import { UpdateRuleDto } from './dto/antifraud.dtos';
import { BricsService } from '../config/brics/brics.service';

@ApiTags('Антифрод')
@ApiBearerAuth('Bearer')
@UseGuards(AdminAuthGuard)
@Controller('antifraud')
export class AntiFraudController {
  constructor(private readonly prisma: PrismaClient, private readonly brics: BricsService) {}

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
    const t = c.transaction;
    // выполнить реальный перевод через БРИКС, если это банковская операция
    let bankId: number | null = t.bank_op_id ?? null;
    if (t.kind === 'BANK_TO_BANK' && t.status === 'PENDING' && !t.bank_op_id) {
      bankId = await this.brics.createTransferFiatToFiat(Number(t.amount_out), (t.sender_customer_id as any).toString(), (t.receiver_customer_id as any).toString());
    }
    await this.prisma.$transaction([
      this.prisma.transaction.update({ where: { id: c.transaction_id }, data: { status: 'SUCCESS' as any, bank_op_id: bankId ?? undefined } }),
      this.prisma.antiFraudCase.update({ where: { id: c.id }, data: { status: 'APPROVED' as any } }),
    ]);
    // начислить получателю, если банковская операция (кэш баланс)
    if (t.kind === 'BANK_TO_BANK') {
      await this.prisma.userAssetBalance.upsert({
        where: { customer_id_asset: { customer_id: t.receiver_customer_id!, asset: 'SOM' as Asset } },
        create: { customer_id: t.receiver_customer_id!, asset: 'SOM' as Asset, balance: t.amount_out as any },
        update: { balance: { increment: t.amount_out as any } },
      });
    }
    return { ok: true };
  }

  @Patch('cases/:id/reject')
  @ApiOperation({ summary: 'Отклонить транзакцию и закрыть случай; откатить списание' })
  async reject(@Param('id') id: string) {
    const c = await this.prisma.antiFraudCase.findUnique({ where: { id: Number(id) }, include: { transaction: true } });
    if (!c) return null;
    const t = c.transaction;
    // откатить списание у отправителя
    if (t.kind === 'BANK_TO_BANK') {
      await this.prisma.userAssetBalance.upsert({
        where: { customer_id_asset: { customer_id: t.sender_customer_id!, asset: 'SOM' as Asset } },
        create: { customer_id: t.sender_customer_id!, asset: 'SOM' as Asset, balance: t.amount_out as any },
        update: { balance: { increment: t.amount_out as any } },
      });
    }
    await this.prisma.$transaction([
      this.prisma.transaction.update({ where: { id: c.transaction_id }, data: { status: 'REJECTED' as any } }),
      this.prisma.antiFraudCase.update({ where: { id: c.id }, data: { status: 'REJECTED' as any } }),
    ]);
    return { ok: true };
  }
}
