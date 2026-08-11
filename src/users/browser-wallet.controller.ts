import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import { BrowserWalletRegisterDto } from './dto/browser-wallet.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class BrowserWalletController {
  constructor(private readonly usersService: UsersService) {}

  @Post('browser-wallet')
  @ApiBearerAuth('Bearer')
  @UseGuards(AdminAuthGuard)
  async registerBrowserWallet(@Body() dto: BrowserWalletRegisterDto) {
    return this.usersService.registerBrowserWallet(dto);
  }
}
