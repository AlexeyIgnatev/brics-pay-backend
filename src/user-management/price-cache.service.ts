import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PriceCacheService {
  private cache: Record<string, { value: number; expiresAt: number }> = {};
  private ttlMs: number;
  constructor(private readonly config: ConfigService) {
    const sec = Number(this.config.get('PRICE_CACHE_TTL_SECONDS'));
    const ms = Number(this.config.get('PRICE_CACHE_TTL_MS'));
    const ttl = !Number.isNaN(ms) && ms > 0 ? ms : (!Number.isNaN(sec) && sec > 0 ? sec * 1000 : 60_000);
    this.ttlMs = ttl;
  }

  get(key: string): number | undefined {
    const it = this.cache[key];
    if (!it) return undefined;
    if (Date.now() > it.expiresAt) { delete this.cache[key]; return undefined; }
    return it.value;
  }

  set(key: string, value: number) {
    this.cache[key] = { value, expiresAt: Date.now() + this.ttlMs };
  }
}
