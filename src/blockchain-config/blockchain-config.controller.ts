import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBasicAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BlockchainConfigDto } from './dto/blockchain-config.dto';
import { UpdateCommissionDto } from './dto/update-commission.dto';
import { UpdateBlockchainStatusDto } from './dto/update-blockchain-status.dto';

@ApiTags('Конфигурация блокчейна')
@ApiBasicAuth()
@Controller('blockchain-config')
export class BlockchainConfigController {
  @Get()
  @ApiOperation({
    summary: 'Получить текущую конфигурацию блокчейна',
    description: 'Возвращает текущий процент комиссии и статус транзакций в блокчейне.',
  })
  @ApiResponse({ status: 200, type: BlockchainConfigDto })
  async getConfig(): Promise<BlockchainConfigDto> {
    return Promise.resolve({
      commission_percent: 1.5,
      blockchain_status: 'AVAILABLE',
    });
  }

  @Patch('commission')
  @ApiOperation({
    summary: 'Изменить процент комиссии',
    description: 'Изменяет текущий процент комиссии за перевод между кошельком и банковским счетом.',
  })
  @ApiResponse({ status: 200, type: BlockchainConfigDto, description: 'Обновлённая конфигурация' })
  async updateCommission(
    @Body() dto: UpdateCommissionDto,
  ): Promise<BlockchainConfigDto> {
    return Promise.resolve({
      commission_percent: dto.commission_percent,
      blockchain_status: 'AVAILABLE',
    });
  }

  @Patch('blockchain-status')
  @ApiOperation({
    summary: 'Изменить статус транзакций в блокчейне',
    description: 'Изменяет статус транзакций в блокчейне (доступны/приостановлены).',
  })
  @ApiResponse({ status: 200, type: BlockchainConfigDto, description: 'Обновлённая конфигурация' })
  async updateStatus(
    @Body() dto: UpdateBlockchainStatusDto,
  ): Promise<BlockchainConfigDto> {
    return Promise.resolve({
      commission_percent: 1.5,
      blockchain_status: dto.blockchain_status,
    });
  }
}