import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { EthereumService } from './config/ethereum/ethereum.service';
import { PaymentsModule } from './payments/payments.module';
import { AdminManagementModule } from './admin-management/admin-management.module';
import { UserManagementModule } from './user-management/user-management.module';
import { TransactionsModule } from './transactions/transactions.module';
import { BlockchainConfigModule } from './blockchain-config/blockchain-config.module';
import { AntiFraudModule } from './antifraud/antifraud.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    UsersModule,
    PaymentsModule,
    AdminManagementModule,
    UserManagementModule,
    TransactionsModule,
    BlockchainConfigModule,
    AntiFraudModule,
  ],
  controllers: [AppController],
  providers: [AppService, EthereumService],
})
export class AppModule {}
