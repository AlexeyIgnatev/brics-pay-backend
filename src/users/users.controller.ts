import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BasicAuthGuard } from 'src/common/guards/basic-auth.guard';
import { ConfigService } from '@nestjs/config';
import { UserDto, UserInfoDto } from './dto/user-info.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
  }

  @Get('info')
  @ApiResponse({
    status: 200,
    description: 'Успешное получение информации о пользователе',
    type: UserDto,
  })
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async info(@Req() req: { user: UserInfoDto }): Promise<UserDto> {
    const wallets = await this.usersService.getUserWallets(req.user);

    return {
      ...req.user,
      wallets: wallets,
      platform_fee: Number(this.configService.get('PLATFORM_FEE')),
    };
  }
}
