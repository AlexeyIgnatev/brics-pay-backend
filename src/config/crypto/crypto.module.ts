import { Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { TronService } from './tron.service';

@Module({
  providers: [CryptoService, TronService],
  exports: [CryptoService, TronService],
})
export class CryptoModule {}
