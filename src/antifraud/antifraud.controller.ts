import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { TariffCategory } from '@prisma/client';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import {
  UpdateRuleDto,
  AntiFraudRuleDto,
  SimpleOkDto,
} from './dto/antifraud.dtos';
import {
  AntifraudCasesListDto,
  AntifraudCasesListResponseDto,
} from './dto/antifraud-cases-list.dto';
import { AntiFraudService } from './antifraud.service';

@ApiTags('Антифрод')
@ApiBearerAuth('Bearer')
@UseGuards(AdminAuthGuard)
@Controller('antifraud')
export class AntiFraudController {
  constructor(private readonly antiFraud: AntiFraudService) {}

  @Get('rules')
  @ApiQuery({
    name: 'category',
    required: false,
    enum: ['K1', 'K2', 'K3', 'K4', 'K5', 'K6'],
    description: 'Категория финконтроля',
  })
  @ApiOperation({
    summary: 'Список правил антифрода',
    description: 'Возвращает все правила с текущими параметрами',
  })
  @ApiOkResponse({ type: [AntiFraudRuleDto] })
  async listRules(@Query('category') category?: string) {
    return this.antiFraud.listRules(category as TariffCategory | undefined);
  }

  @Put('rules/:key')
  @ApiQuery({
    name: 'category',
    required: false,
    enum: ['K1', 'K2', 'K3', 'K4', 'K5', 'K6'],
    description: 'Категория финконтроля',
  })
  @ApiOperation({
    summary: 'Обновить параметры правила',
    description: 'Частичное обновление полей правила по ключу',
  })
  @ApiParam({
    name: 'key',
    description: 'Ключ правила',
    required: true,
    enum: [
      'FIAT_ANY_GE_1M',
      'ONE_TIME_GE_8M',
      'FREQUENT_OPS_3_30D_EACH_GE_100K',
      'WITHDRAW_AFTER_LARGE_INFLOW',
      'SPLITTING_TOTAL_14D_GE_1M',
      'THIRD_PARTY_DEPOSITS_3_30D_TOTAL_GE_1M',
      'AFTER_INACTIVITY_6M',
      'MANY_SENDERS_TO_ONE_10_PER_MONTH',
    ],
  })
  @ApiOkResponse({ type: AntiFraudRuleDto })
  async updateRule(
    @Param('key')
    key:
      | 'FIAT_ANY_GE_1M'
      | 'ONE_TIME_GE_8M'
      | 'FREQUENT_OPS_3_30D_EACH_GE_100K'
      | 'WITHDRAW_AFTER_LARGE_INFLOW'
      | 'SPLITTING_TOTAL_14D_GE_1M'
      | 'THIRD_PARTY_DEPOSITS_3_30D_TOTAL_GE_1M'
      | 'AFTER_INACTIVITY_6M'
      | 'MANY_SENDERS_TO_ONE_10_PER_MONTH',
    @Body() dto: UpdateRuleDto,
    @Query('category') category?: string,
  ) {
    return this.antiFraud.updateRule(
      (category as TariffCategory | undefined) || 'K1',
      key,
      dto,
    );
  }

  @Get('cases')
  @ApiOperation({
    summary: 'Список кейсов',
    description: 'Фильтрация/сортировка/пагинация идентичны /transactions/list',
  })
  @ApiOkResponse({ type: AntifraudCasesListResponseDto })
  async cases(
    @Query() query: AntifraudCasesListDto,
  ): Promise<AntifraudCasesListResponseDto> {
    return this.antiFraud.listCases(query);
  }

  @Patch('cases/:id/approve')
  @ApiOperation({
    summary: 'Одобрить кейс',
    description:
      'Помечает кейс APPROVED и влияет только на последующие идентичные операции; исходная транзакция остаётся REJECTED',
  })
  @ApiParam({
    name: 'id',
    description: 'ID кейса',
    required: true,
    example: 10,
  })
  @ApiOkResponse({ type: SimpleOkDto })
  async approve(@Param('id') id: string) {
    return this.antiFraud.adminApprove(Number(id));
  }

  @Patch('cases/:id/reject')
  @ApiOperation({
    summary: 'Отклонить кейс',
    description:
      'Помечает кейс REJECTED; никаких финансовых операций не происходит',
  })
  @ApiParam({
    name: 'id',
    description: 'ID кейса',
    required: true,
    example: 10,
  })
  @ApiOkResponse({ type: SimpleOkDto })
  async reject(@Param('id') id: string) {
    return this.antiFraud.adminReject(Number(id));
  }
}
