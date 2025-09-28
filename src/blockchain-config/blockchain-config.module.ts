import { Module } from '@nestjs/common';
import { BlockchainConfigController } from './blockchain-config.controller';
import { SettingsModule } from '../config/settings/settings.module';
import { AdminManagementModule } from '../admin-management/admin-management.module';

@Module({
  imports: [SettingsModule, AdminManagementModule],
  controllers: [BlockchainConfigController],
})
export class BlockchainConfigModule {}
