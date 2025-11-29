import { Module } from '@nestjs/common';
import { AdminActionLogInterceptor } from './admin-action-log.interceptor';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminActionLogController } from './admin-action-log.controller';
import { PrismaModule } from '../config/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AdminActionLogController],
  providers: [
    AdminActionLogInterceptor,
    { provide: APP_INTERCEPTOR, useClass: AdminActionLogInterceptor },
  ],
})
export class AuditModule {}
