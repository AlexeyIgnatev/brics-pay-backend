import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { AdminActionLogInterceptor } from './admin-action-log.interceptor';

export function LogAdminActions() {
  return applyDecorators(UseInterceptors(AdminActionLogInterceptor));
}
