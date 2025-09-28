import { Module } from '@nestjs/common';
import { UserManagementController } from './user-management.controller';
import { UserManagementService } from './user-management.service';
import { PrismaClient } from '@prisma/client';
import { AdminManagementModule } from '../admin-management/admin-management.module';
import { ExchangeModule } from '../config/exchange/exchange.module';

@Module({
  imports: [AdminManagementModule, ExchangeModule],
  controllers: [UserManagementController],
  providers: [UserManagementService, PrismaClient],
})
export class UserManagementModule {}
