import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BasicAuthGuard } from 'src/common/guards/basic-auth.guard';
import { UserDto, UserInfoDto } from './dto/user-info.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
  ) {
  }

  @Get('info')
  @ApiQuery({ name: 'device', required: false, type: String, description: 'Имя/тип устройства' })
  @ApiResponse({
    status: 200,
    description: 'Успешное получение информации о пользователе',
    type: UserDto,
  })
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async info(
    @Req() req: { user: UserInfoDto; ip?: string; headers?: Record<string, any> },
    @Query('device') device?: string,
  ): Promise<UserDto> {
    const wallets = await this.usersService.getUserWallets(req.user);
    // захват ip из заголовков либо сокета
    const xf = (req.headers?.['x-forwarded-for'] as string) || '';
    const ip = xf ? xf.split(',')[0].trim() : (req as any).ip || (req as any).connection?.remoteAddress || (req as any).socket?.remoteAddress || undefined;
    await this.usersService.updateLastLogin(req.user.customer_id, ip, device);
    return {
      ...req.user,
      wallets: wallets,
    };
  }
}
