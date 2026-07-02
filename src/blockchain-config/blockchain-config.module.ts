import { Module } from '@nestjs/common';
import { BlockchainConfigController } from './blockchain-config.controller';
import { SettingsModule } from '../config/settings/settings.module';
import { AdminManagementModule } from '../admin-management/admin-management.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [SettingsModule, AdminManagementModule, PaymentsModule],
  controllers: [BlockchainConfigController],
})
export class BlockchainConfigModule {}
