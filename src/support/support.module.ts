import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { BasicAuthGuard } from '../common/guards/basic-auth.guard';
import { UsersModule } from '../users/users.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [UsersModule],
  providers: [SupportService, PrismaClient, BasicAuthGuard],
  controllers: [SupportController],
})
export class SupportModule {}

