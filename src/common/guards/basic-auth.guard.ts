import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';

@Injectable()
export class BasicAuthGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Требуется авторизация');
    }

    const [type, credentials] = authHeader.split(' ');

    if (type !== 'Basic') {
      throw new UnauthorizedException('Неверный тип авторизации');
    }

    const [username, password] = Buffer.from(credentials, 'base64')
      .toString('utf-8')
      .split(':');

    if (!username || !password) {
      throw new UnauthorizedException('Неверный формат учетных данных');
    }

    try {
      request.user = await this.usersService.getUserInfo(
        username,
        password,
      );

      return true;
    } catch (error) {
      throw new UnauthorizedException('Неверные учетные данные');
    }
  }
}
