import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaClient } from '@prisma/client';
import { BricsModule } from 'src/config/brics/brics.module';
import { EthereumModule } from 'src/config/ethereum/ethrereum.module';

@Module({
  imports: [BricsModule, EthereumModule],
  controllers: [UsersController],
  providers: [UsersService, PrismaClient],
})
export class UsersModule {}
