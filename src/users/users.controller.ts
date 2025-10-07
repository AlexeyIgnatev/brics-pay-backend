import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BasicAuthGuard } from 'src/common/guards/basic-auth.guard';
import { ConfigService } from '@nestjs/config';
import { UserDto, UserInfoDto } from './dto/user-info.dto';
import { UsersService } from './users.service';
import { SettingsService } from '../config/settings/settings.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly settingsService: SettingsService,
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

    const s = await this.settingsService.get();
    const settings = {
      esom_per_usd: s.esom_per_usd.toString(),
      esom_som_conversion_fee_pct: s.esom_som_conversion_fee_pct.toString(),
      btc_trade_fee_pct: s.btc_trade_fee_pct.toString(),
      eth_trade_fee_pct: s.eth_trade_fee_pct.toString(),
      usdt_trade_fee_pct: s.usdt_trade_fee_pct.toString(),
      btc_withdraw_fee_fixed: s.btc_withdraw_fee_fixed.toString(),
      eth_withdraw_fee_fixed: s.eth_withdraw_fee_fixed.toString(),
      usdt_withdraw_fee_fixed: s.usdt_withdraw_fee_fixed.toString(),
      min_withdraw_btc: s.min_withdraw_btc.toString(),
      min_withdraw_eth: s.min_withdraw_eth.toString(),
      min_withdraw_usdt_trc20: s.min_withdraw_usdt_trc20.toString(),
    };

    return {
      ...req.user,
      wallets: wallets,
      settings,
    };
  }
}
