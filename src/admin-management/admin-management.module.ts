import { Module } from '@nestjs/common';
import { AdminManagementController } from './admin-management.controller';
import { PrismaService } from '../config/prisma/prisma.service';
import { AdminManagementService } from './admin-management.service';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { SuperAdminGuard } from './guards/super-admin.guard';

@Module({
  imports: [JwtModule.register({ global: true })],
  controllers: [AdminManagementController],
  providers: [
    PrismaService,
    AdminManagementService,
    AdminAuthGuard,
    SuperAdminGuard,
  ],
  exports: [AdminManagementService, AdminAuthGuard, SuperAdminGuard],
})
export class AdminManagementModule {}
