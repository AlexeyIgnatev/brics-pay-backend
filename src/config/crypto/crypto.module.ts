import { Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { TronService } from './tron.service';
import { BitcoinService } from './bitcoin.service';

@Module({
  providers: [CryptoService, TronService, BitcoinService],
  exports: [CryptoService, TronService, BitcoinService],
})
export class CryptoModule {}
