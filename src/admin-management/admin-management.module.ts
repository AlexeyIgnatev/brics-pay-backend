import { Module } from '@nestjs/common';
import { AdminManagementController } from './admin-management.controller';
import { SettingsModule } from '../config/settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [AdminManagementController]
})
export class AdminManagementModule {}
