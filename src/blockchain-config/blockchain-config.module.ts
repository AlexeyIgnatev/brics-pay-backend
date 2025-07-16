import { Module } from '@nestjs/common';
import { BlockchainConfigController } from './blockchain-config.controller';

@Module({
  controllers: [BlockchainConfigController]
})
export class BlockchainConfigModule {}
