import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Request,
} from '@nestjs/common';
import { ApiBasicAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { AdminResponseDto } from './dto/admin-response.dto';
import { PaginatedAdminResponseDto } from './dto/paginated-admin-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Управление администраторами')
@ApiBasicAuth()
@Controller('admin-management')
export class AdminManagementController {
  @Post()
  @ApiOperation({
    summary: 'Создать нового администратора',
    description:
      'Только главный админ может создавать новых администраторов. Пароль будет захеширован на сервере.',
  })
  @ApiResponse({
    status: 201,
    type: AdminResponseDto,
    description: 'Успешно созданный администратор',
  })
  async create(
    @Body() createAdminDto: CreateAdminDto,
  ): Promise<AdminResponseDto> {
    return Promise.resolve({
      id: 123,
      username: createAdminDto.username,
      firstName: createAdminDto.firstName,
      lastName: createAdminDto.lastName,
      createdAt: new Date(),
      role: createAdminDto.role,
    });
  }

  @Get()
  @ApiOperation({
    summary: 'Получить список администраторов',
    description:
      'Возвращает список администраторов с пагинацией. Только для главного админа.',
  })
  @ApiResponse({
    status: 200,
    type: PaginatedAdminResponseDto,
    description: 'Пагинированный список администраторов',
  })
  async findAll(
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedAdminResponseDto> {
    return Promise.resolve({
      items: [
        {
          id: 1,
          username: 'admin',
          firstName: 'Иван',
          lastName: 'Иванов',
          createdAt: new Date(),
          role: 'admin',
        },
        {
          id: 2,
          username: 'manager',
          firstName: 'Петр',
          lastName: 'Петров',
          createdAt: new Date(),
          role: 'manager',
        },
      ],
      total: 2,
      offset: query.offset ?? 0,
      limit: query.limit ?? 10,
    });
  }

  @Get('me')
  @ApiOperation({
    summary: 'Получить информацию о себе',
    description:
      'Возвращает информацию о текущем пользователе (авторизованном администраторе).',
  })
  @ApiResponse({
    status: 200,
    type: AdminResponseDto,
    description: 'Информация о текущем пользователе',
  })
  async getMe(@Request() req: any): Promise<AdminResponseDto> {
    return Promise.resolve({
      id: 1,
      username: 'admin',
      firstName: 'Иван',
      lastName: 'Иванов',
      createdAt: new Date(),
      role: 'admin',
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Получить администратора по ID',
    description: 'Только для главного админа.',
  })
  @ApiParam({
    name: 'id',
    example: 1,
    description: 'ID администратора',
  })
  @ApiResponse({
    status: 200,
    type: AdminResponseDto,
    description: 'Информация об администраторе',
  })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdminResponseDto> {
    return Promise.resolve({
      id,
      username: 'admin',
      firstName: 'Иван',
      lastName: 'Иванов',
      createdAt: new Date(),
      role: 'admin',
    });
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Обновить данные администратора',
    description: 'Редактировать данные администратора по ID. Только для главного админа.',
  })
  @ApiParam({
    name: 'id',
    example: 1,
    description: 'ID администратора',
  })
  @ApiResponse({
    status: 200,
    type: AdminResponseDto,
    description: 'Обновлённый администратор',
  })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateAdminDto: UpdateAdminDto,
  ): Promise<AdminResponseDto> {
    return Promise.resolve({
      id,
      username: updateAdminDto.username ?? 'admin',
      firstName: updateAdminDto.firstName ?? 'Иван',
      lastName: updateAdminDto.lastName ?? 'Иванов',
      createdAt: new Date(),
      role: updateAdminDto.role ?? 'admin',
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Удалить администратора',
    description: 'Удаляет администратора по ID. Только для главного админа.',
  })
  @ApiParam({
    name: 'id',
    example: 1,
    description: 'ID администратора',
  })
  @ApiResponse({
    status: 204,
    description: 'Администратор успешно удалён',
  })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return Promise.resolve();
  }
}
