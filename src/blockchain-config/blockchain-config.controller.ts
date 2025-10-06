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
    const s = await this.settingsService.get();
    return {
      esom_per_usd: s.esom_per_usd.toString(),
      esom_som_conversion_fee_pct: s.esom_som_conversion_fee_pct.toString(),
      btc_trade_fee_pct: s.btc_trade_fee_pct.toString(),
      eth_trade_fee_pct: s.eth_trade_fee_pct.toString(),
      usdt_trade_fee_pct: s.usdt_trade_fee_pct.toString(),
      btc_withdraw_fee_fixed: s.btc_withdraw_fee_fixed.toString(),
      eth_withdraw_fee_fixed: s.eth_withdraw_fee_fixed.toString(),
      usdt_withdraw_fee_fixed: s.usdt_withdraw_fee_fixed.toString(),
      min_withdraw_btc: s.min_withdraw_btc.toString(),
      min_withdraw_eth: s.min_withdraw_eth.toString(),
      min_withdraw_usdt_trc20: s.min_withdraw_usdt_trc20.toString(),
    };
  }

  @Put('settings')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Обновить настройки системы' })
  @ApiResponse({ status: 200, type: SettingsDto })
  async updateSettings(@Body() dto: SettingsPartialDto): Promise<SettingsDto> {
    const s = await this.settingsService.update(dto);
    return {
      esom_per_usd: s.esom_per_usd.toString(),
      esom_som_conversion_fee_pct: s.esom_som_conversion_fee_pct.toString(),
      btc_trade_fee_pct: s.btc_trade_fee_pct.toString(),
      eth_trade_fee_pct: s.eth_trade_fee_pct.toString(),
      usdt_trade_fee_pct: s.usdt_trade_fee_pct.toString(),
      btc_withdraw_fee_fixed: s.btc_withdraw_fee_fixed.toString(),
      eth_withdraw_fee_fixed: s.eth_withdraw_fee_fixed.toString(),
      usdt_withdraw_fee_fixed: s.usdt_withdraw_fee_fixed.toString(),
      min_withdraw_btc: s.min_withdraw_btc.toString(),
      min_withdraw_eth: s.min_withdraw_eth.toString(),
      min_withdraw_usdt_trc20: s.min_withdraw_usdt_trc20.toString(),
    };
  }
}
