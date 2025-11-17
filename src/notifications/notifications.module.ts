import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { BricsModule } from '../config/brics/brics.module';
import { SettingsModule } from '../config/settings/settings.module';
import { ExchangeModule } from '../config/exchange/exchange.module';
import { PrismaClient } from '@prisma/client';
import { UsersModule } from '../users/users.module';
import { ConfigModule } from '@nestjs/config';
import { UserManagementModule } from '../user-management/user-management.module';
import { AntiFraudModule } from '../antifraud/antifraud.module';

@Module({
  imports: [BricsModule, UsersModule, ConfigModule, SettingsModule, ExchangeModule, UserManagementModule, AntiFraudModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PrismaClient],
})
export class NotificationsModule {
}
