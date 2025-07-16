import { Module } from '@nestjs/common';
import { AdminManagementController } from './admin-management.controller';

@Module({
  controllers: [AdminManagementController]
})
export class AdminManagementModule {}
