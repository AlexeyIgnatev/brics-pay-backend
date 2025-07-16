import { Module } from '@nestjs/common';
import { UserManagementController } from './user-management.controller';

@Module({
  controllers: [UserManagementController]
})
export class UserManagementModule {}
