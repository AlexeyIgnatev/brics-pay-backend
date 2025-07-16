import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBasicAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaginatedBankToBankResponseDto } from './dto/paginated-bank-to-bank-response.dto';
import { PaginatedWalletToWalletResponseDto } from './dto/paginated-wallet-to-wallet-response.dto';
import { PaginatedBankToWalletResponseDto } from './dto/paginated-bank-to-wallet-response.dto';
import { PaginatedWalletToBankResponseDto } from './dto/paginated-wallet-to-bank-response.dto';
import { TransactionFilterDto } from './dto/transaction-filter.dto';
import { TransactionStatsFilterDto } from './dto/transaction-stats-filter.dto';
import { TransactionStatsDto } from './dto/transaction-stats.dto';
import { RejectTransactionDto } from './dto/reject-transaction.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { WalletToWalletTransactionDto } from './dto/wallet-to-wallet-transaction.dto';
import { WalletToBankTransactionDto } from './dto/wallet-to-bank-transaction.dto';
import { BankToWalletTransactionDto } from './dto/bank-to-wallet-transaction.dto';
import { BankToBankTransactionDto } from './dto/bank-to-bank-transaction.dto';

@ApiTags('Транзакции пользователей')
@ApiBasicAuth()
@Controller('transactions')
export class TransactionsController {

  @Get('bank-transaction/:id')
  @ApiOperation({
    summary: 'Получить банковскую/смешанную транзакцию по ID',
    description: 'Возвращает банковскую или смешанную транзакцию по её уникальному идентификатору.',
  })
  @ApiParam({ name: 'id', example: 9001, description: 'ID транзакции (bank_op_id или id)' })
  @ApiResponse({ status: 200, type: BankToBankTransactionDto })
  @ApiResponse({ status: 200, type: BankToWalletTransactionDto })
  @ApiResponse({ status: 200, type: WalletToBankTransactionDto })
  async getBankTransactionById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BankToBankTransactionDto | BankToWalletTransactionDto | WalletToBankTransactionDto> {
    return Promise.resolve({
      id,
      amount: 5000,
      comment: 'Пополнение счета',
      date: new Date(),
      sender_account: '40702810900000001234',
      receiver_account: '40702810123456789012',
      status: 'SUCCESS',
    });
  }

  @Get('blockchain-transaction/:tx_hash')
  @ApiOperation({
    summary: 'Получить блокчейн-транзакцию по хэшу',
    description: 'Возвращает транзакцию в блокчейне по её уникальному хэшу.',
  })
  @ApiParam({ name: 'tx_hash', example: '0xabc123', description: 'Хэш транзакции' })
  @ApiResponse({ status: 200, type: WalletToWalletTransactionDto })
  @ApiResponse({ status: 200, type: BankToWalletTransactionDto })
  @ApiResponse({ status: 200, type: WalletToBankTransactionDto })
  async getBlockchainTransactionByHash(
    @Param('tx_hash') tx_hash: string,
  ): Promise<WalletToWalletTransactionDto | BankToWalletTransactionDto | WalletToBankTransactionDto> {
    return Promise.resolve({
      tx_hash,
      amount: 2.5,
      receiver_address: '0xdef456',
      contract_address: '0xcontract789',
      date: new Date(),
      status: 'SUCCESS',
    });
  }

  @Get('bank-to-bank')
  @ApiOperation({
    summary: 'Список всех банковских транзакций',
    description: 'Администратор получает список всех банковских транзакций с фильтрами и пагинацией.',
  })
  @ApiResponse({ status: 200, type: PaginatedBankToBankResponseDto })
  async getAllBankToBank(
    @Query() filters: TransactionFilterDto,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedBankToBankResponseDto> {
    return Promise.resolve({
      items: [
        {
          id: 10,
          amount: 15000,
          comment: 'Выплата поставщику',
          date: new Date(),
          sender_account: '40702810900000009999',
          receiver_account: '40702810123456000001',
          status: 'SUCCESS',
        },
      ],
      total: 1,
      offset: pagination.offset ?? 0,
      limit: pagination.limit ?? 20,
    });
  }

  @Get('wallet-to-wallet')
  @ApiOperation({
    summary: 'Список всех переводов между кошельками',
    description: 'Администратор получает список всех переводов между кошельками с фильтрами и пагинацией.',
  })
  @ApiResponse({ status: 200, type: PaginatedWalletToWalletResponseDto })
  async getAllWalletToWallet(
    @Query() filters: TransactionFilterDto,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedWalletToWalletResponseDto> {
    return Promise.resolve({
      items: [
        {
          tx_hash: '0xallabc123',
          amount: 5.7,
          receiver_address: '0xreceiverall',
          contract_address: '0xcontractall',
          date: new Date(),
          status: 'SUCCESS',
        },
      ],
      total: 1,
      offset: pagination.offset ?? 0,
      limit: pagination.limit ?? 20,
    });
  }

  @Get('bank-to-wallet')
  @ApiOperation({
    summary: 'Список всех переводов с банка на кошелёк',
    description: 'Администратор получает список всех переводов с банковского счета на криптовалютный кошелёк с фильтрами и пагинацией.',
  })
  @ApiResponse({ status: 200, type: PaginatedBankToWalletResponseDto })
  async getAllBankToWallet(
    @Query() filters: TransactionFilterDto,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedBankToWalletResponseDto> {
    return Promise.resolve({
      items: [
        {
          bank_op_id: 9200,
          tx_hash: '0xbanktowallet',
          amount: 300,
          comment: 'Покупка токенов',
          date: new Date(),
          sender_account: '40702810900000009999',
          receiver_address: '0xreceiverall2',
          status: 'SUCCESS',
        },
      ],
      total: 1,
      offset: pagination.offset ?? 0,
      limit: pagination.limit ?? 20,
    });
  }

  @Get('wallet-to-bank')
  @ApiOperation({
    summary: 'Список всех переводов с кошелька на банк',
    description: 'Администратор получает список всех переводов с криптовалютного кошелька на банковский счет с фильтрами и пагинацией.',
  })
  @ApiResponse({ status: 200, type: PaginatedWalletToBankResponseDto })
  async getAllWalletToBank(
    @Query() filters: TransactionFilterDto,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedWalletToBankResponseDto> {
    return Promise.resolve({
      items: [
        {
          bank_op_id: 9210,
          tx_hash: '0xwallettobank',
          amount: 1200,
          comment: 'Продажа токенов',
          date: new Date(),
          receiver_account: '40702810123456000001',
          sender_address: '0xwalletsender',
          status: 'SUCCESS',
        },
      ],
      total: 1,
      offset: pagination.offset ?? 0,
      limit: pagination.limit ?? 20,
    });
  }

  @Get('user/:userId/bank-to-bank')
  @ApiOperation({
    summary: 'Список банковских переводов пользователя',
    description: 'Все банковские транзакции пользователя с фильтрами и пагинацией.',
  })
  @ApiParam({ name: 'userId', example: 101, description: 'ID пользователя' })
  @ApiResponse({ status: 200, type: PaginatedBankToBankResponseDto })
  async getBankToBank(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() filters: TransactionFilterDto,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedBankToBankResponseDto> {
    return Promise.resolve({
      items: [
        {
          id: 1,
          amount: 1000,
          comment: 'Перевод на ЗП',
          date: new Date(),
          sender_account: '40702810900000001234',
          receiver_account: '40702810123456789012',
          status: 'SUCCESS',
        },
      ],
      total: 1,
      offset: pagination.offset ?? 0,
      limit: pagination.limit ?? 20,
    });
  }

  @Get('user/:userId/wallet-to-wallet')
  @ApiOperation({
    summary: 'Список переводов между кошельками',
    description: 'Все переводы между кошельками пользователя с фильтрами и пагинацией.',
  })
  @ApiParam({ name: 'userId', example: 101, description: 'ID пользователя' })
  @ApiResponse({ status: 200, type: PaginatedWalletToWalletResponseDto })
  async getWalletToWallet(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() filters: TransactionFilterDto,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedWalletToWalletResponseDto> {
    return Promise.resolve({
      items: [
        {
          tx_hash: '0xabc123',
          amount: 3.2,
          receiver_address: '0xdef456',
          contract_address: '0xcontract789',
          date: new Date(),
          status: 'SUCCESS',
        },
      ],
      total: 1,
      offset: pagination.offset ?? 0,
      limit: pagination.limit ?? 20,
    });
  }

  @Get('user/:userId/bank-to-wallet')
  @ApiOperation({
    summary: 'Список переводов с банковского счёта на криптокошелёк',
    description: 'Все такие транзакции пользователя с фильтрами и пагинацией.',
  })
  @ApiParam({ name: 'userId', example: 101, description: 'ID пользователя' })
  @ApiResponse({ status: 200, type: PaginatedBankToWalletResponseDto })
  async getBankToWallet(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() filters: TransactionFilterDto,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedBankToWalletResponseDto> {
    return Promise.resolve({
      items: [
        {
          bank_op_id: 9101,
          tx_hash: '0xhashb2w',
          amount: 1000,
          comment: 'Обмен на крипту',
          date: new Date(),
          sender_account: '40702810900000001234',
          receiver_address: '0xwallet5678',
          status: 'SUCCESS',
        },
      ],
      total: 1,
      offset: pagination.offset ?? 0,
      limit: pagination.limit ?? 20,
    });
  }

  @Get('user/:userId/wallet-to-bank')
  @ApiOperation({
    summary: 'Список переводов с криптокошелька на банковский счёт',
    description: 'Все такие транзакции пользователя с фильтрами и пагинацией.',
  })
  @ApiParam({ name: 'userId', example: 101, description: 'ID пользователя' })
  @ApiResponse({ status: 200, type: PaginatedWalletToBankResponseDto })
  async getWalletToBank(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() filters: TransactionFilterDto,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedWalletToBankResponseDto> {
    return Promise.resolve({
      items: [
        {
          bank_op_id: 9110,
          tx_hash: '0xhasht2b',
          amount: 400,
          comment: 'Вывод на банк',
          date: new Date(),
          receiver_account: '40702810123456789012',
          sender_address: '0xwallet9999',
          status: 'PENDING',
        },
      ],
      total: 1,
      offset: pagination.offset ?? 0,
      limit: pagination.limit ?? 20,
    });
  }

  @Post('reject')
  @ApiOperation({
    summary: 'Отклонить транзакцию пользователя',
    description: 'Отклоняет транзакцию по её ID или хэшу (любой из 4 типов).',
  })
  @ApiResponse({ status: 200, description: 'Транзакция успешно отклонена' })
  async rejectTransaction(
    @Body() dto: RejectTransactionDto,
  ): Promise<{ result: string }> {
    return Promise.resolve({ result: 'Транзакция отклонена' });
  }

  @Get('user/:userId/stats')
  @ApiOperation({
    summary: 'Статистика пользователя по транзакциям',
    description: 'Общая статистика по всем транзакциям пользователя за период и с фильтрами.',
  })
  @ApiParam({ name: 'userId', example: 101, description: 'ID пользователя' })
  @ApiResponse({ status: 200, type: TransactionStatsDto })
  async getStats(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() filters: TransactionStatsFilterDto,
  ): Promise<TransactionStatsDto> {
    return Promise.resolve({
      total_count: 10,
      total_amount: 12345,
    });
  }
}
