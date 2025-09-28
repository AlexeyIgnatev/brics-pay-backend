import { Module } from '@nestjs/common';
import { AdminManagementController } from './admin-management.controller';
import { PrismaService } from '../config/prisma/prisma.service';
import { AdminManagementService } from './admin-management.service';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthGuard } from './guards/admin-auth.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminManagementController],
  providers: [PrismaService, AdminManagementService, AdminAuthGuard],
  exports: [AdminManagementService, AdminAuthGuard],
})
export class AdminManagementModule {}
