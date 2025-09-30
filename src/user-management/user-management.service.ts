import { Injectable } from '@nestjs/common';
import { Asset, PrismaClient } from '@prisma/client';
import { UsersListQueryDto, UsersListResponseDto, AdminUpdateUserDto, UsersListItemDto } from './dto/users-list.dto';
import { BybitExchangeService } from '../config/exchange/bybit.service';
import { PriceCacheService } from './price-cache.service';
import { BalanceCacheService, UserAssetBalances } from './balance-cache.service';

@Injectable()
export class UserManagementService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly exchange: BybitExchangeService,
    private readonly priceCache: PriceCacheService,
    private readonly balanceCache: BalanceCacheService,
  ) {}

  private async getUsdPricesCached(): Promise<Record<string, number>> {
    const keys = ['BTC', 'ETH', 'USDT_TRC20'] as const;
    const out: Record<string, number> = {};
    const missing: Asset[] = [] as any;
    for (const k of keys) {
      const v = this.priceCache.get(`USD:${k}`);
      if (v == null) missing.push(k as any as Asset);
      else out[k] = v;
    }
    if (missing.length) {
      const fetched = await this.exchange.getUsdPrices(missing);
      for (const k of missing) {
        const key = k as unknown as string;
        const val = key === 'USDT_TRC20' ? 1 : Number(fetched[key] || 0);
        this.priceCache.set(`USD:${key}`, val);
        out[key] = val;
      }
    }
    // Ensure USDT_TRC20 mapped to 1 if absent
    if (out['USDT_TRC20'] == null) { this.priceCache.set('USD:USDT_TRC20', 1); out['USDT_TRC20'] = 1; }
    return out;
  }

  async list(q: UsersListQueryDto): Promise<UsersListResponseDto> {
    const where: any = {};
    if (q?.status?.length) where.status = { in: q.status };
    if (q?.search) {
      const s = q.search;
      where.OR = [
        { first_name: { contains: s, mode: 'insensitive' } },
        { middle_name: { contains: s, mode: 'insensitive' } },
        { last_name: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
      ];
    }

    // fetch customers and their balances
    const [itemsRaw, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: q.sort_by === 'createdAt' ? { updatedAt: q.sort_dir || 'desc' } : { customer_id: 'asc' },
        skip: q.offset ?? 0,
        take: q.limit ?? 20,
        include: { balances: true },
      }),
      this.prisma.customer.count({ where }),
    ]);

    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    const esomPerUsd = Number(settings?.esom_per_usd || 0);
    const prices = await this.getUsdPricesCached();

    const items: UsersListItemDto[] = itemsRaw.map((c) => {
      const cached = this.balanceCache.get(c.customer_id);
      let ESOM: number, SOM: number, BTC: number, ETH: number, USDT_TRC20: number;
      if (cached) {
        ({ ESOM, SOM, BTC, ETH, USDT_TRC20 } = cached);
      } else {
        const bal = Object.fromEntries(c.balances.map(b => [b.asset, Number(b.balance)])) as any;
        ESOM = Number(bal.ESOM || 0);
        SOM = Number(bal.SOM || 0);
        BTC = Number(bal.BTC || 0);
        ETH = Number(bal.ETH || 0);
        USDT_TRC20 = Number(bal.USDT_TRC20 || 0);
        this.balanceCache.set(c.customer_id, { ESOM, SOM, BTC, ETH, USDT_TRC20 });
      }

      const total_crypto_usd = BTC * prices.BTC + ETH * prices.ETH + USDT_TRC20 * prices.USDT_TRC20;
      const total_salam = SOM + ESOM + total_crypto_usd * esomPerUsd; // Общий баланс по ТЗ

      return {
        customer_id: c.customer_id,
        first_name: c.first_name ?? undefined,
        middle_name: c.middle_name ?? undefined,
        last_name: c.last_name ?? undefined,
        phone: c.phone ?? undefined,
        email: c.email ?? undefined,
        status: (c as any).status ?? 'ACTIVE',
        balances: { ESOM, SOM, BTC, ETH, USDT_TRC20 },
        som_balance: SOM,
        total_balance: total_salam,
        createdAt: (c as any).createdAt ?? undefined,
      };
    });

    return { total, offset: q.offset ?? 0, limit: q.limit ?? 20, items };
  }

  async update(id: number, dto: AdminUpdateUserDto) {
    const data: any = {};
    if (dto.first_name !== undefined) data.first_name = dto.first_name;
    if (dto.middle_name !== undefined) data.middle_name = dto.middle_name;
    if (dto.last_name !== undefined) data.last_name = dto.last_name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if ((dto as any).status !== undefined) data.status = (dto as any).status;

    const c = await this.prisma.customer.update({ where: { customer_id: id }, data, include: { balances: true } });
    this.balanceCache.invalidate(id);

    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    const esomPerUsd = Number(settings?.esom_per_usd || 0);
    const prices = await this.getUsdPricesCached();

    const bal = Object.fromEntries(c.balances.map(b => [b.asset, Number(b.balance)])) as any;
    const ESOM = Number(bal.ESOM || 0);
    const SOM = Number(bal.SOM || 0);
    const BTC = Number(bal.BTC || 0);
    const ETH = Number(bal.ETH || 0);
    const USDT_TRC20 = Number(bal.USDT_TRC20 || 0);
    const total_crypto_usd = BTC * prices.BTC + ETH * prices.ETH + USDT_TRC20 * prices.USDT_TRC20;
    const total_salam = SOM + ESOM + total_crypto_usd * esomPerUsd;

    return {
      customer_id: c.customer_id,
      first_name: c.first_name ?? undefined,
      middle_name: c.middle_name ?? undefined,
      last_name: c.last_name ?? undefined,
      phone: c.phone ?? undefined,
      email: c.email ?? undefined,
      status: (c as any).status ?? 'ACTIVE',
      balances: { ESOM, SOM, BTC, ETH, USDT_TRC20 },
      som_balance: SOM,
      total_balance: total_salam,
      createdAt: (c as any).createdAt ?? undefined,
    };
  }

  async getById(id: number): Promise<UsersListItemDto> {
    const c = await this.prisma.customer.findUnique({ where: { customer_id: id }, include: { balances: true } });
    if (!c) return undefined as any;

    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    const esomPerUsd = Number(settings?.esom_per_usd || 0);
    const prices = await this.getUsdPricesCached();

    const cached = this.balanceCache.get(c.customer_id);
    let ESOM: number, SOM: number, BTC: number, ETH: number, USDT_TRC20: number;
    if (cached) {
      ({ ESOM, SOM, BTC, ETH, USDT_TRC20 } = cached);
    } else {
      const bal = Object.fromEntries(c.balances.map(b => [b.asset, Number(b.balance)])) as any;
      ESOM = Number(bal.ESOM || 0);
      SOM = Number(bal.SOM || 0);
      BTC = Number(bal.BTC || 0);
      ETH = Number(bal.ETH || 0);
      USDT_TRC20 = Number(bal.USDT_TRC20 || 0);
      this.balanceCache.set(c.customer_id, { ESOM, SOM, BTC, ETH, USDT_TRC20 });
    }

    const total_crypto_usd = BTC * prices.BTC + ETH * prices.ETH + USDT_TRC20 * prices.USDT_TRC20;
    const total_salam = SOM + ESOM + total_crypto_usd * esomPerUsd;

    return {
      customer_id: c.customer_id,
      first_name: c.first_name ?? undefined,
      middle_name: c.middle_name ?? undefined,
      last_name: c.last_name ?? undefined,
      phone: c.phone ?? undefined,
      email: c.email ?? undefined,
      status: (c as any).status ?? 'ACTIVE',
      balances: { ESOM, SOM, BTC, ETH, USDT_TRC20 },
      som_balance: SOM,
      total_balance: total_salam,
      createdAt: (c as any).createdAt ?? undefined,
    };
  }
}



