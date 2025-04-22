import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { EthereumService } from './config/ethereum/ethereum.service';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    UsersModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [AppService, EthereumService],
})
export class AppModule {}
