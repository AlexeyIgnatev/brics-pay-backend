import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SettingsService } from '../config/settings/settings.service';
import { SettingsDto } from './dto/settings.dto';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import { SettingsPartialDto } from './dto/settings-partial.dto';

@ApiTags('Конфигурация блокчейна')
@Controller('blockchain-config')
export class BlockchainConfigController {
  constructor(private readonly settingsService: SettingsService) {
  }

  @Get('settings')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Получить текущие настройки системы' })
  @ApiResponse({ status: 200, type: SettingsDto })
  async getSettings(): Promise<SettingsDto> {
    return await this.settingsService.get();
  }

  @Put('settings')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Обновить настройки системы' })
  @ApiResponse({ status: 200, type: SettingsDto })
  async updateSettings(@Body() dto: SettingsPartialDto): Promise<SettingsDto> {
    return await this.settingsService.update(dto);
  }
}
