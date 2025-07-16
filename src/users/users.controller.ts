import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ExtendedUserDto, UserDto } from './dto/user.dto';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BasicAuthGuard } from 'src/common/guards/basic-auth.guard';
import { ConfigService } from '@nestjs/config';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly configService: ConfigService,
  ) {
  }

  @Get('info')
  @ApiResponse({
    status: 200,
    description: 'Успешное получение информации о пользователе',
    type: ExtendedUserDto,
  })
  @ApiBearerAuth('Basic')
  @UseGuards(BasicAuthGuard)
  async info(@Req() req: { user: UserDto }) {
    return {
      ...req.user,
      platform_fee: Number(this.configService.get('PLATFORM_FEE')),
    };
  }
}
