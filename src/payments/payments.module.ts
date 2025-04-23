import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { BricsModule } from 'src/config/brics/brics.module';
import { EthereumModule } from 'src/config/ethereum/ethrereum.module';
import { PrismaClient } from '@prisma/client';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [EthereumModule, BricsModule, UsersModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PrismaClient],
})
export class PaymentsModule {}
