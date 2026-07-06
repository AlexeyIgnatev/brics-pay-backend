import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BrowserWalletRegisterDto } from './dto/browser-wallet.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class BrowserWalletController {
  constructor(private readonly usersService: UsersService) {}

  @Post('browser-wallet')
  async registerBrowserWallet(@Body() dto: BrowserWalletRegisterDto) {
    return this.usersService.registerBrowserWallet(dto);
  }
}

