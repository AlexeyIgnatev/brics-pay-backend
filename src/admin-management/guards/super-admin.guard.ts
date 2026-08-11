import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AdminRole } from '@prisma/client';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      admin?: { role?: AdminRole };
    }>();
    if (request.admin?.role !== AdminRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Недостаточно прав для управления администраторами',
      );
    }
    return true;
  }
}
