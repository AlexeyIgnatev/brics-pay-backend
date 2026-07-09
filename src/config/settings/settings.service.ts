import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CustomerResidency,
  PrismaClient,
  TariffCategory,
  TariffOperation,
} from '@prisma/client';
import { BricsService } from '../brics/brics.service';
import { EthereumService } from '../ethereum/ethereum.service';
import { TronService } from '../crypto/tron.service';
import { AdminSettingsPartialDto } from '../../blockchain-config/dto/admin-settings-partial.dto';
import { AdminSettingsDto } from '../../blockchain-config/dto/admin-settings.dto';
import {
  BankCommissionBalanceSlotDto,
  BankCommissionBalancesDto,
  BankCommissionGroupBalancesDto,
  BankCommissionPartnerBalancesDto,
} from '../../blockchain-config/dto/bank-commission-balances.dto';
import { SettingsPartialDto } from '../../blockchain-config/dto/settings-partial.dto';
import { SettingsDto } from '../../blockchain-config/dto/settings.dto';
import {
  TariffSettingDto,
  TariffSettingsUpdateDto,
} from '../../blockchain-config/dto/tariff-settings.dto';

const SUPPORTED_TARIFF_OPERATIONS: TariffOperation[] = [
  TariffOperation.SOM_TO_ESOM,
  TariffOperation.ESOM_TO_SOM,
  TariffOperation.WALLET_TRANSFER_ESOM,
  TariffOperation.ESOM_TO_USDT_TRC20,
  TariffOperation.USDT_TRC20_TO_ESOM,
  TariffOperation.WALLET_TRANSFER_USDT_TRC20,
];
const SUPPORTED_TARIFF_OPERATION_SET = new Set<TariffOperation>(
  SUPPORTED_TARIFF_OPERATIONS,
);

type BankCommissionPartnerConfig = {
  id?: string;
  title?: string;
  som_account?: string;
  salam_wallet?: string;
  usdt_wallet?: string;
};

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly configService: ConfigService,
    private readonly bricsService: BricsService,
    private readonly ethereumService: EthereumService,
    private readonly tronService: TronService,
  ) {}

  private readonly tariffCategories = Object.values(TariffCategory);
  private readonly tariffResidencies = Object.values(CustomerResidency);
  private readonly tariffOperations = SUPPORTED_TARIFF_OPERATIONS;

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

  async getAdmin(): Promise<AdminSettingsDto> {
    const s = await this.getOrCreateSettingsRow();
    return this.mapToAdminDto(s);
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

  async updateAdmin(partial: AdminSettingsPartialDto): Promise<AdminSettingsDto> {
    const current = await this.getOrCreateSettingsRow();

    this.logger.debug(
      `Update admin settings ${JSON.stringify(partial, null, 2)}`,
    );
    const s = await this.prisma.settings.update({
      where: { id: current.id },
      data: partial,
    });

    return this.mapToAdminDto(s);
  }

  mapToDto(s: any): SettingsDto {
    return {
      esom_per_usd: s.esom_per_usd.toString(),
      esom_som_conversion_fee_pct: s.esom_som_conversion_fee_pct.toString(),
      esom_som_conversion_fee_min: s.esom_som_conversion_fee_min.toString(),
      usdt_trade_fee_pct: s.usdt_trade_fee_pct.toString(),
      usdt_withdraw_fee_fixed: s.usdt_withdraw_fee_fixed.toString(),
      min_withdraw_usdt_trc20: s.min_withdraw_usdt_trc20.toString(),
    };
  }

  mapToAdminDto(s: any): AdminSettingsDto {
    return {
      ...this.mapToDto(s),
      rates_change_reasons_json: this.normalizeString(
        s.rates_change_reasons_json,
      ),
      bank_fee_posting_time_bishkek: this.normalizeString(
        s.bank_fee_posting_time_bishkek,
      ),
      central_bank_som_account: this.normalizeString(
        s.central_bank_som_account,
      ),
      central_bank_salam_wallet: this.normalizeString(
        s.central_bank_salam_wallet,
      ),
      central_bank_usdt_wallet: this.normalizeString(
        s.central_bank_usdt_wallet,
      ),
      bank_som_account: this.normalizeString(s.bank_som_account),
      bank_salam_wallet: this.normalizeString(s.bank_salam_wallet),
      bank_usdt_wallet: this.normalizeString(s.bank_usdt_wallet),
      bank_commission_partners_json: this.normalizeString(
        s.bank_commission_partners_json,
      ),
    };
  }

  async getBankCommissionBalances(): Promise<BankCommissionBalancesDto> {
    const settings = await this.getOrCreateSettingsRow();
    const partners = this.parsePartnersJson(
      settings.bank_commission_partners_json,
    );

    const [centralBank, bank, partnerBalances] = await Promise.all([
      this.buildGroupBalances({
        som_account: settings.central_bank_som_account,
        salam_wallet: settings.central_bank_salam_wallet,
        usdt_wallet: settings.central_bank_usdt_wallet,
      }),
      this.buildGroupBalances({
        som_account: settings.bank_som_account,
        salam_wallet: settings.bank_salam_wallet,
        usdt_wallet: settings.bank_usdt_wallet,
      }),
      Promise.all(
        partners.map((partner, index) =>
          this.buildPartnerBalances(partner, index),
        ),
      ),
    ]);

    return {
      posting_time_bishkek: this.normalizeString(
        settings.bank_fee_posting_time_bishkek,
      ),
      central_bank: centralBank,
      bank,
      partners: partnerBalances,
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
    return rows
      .filter((row) => SUPPORTED_TARIFF_OPERATION_SET.has(row.operation))
      .map((row) => ({
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
      (dto.items || [])
        .filter((item) => SUPPORTED_TARIFF_OPERATION_SET.has(item.operation))
        .map((item) =>
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

  private normalizeString(value: unknown): string {
    return value == null ? '' : String(value);
  }

  private parsePartnersJson(raw: string | null | undefined): BankCommissionPartnerConfig[] {
    if (!raw?.trim()) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          id:
            typeof item.id === 'string' && item.id.trim()
              ? item.id.trim()
              : undefined,
          title:
            typeof item.title === 'string' && item.title.trim()
              ? item.title.trim()
              : undefined,
          som_account:
            typeof item.som_account === 'string' && item.som_account.trim()
              ? item.som_account.trim()
              : undefined,
          salam_wallet:
            typeof item.salam_wallet === 'string' && item.salam_wallet.trim()
              ? item.salam_wallet.trim()
              : undefined,
          usdt_wallet:
            typeof item.usdt_wallet === 'string' && item.usdt_wallet.trim()
              ? item.usdt_wallet.trim()
              : undefined,
        }))
        .filter(
          (item) =>
            item.title ||
            item.som_account ||
            item.salam_wallet ||
            item.usdt_wallet,
        );
    } catch (error) {
      this.logger.warn(
        `Failed to parse bank_commission_partners_json: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private async buildPartnerBalances(
    partner: BankCommissionPartnerConfig,
    index: number,
  ): Promise<BankCommissionPartnerBalancesDto> {
    const group = await this.buildGroupBalances(partner);
    return {
      id: partner.id || `partner-${index + 1}`,
      title: partner.title || `Партнер ${index + 1}`,
      ...group,
    };
  }

  private async buildGroupBalances(input: {
    som_account?: string | null;
    salam_wallet?: string | null;
    usdt_wallet?: string | null;
  }): Promise<BankCommissionGroupBalancesDto> {
    const [somAccount, salamWallet, usdtWallet] = await Promise.all([
      this.buildBalanceSlot(input.som_account, 'SOM', (value) =>
        this.getSomAccountBalance(value),
      ),
      this.buildBalanceSlot(input.salam_wallet, 'SALAM', (value) =>
        this.getSalamWalletBalance(value),
      ),
      this.buildBalanceSlot(input.usdt_wallet, 'USDT TRC20', (value) =>
        this.getUsdtWalletBalance(value),
      ),
    ]);

    return {
      som_account: somAccount,
      salam_wallet: salamWallet,
      usdt_wallet: usdtWallet,
    };
  }

  private async buildBalanceSlot(
    reference: string | null | undefined,
    asset: string,
    loader: (reference: string) => Promise<number>,
  ): Promise<BankCommissionBalanceSlotDto | null> {
    const normalized = reference?.trim();
    if (!normalized) return null;

    try {
      const balance = await loader(normalized);
      return {
        reference: normalized,
        balance,
        asset,
        error: null,
      };
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to load ${asset} balance for ${normalized}: ${details}`,
      );
      return {
        reference: normalized,
        balance: null,
        asset,
        error: details,
      };
    }
  }

  private async getSomAccountBalance(accountNo: string): Promise<number> {
    const account = await this.bricsService.findAccount(accountNo);
    return Number(account?.Balance ?? 0);
  }

  private async getSalamWalletBalance(address: string): Promise<number> {
    return this.ethereumService.getEsomBalance(address);
  }

  private async getUsdtWalletBalance(address: string): Promise<number> {
    const contractAddress =
      this.configService.get<string>('USDT_TOKEN_ADDRESS') ||
      this.configService.get<string>('TRON_USDT_CONTRACT');
    if (!contractAddress?.trim()) {
      throw new Error('USDT token contract is not configured');
    }
    return this.tronService.getTrc20Balance(address, contractAddress.trim());
  }
}
