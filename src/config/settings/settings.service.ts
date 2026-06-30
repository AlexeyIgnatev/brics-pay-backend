import { Injectable, Logger } from '@nestjs/common';
import {
  CustomerResidency,
  PrismaClient,
  TariffCategory,
  TariffOperation,
} from '@prisma/client';
import { SettingsPartialDto } from '../../blockchain-config/dto/settings-partial.dto';
import { SettingsDto } from '../../blockchain-config/dto/settings.dto';
import {
  TariffSettingDto,
  TariffSettingsUpdateDto,
} from '../../blockchain-config/dto/tariff-settings.dto';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaClient) {}

  private readonly tariffCategories = Object.values(TariffCategory);
  private readonly tariffResidencies = Object.values(CustomerResidency);
  private readonly tariffOperations = Object.values(TariffOperation);

  private async getOrCreateSettingsRow() {
    let s = await this.prisma.settings.findUnique({ where: { id: 1 } });
    if (!s) {
      s = await this.prisma.settings.findFirst({ orderBy: { id: 'asc' } });
    }
    if (!s) {
      s = await this.prisma.settings.create({
        data: {
          id: 1,
          esom_per_usd: '1',
          esom_som_conversion_fee_pct: '0',
          esom_som_conversion_fee_min: '0',
          btc_trade_fee_pct: '0.5',
          eth_trade_fee_pct: '0.5',
          usdt_trade_fee_pct: '0.2',
          btc_withdraw_fee_fixed: '0.0002',
          eth_withdraw_fee_fixed: '0.003',
          usdt_withdraw_fee_fixed: '10',
          min_withdraw_btc: '0.0002',
          min_withdraw_eth: '0.003',
          min_withdraw_usdt_trc20: '10',
        },
      });
    }
    return s;
  }

  async get(): Promise<SettingsDto> {
    const s = await this.getOrCreateSettingsRow();
    return this.mapToDto(s);
  }

  async update(partial: SettingsPartialDto): Promise<SettingsDto> {
    const current = await this.getOrCreateSettingsRow();

    this.logger.debug(`Update settings ${JSON.stringify(partial, null, 2)}`);
    const s = await this.prisma.settings.update({
      where: { id: current.id },
      data: partial,
    });

    return this.mapToDto(s);
  }

  mapToDto(s: any): SettingsDto {
    return {
      esom_per_usd: s.esom_per_usd.toString(),
      esom_som_conversion_fee_pct: s.esom_som_conversion_fee_pct.toString(),
      esom_som_conversion_fee_min: s.esom_som_conversion_fee_min.toString(),
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

  async getTariffs(): Promise<TariffSettingDto[]> {
    await this.ensureTariffRows();
    const rows = await this.prisma.tariffSetting.findMany({
      orderBy: [
        { category: 'asc' },
        { residency: 'asc' },
        { operation: 'asc' },
      ],
    });
    return rows.map((row) => ({
      category: row.category,
      residency: row.residency,
      operation: row.operation,
      percent_fee: row.percent_fee.toString(),
      fixed_fee: row.fixed_fee.toString(),
    }));
  }

  async updateTariffs(
    dto: TariffSettingsUpdateDto,
  ): Promise<TariffSettingDto[]> {
    await this.ensureTariffRows();
    await this.prisma.$transaction(
      (dto.items || []).map((item) =>
        this.prisma.tariffSetting.upsert({
          where: {
            category_residency_operation: {
              category: item.category,
              residency: item.residency,
              operation: item.operation,
            },
          },
          create: {
            category: item.category,
            residency: item.residency,
            operation: item.operation,
            percent_fee: item.percent_fee,
            fixed_fee: item.fixed_fee,
          },
          update: {
            percent_fee: item.percent_fee,
            fixed_fee: item.fixed_fee,
          },
        }),
      ),
    );
    return this.getTariffs();
  }

  private async ensureTariffRows(): Promise<void> {
    const existing = await this.prisma.tariffSetting.findMany({
      select: { category: true, residency: true, operation: true },
    });
    const seen = new Set(
      existing.map(
        (row) => `${row.category}:${row.residency}:${row.operation}`,
      ),
    );
    const missing: {
      category: TariffCategory;
      residency: CustomerResidency;
      operation: TariffOperation;
      percent_fee: string;
      fixed_fee: string;
    }[] = [];
    for (const category of this.tariffCategories) {
      for (const residency of this.tariffResidencies) {
        for (const operation of this.tariffOperations) {
          const key = `${category}:${residency}:${operation}`;
          if (!seen.has(key)) {
            missing.push({
              category,
              residency,
              operation,
              percent_fee: '0',
              fixed_fee: '0',
            });
          }
        }
      }
    }
    if (missing.length) {
      await this.prisma.tariffSetting.createMany({
        data: missing,
        skipDuplicates: true,
      });
    }
  }
}
