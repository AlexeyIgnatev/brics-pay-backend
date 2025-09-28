import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = req.headers["authorization"] as string | undefined;
    if (!header) throw new UnauthorizedException("Требуется авторизация админа");
    const [type, token] = header.split(" ");
    if (type !== "Bearer" || !token) throw new UnauthorizedException("Неверный тип авторизации");

    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>("ADMIN_JWT_ACCESS_SECRET") || "dev_admin_access_secret",
      });
      req.admin = { id: payload.sub, email: payload.email, role: payload.role };
      return true;
    } catch (e) {
      throw new UnauthorizedException("Неверный или истекший токен");
    }
  }
}
