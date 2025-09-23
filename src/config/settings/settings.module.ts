import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { PrismaClient } from '@prisma/client';

@Module({
  providers: [SettingsService, PrismaClient],
  exports: [SettingsService],
})
export class SettingsModule {}
