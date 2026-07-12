import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Asset, PrismaClient, TariffOperation } from '@prisma/client';
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

const TEMP_CENTRAL_SOM_ACCOUNT = '910000001';
const TEMP_CENTRAL_SALAM_WALLET = '0x1111111111111111111111111111111111111111';
const TEMP_CENTRAL_USDT_WALLET = 'TH6v4FYhVPEE39oYLd7roSfGj2H49pkRUX';
const TEMP_PARTNER_SOM_ACCOUNT = '910000003';
const TEMP_PARTNER_SALAM_WALLET = '0x3333333333333333333333333333333333333333';
const TEMP_PARTNER_USDT_WALLET = 'TQYvtaMVomk4BFgGPNjnEadrnVaLAqS5Kj';

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
  private readonly usdtBalanceCache = new Map<
    string,
    { balance: number; expiresAt: number }
  >();
  private readonly usdtBalanceCacheTtlMs = 15_000;
  private readonly usdtBalanceFetchTimeoutMs = 2_500;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly configService: ConfigService,
    private readonly bricsService: BricsService,
    private readonly ethereumService: EthereumService,
    private readonly tronService: TronService,
  ) {}

  private getBankCommissionDefaults(): Record<string, string> {
    return {
      central_bank_som_account:
        this.configService.get<string>('CENTRAL_BANK_SOM_ACCOUNT')?.trim() ||
        TEMP_CENTRAL_SOM_ACCOUNT,
      central_bank_salam_wallet:
        this.configService.get<string>('CENTRAL_BANK_SALAM_WALLET')?.trim() ||
        TEMP_CENTRAL_SALAM_WALLET,
      central_bank_usdt_wallet:
        this.configService.get<string>('CENTRAL_BANK_USDT_WALLET')?.trim() ||
        TEMP_CENTRAL_USDT_WALLET,
      bank_som_account:
        this.configService.get<string>('BANK_SOM_ACCOUNT')?.trim() || '',
      bank_salam_wallet:
        this.configService.get<string>('BANK_SALAM_WALLET')?.trim() || '',
      bank_usdt_wallet:
        this.configService.get<string>('BANK_USDT_WALLET')?.trim() ||
        this.tronService.getTreasuryAddress() ||
        '',
      bank_commission_partners_json:
        this.configService.get<string>('BANK_COMMISSION_PARTNERS_JSON')?.trim() ||
        JSON.stringify([
          {
            id: 'partner-1',
            title: 'Partner 1',
            som_account: TEMP_PARTNER_SOM_ACCOUNT,
            salam_wallet: TEMP_PARTNER_SALAM_WALLET,
            usdt_wallet: TEMP_PARTNER_USDT_WALLET,
          },
        ]),
    };
  }

  private async getOrCreateSettingsRow() {
    let s = await this.prisma.settings.findUnique({ where: { id: 1 } });
    if (!s) {
      s = await this.prisma.settings.findFirst({ orderBy: { id: 'asc' } });
    }
    if (!s) {
      const defaults = this.getBankCommissionDefaults();
      const treasuryAddress = this.tronService.getTreasuryAddress() || '';
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
          bank_commission_central_bank_pct: '20',
          bank_commission_bank_pct: '40',
          bank_commission_partners_pct: '40',
          ...defaults,
          bank_usdt_wallet: defaults.bank_usdt_wallet || treasuryAddress || '',
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

  async updateAdmin(
    partial: AdminSettingsPartialDto,
  ): Promise<AdminSettingsDto> {
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
      esom_per_usd: this.toDecimalString(s.esom_per_usd),
      esom_som_conversion_fee_pct: this.toDecimalString(
        s.esom_som_conversion_fee_pct,
      ),
      esom_som_conversion_fee_min: this.toDecimalString(
        s.esom_som_conversion_fee_min,
      ),
      usdt_trade_fee_pct: this.toDecimalString(s.usdt_trade_fee_pct),
      usdt_withdraw_fee_fixed: this.toDecimalString(s.usdt_withdraw_fee_fixed),
      min_withdraw_usdt_trc20: this.toDecimalString(s.min_withdraw_usdt_trc20),
    };
  }

  mapToAdminDto(s: any): AdminSettingsDto {
    const defaults = this.getBankCommissionDefaults();
    const bankSomAccount =
      this.normalizeString(s.bank_som_account) || defaults.bank_som_account;
    const bankSalamWallet =
      this.normalizeString(s.bank_salam_wallet) || defaults.bank_salam_wallet;
    const bankUsdtWallet =
      this.normalizeString(s.bank_usdt_wallet) || defaults.bank_usdt_wallet;
    const centralBankSomAccount =
      this.normalizeString(s.central_bank_som_account) ||
      defaults.central_bank_som_account ||
      TEMP_CENTRAL_SOM_ACCOUNT;
    const centralBankSalamWallet =
      this.normalizeString(s.central_bank_salam_wallet) ||
      defaults.central_bank_salam_wallet ||
      TEMP_CENTRAL_SALAM_WALLET;
    const centralBankUsdtWallet =
      this.normalizeString(s.central_bank_usdt_wallet) ||
      defaults.central_bank_usdt_wallet;
    const partnerJson =
      this.normalizeString(s.bank_commission_partners_json) ||
      defaults.bank_commission_partners_json;

    return {
      ...this.mapToDto(s),
      rates_change_reasons_json: this.normalizeString(
        s.rates_change_reasons_json,
      ),
      bank_fee_posting_time_bishkek: this.normalizeString(
        s.bank_fee_posting_time_bishkek,
      ),
      central_bank_som_account: centralBankSomAccount,
      central_bank_salam_wallet: centralBankSalamWallet,
      central_bank_usdt_wallet: centralBankUsdtWallet,
      bank_commission_central_bank_pct: this.toDecimalString(
        s.bank_commission_central_bank_pct,
        '20',
      ),
      bank_commission_bank_pct: this.toDecimalString(
        s.bank_commission_bank_pct,
        '40',
      ),
      bank_commission_partners_pct: this.toDecimalString(
        s.bank_commission_partners_pct,
        '40',
      ),
      bank_som_account: bankSomAccount,
      bank_salam_wallet: bankSalamWallet,
      bank_usdt_wallet: bankUsdtWallet,
      bank_commission_partners_json: partnerJson,
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
        percent_fee: this.toDecimalString(row.percent_fee),
        fixed_fee: this.toDecimalString(row.fixed_fee),
      }));
  }

  async updateTariffs(
    dto: TariffSettingsUpdateDto,
  ): Promise<TariffSettingDto[]> {
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

  private normalizeString(value: unknown): string {
    return value == null ? '' : String(value);
  }

  private toDecimalString(value: unknown, fallback = '0'): string {
    if (value == null) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : fallback;
    }
    if (typeof value === 'object' && value !== null && 'toString' in value) {
      try {
        return String((value as { toString(): string }).toString());
      } catch {
        return fallback;
      }
    }
    return fallback;
  }

  private parsePartnersJson(
    raw: string | null | undefined,
  ): BankCommissionPartnerConfig[] {
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

  parsePartnersJsonForCommission(
    raw: string | null | undefined,
  ): BankCommissionPartnerConfig[] {
    return this.parsePartnersJson(raw);
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
      const accountingBalance = await this.getAccountingPostingBalance(
        normalized,
        asset,
      );
      const resolvedBalance = accountingBalance.hasActivity
        ? accountingBalance.balance
        : balance;
      return {
        reference: normalized,
        balance: resolvedBalance,
        asset,
        error: null,
      };
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to load ${asset} balance for ${normalized}: ${details}`,
      );
      const accountingBalance = await this.getAccountingPostingBalance(
        normalized,
        asset,
      ).catch(() => ({ balance: null, hasActivity: false }));
      return {
        reference: normalized,
        balance: accountingBalance.balance,
        asset,
        error: details,
      };
    }
  }

  private mapBalanceAsset(asset: string): Asset | null {
    switch (asset) {
      case 'SOM':
        return 'SOM';
      case 'SALAM':
        return 'ESOM';
      case 'USDT TRC20':
        return 'USDT_TRC20';
      default:
        return null;
    }
  }

  private async getAccountingPostingBalance(
    reference: string,
    asset: string,
  ): Promise<{ balance: number; hasActivity: boolean }> {
    const mappedAsset = this.mapBalanceAsset(asset);
    if (!mappedAsset) return { balance: 0, hasActivity: false };

    const [credits, debits, creditCount, debitCount] = await Promise.all([
      this.prisma.accountingPosting.findMany({
        where: {
          asset: mappedAsset,
          credit_account_no: reference,
        },
        select: { amount: true },
      }),
      this.prisma.accountingPosting.findMany({
        where: {
          asset: mappedAsset,
          debit_account_no: reference,
        },
        select: { amount: true },
      }),
      this.prisma.accountingPosting.count({
        where: {
          asset: mappedAsset,
          credit_account_no: reference,
        },
      }),
      this.prisma.accountingPosting.count({
        where: {
          asset: mappedAsset,
          debit_account_no: reference,
        },
      }),
    ]);

    const sum = (rows: { amount: unknown }[]) =>
      rows.reduce((total, row) => {
        const value = Number(row.amount ?? 0);
        return total + (Number.isFinite(value) ? value : 0);
      }, 0);

    const balance = sum(credits) - sum(debits);
    return {
      balance: Number.isFinite(balance) ? balance : 0,
      hasActivity: creditCount + debitCount > 0,
    };
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

    const cacheKey = `${address.trim().toLowerCase()}:${contractAddress.trim().toLowerCase()}`;
    const cached = this.usdtBalanceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.balance;
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('USDT balance lookup timed out')),
        this.usdtBalanceFetchTimeoutMs,
      );
    });

    try {
      const balance = await Promise.race([
        this.tronService.getTrc20Balance(address, contractAddress.trim()),
        timeoutPromise,
      ]);
      this.usdtBalanceCache.set(cacheKey, {
        balance,
        expiresAt: Date.now() + this.usdtBalanceCacheTtlMs,
      });
      return balance;
    } catch (error) {
      if (cached) {
        this.logger.warn(
          `Using cached USDT balance for ${address} after lookup failure: ${error instanceof Error ? error.message : String(error)}`,
        );
        return cached.balance;
      }
      throw error;
    }
  }
}
