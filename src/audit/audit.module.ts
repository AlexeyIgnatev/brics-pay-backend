import { Module } from '@nestjs/common';
import { PrismaService } from '../config/prisma/prisma.service';
import { AdminActionLogInterceptor } from './admin-action-log.interceptor';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminActionLogController } from './admin-action-log.controller';

@Module({
  controllers: [AdminActionLogController],
  providers: [
    PrismaService,
    AdminActionLogInterceptor,
    { provide: APP_INTERCEPTOR, useClass: AdminActionLogInterceptor },
  ],
})
export class AuditModule {}
