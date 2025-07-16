import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBasicAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginatedUserResponseDto } from './dto/paginated-user-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { UserDto } from '../users/dto/user.dto';
import { UserBlockStatusDto } from './dto/user-block-status.dto';

@ApiTags('Управление пользователями')
@ApiBasicAuth()
@Controller('user-management')
export class UserManagementController {
  @Post()
  @ApiOperation({
    summary: 'Создать пользователя',
    description: 'Создаёт нового пользователя в системе (баланс создаётся системой автоматически).',
  })
  @ApiResponse({
    status: 201,
    type: UserDto,
    description: 'Успешно созданный пользователь',
  })
  async create(@Body() dto: CreateUserDto): Promise<UserDto> {
    return Promise.resolve({
      customer_id: 101,
      balance: { SOM: 0, ESOM: 0 },
      first_name: dto.first_name,
      middle_name: dto.middle_name,
      last_name: dto.last_name,
      phone: dto.phone,
      email: dto.email,
      address: dto.address,
      private_key: dto.private_key,
    });
  }

  @Get()
  @ApiOperation({
    summary: 'Получить список пользователей',
    description: 'Возвращает список пользователей с пагинацией.',
  })
  @ApiResponse({
    status: 200,
    type: PaginatedUserResponseDto,
    description: 'Пагинированный список пользователей',
  })
  async findAll(
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedUserResponseDto> {
    return Promise.resolve({
      items: [
        {
          customer_id: 101,
          balance: { SOM: 1000, ESOM: 200 },
          first_name: 'Алексей',
          middle_name: 'Иванович',
          last_name: 'Петров',
          phone: '+996700000000',
          email: 'user1@mail.com',
          address: '0x1234abcd5678ef00',
          private_key: '0xabcdef1',
        },
        {
          customer_id: 102,
          balance: { SOM: 2000, ESOM: 500 },
          first_name: 'Мария',
          middle_name: 'Алексеевна',
          last_name: 'Сидорова',
          phone: '+996700000001',
          email: 'user2@mail.com',
          address: '0x5678ef001234abcd',
          private_key: '0xabcdef2',
        },
      ],
      total: 2,
      offset: query.offset ?? 0,
      limit: query.limit ?? 10,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Получить пользователя по ID',
    description: 'Возвращает пользователя по его идентификатору.',
  })
  @ApiParam({ name: 'id', example: 101, description: 'ID пользователя' })
  @ApiResponse({
    status: 200,
    type: UserDto,
    description: 'Данные пользователя',
  })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<UserDto> {
    return Promise.resolve({
      customer_id: id,
      balance: { SOM: 1500, ESOM: 300 },
      first_name: 'Алексей',
      middle_name: 'Иванович',
      last_name: 'Петров',
      phone: '+996700000000',
      email: 'user1@mail.com',
      address: '0x1234abcd5678ef00',
      private_key: '0xabcdef1',
    });
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Редактировать пользователя',
    description: 'Изменяет данные пользователя (баланс нельзя изменить этим методом).',
  })
  @ApiParam({ name: 'id', example: 101, description: 'ID пользователя' })
  @ApiResponse({
    status: 200,
    type: UserDto,
    description: 'Обновлённый пользователь',
  })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ): Promise<UserDto> {
    return Promise.resolve({
      customer_id: id,
      balance: { SOM: 0, ESOM: 0 }, // Баланс не меняется этим методом
      first_name: dto.first_name ?? 'Алексей',
      middle_name: dto.middle_name ?? 'Иванович',
      last_name: dto.last_name ?? 'Петров',
      phone: dto.phone ?? '+996700000000',
      email: dto.email ?? 'user1@mail.com',
      address: dto.address ?? '0x1234abcd5678ef00',
      private_key: dto.private_key ?? '0xabcdef1',
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Удалить пользователя',
    description: 'Удаляет пользователя по ID.',
  })
  @ApiParam({ name: 'id', example: 101, description: 'ID пользователя' })
  @ApiResponse({
    status: 204,
    description: 'Пользователь успешно удалён',
  })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return Promise.resolve();
  }

  @Patch(':id/block')
  @ApiOperation({
    summary: 'Заблокировать пользователя',
    description: 'Блокирует пользователя по ID. Заблокированный пользователь не может входить в систему и совершать операции.',
  })
  @ApiParam({ name: 'id', example: 101, description: 'ID пользователя' })
  @ApiResponse({ status: 200, type: UserBlockStatusDto, description: 'Пользователь успешно заблокирован' })
  async block(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<UserBlockStatusDto> {
    return Promise.resolve({
      user_id: id,
      blocked: true,
    });
  }

  @Patch(':id/unblock')
  @ApiOperation({
    summary: 'Разблокировать пользователя',
    description: 'Разблокирует пользователя по ID. После разблокировки пользователь может входить в систему и совершать операции.',
  })
  @ApiParam({ name: 'id', example: 101, description: 'ID пользователя' })
  @ApiResponse({ status: 200, type: UserBlockStatusDto, description: 'Пользователь успешно разблокирован' })
  async unblock(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<UserBlockStatusDto> {
    return Promise.resolve({
      user_id: id,
      blocked: false,
    });
  }
}
