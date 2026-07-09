import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SettingsService } from '../config/settings/settings.service';
import { SettingsDto } from './dto/settings.dto';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import { SettingsPartialDto } from './dto/settings-partial.dto';
import { AdminSettingsDto } from './dto/admin-settings.dto';
import { AdminSettingsPartialDto } from './dto/admin-settings-partial.dto';
import {
  TariffSettingDto,
  TariffSettingsUpdateDto,
} from './dto/tariff-settings.dto';
import { TreasuryReservesDto } from './dto/reserves.dto';
import { UsdtTreasuryOrchestratorService } from '../payments/usdt-treasury-orchestrator.service';
import { BankCommissionBalancesDto } from './dto/bank-commission-balances.dto';

@ApiTags('Конфигурация блокчейна')
@Controller('blockchain-config')
export class BlockchainConfigController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly usdtTreasuryOrchestrator: UsdtTreasuryOrchestratorService,
  ) {}

  @Get('settings')
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

  @Get('admin-settings')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Получить расширенные admin-настройки' })
  @ApiResponse({ status: 200, type: AdminSettingsDto })
  async getAdminSettings(): Promise<AdminSettingsDto> {
    return await this.settingsService.getAdmin();
  }

  @Put('admin-settings')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Обновить расширенные admin-настройки' })
  @ApiResponse({ status: 200, type: AdminSettingsDto })
  async updateAdminSettings(
    @Body() dto: AdminSettingsPartialDto,
  ): Promise<AdminSettingsDto> {
    return await this.settingsService.updateAdmin(dto);
  }

  @Get('tariffs')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Получить тарифную сетку клиентов' })
  @ApiResponse({ status: 200, type: [TariffSettingDto] })
  async getTariffs(): Promise<TariffSettingDto[]> {
    return await this.settingsService.getTariffs();
  }

  @Put('tariffs')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Обновить тарифную сетку клиентов' })
  @ApiResponse({ status: 200, type: [TariffSettingDto] })
  async updateTariffs(
    @Body() dto: TariffSettingsUpdateDto,
  ): Promise<TariffSettingDto[]> {
    return await this.settingsService.updateTariffs(dto);
  }

  @Get('reserves')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Получить резервы treasury и расход TRON-ресурсов' })
  @ApiResponse({ status: 200, type: TreasuryReservesDto })
  async getReserves(): Promise<TreasuryReservesDto> {
    return this.usdtTreasuryOrchestrator.getTreasuryReserveSnapshot();
  }

  @Get('bank-commission-balances')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({
    summary: 'Получить живые балансы счетов и кошельков для раздела Комиссии банка',
  })
  @ApiResponse({ status: 200, type: BankCommissionBalancesDto })
  async getBankCommissionBalances(): Promise<BankCommissionBalancesDto> {
    return this.settingsService.getBankCommissionBalances();
  }
}
