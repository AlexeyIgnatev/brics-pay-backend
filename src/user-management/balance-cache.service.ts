import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type UserAssetBalances = {
  ESOM: number;
  SOM: number;
  BTC: number;
  ETH: number;
  USDT_TRC20: number;
};

@Injectable()
export class BalanceCacheService {
  private cache: Map<number, { value: UserAssetBalances; expiresAt: number }> = new Map();
  private ttlMs: number;
  constructor(private readonly config: ConfigService) {
    const sec = Number(this.config.get('BALANCE_CACHE_TTL_SECONDS'));
    const ms = Number(this.config.get('BALANCE_CACHE_TTL_MS'));
    const ttl = !Number.isNaN(ms) && ms > 0 ? ms : (!Number.isNaN(sec) && sec > 0 ? sec * 1000 : 30_000);
    this.ttlMs = ttl;
  }

  get(userId: number): UserAssetBalances | undefined {
    const it = this.cache.get(userId);
    if (!it) return undefined;
    if (Date.now() > it.expiresAt) { this.cache.delete(userId); return undefined; }
    return it.value;
  }

  set(userId: number, balances: UserAssetBalances) {
    this.cache.set(userId, { value: balances, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(userId: number) {
    this.cache.delete(userId);
  }

  invalidateMany(ids: number[]) {
    for (const id of ids) this.cache.delete(id);
  }

  clear() { this.cache.clear(); }
}
