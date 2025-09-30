import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    try {
      if (!process.env.DATABASE_URL) {
        console.warn('Prisma: DATABASE_URL is not set, skipping initial connect');
        return;
      }
      await this.$connect();
    } catch (e: any) {
      console.error('Prisma initial connect failed:', e?.message || e);
      // Allow app to boot; Prisma will attempt to connect lazily on first query
    }
  }
}
