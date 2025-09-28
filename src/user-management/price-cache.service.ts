import { Injectable } from '@nestjs/common';

@Injectable()
export class PriceCacheService {
  private cache: Record<string, { value: number; expiresAt: number }> = {};
  constructor(private readonly ttlMs: number = 60_000) {}

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
