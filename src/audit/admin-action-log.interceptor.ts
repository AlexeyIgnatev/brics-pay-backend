import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../config/prisma/prisma.service';

function getClientIp(req: any): string {
  const xf = (req.headers?.['x-forwarded-for'] as string) || '';
  if (xf) return xf.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
}

function sanitize(obj: any): any {
  const blacklist = new Set(['password', 'password_hash', 'private_key', 'accessToken', 'refreshToken']);
  const recur = (val: any): any => {
    if (val == null) return val;
    if (Array.isArray(val)) return val.map(recur);
    if (typeof val === 'object') {
      const out: any = {};
      for (const [k, v] of Object.entries(val)) {
        out[k] = blacklist.has(k) ? '[REDACTED]' : recur(v);
      }
      return out;
    }
    return val;
  };
  return recur(obj);
}

@Injectable()
export class AdminActionLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const admin = req?.admin;
    const method = (req?.method || '').toUpperCase();

    const shouldLog = !!admin && method !== 'GET';
    const ip = getClientIp(req);
    const url = (req?.originalUrl || req?.url || '').split('?')[0];

    const details = sanitize({ params: req?.params, query: req?.query, body: req?.body });

    return next.handle().pipe(
      tap(async () => {
        if (!shouldLog) return;
        try {
          await this.prisma.adminActionLog.create({
            data: {
              admin_id: Number(admin.id),
              ip,
              action: `${method} ${url}`,
              details: JSON.stringify(details),
            },
          });
        } catch (_) {
          // swallow
        }
      }),
    );
  }
}
