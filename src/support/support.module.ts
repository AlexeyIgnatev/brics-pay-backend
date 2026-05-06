import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AdminManagementModule } from '../admin-management/admin-management.module';
import { BasicAuthGuard } from '../common/guards/basic-auth.guard';
import { UsersModule } from '../users/users.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [UsersModule, AdminManagementModule],
  providers: [SupportService, PrismaClient, BasicAuthGuard],
  controllers: [SupportController],
})
export class SupportModule {}
