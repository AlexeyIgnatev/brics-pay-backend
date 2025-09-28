import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { PrismaClient } from '@prisma/client';
import { TransactionsService } from './transactions.service';
import { AdminManagementModule } from '../admin-management/admin-management.module';

@Module({
  imports: [AdminManagementModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, PrismaClient],
  exports: [TransactionsService],
})
export class TransactionsModule {}
