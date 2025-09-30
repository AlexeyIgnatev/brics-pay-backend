import { Body, Controller, Get, Param, ParseIntPipe, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import { UsersListQueryDto, UsersListResponseDto, AdminUpdateUserDto } from './dto/users-list.dto';
import { UserManagementService } from './user-management.service';

@ApiTags('Управление пользователями')
@ApiBearerAuth('Bearer')
@UseGuards(AdminAuthGuard)
@Controller('user-management')
export class UserManagementController {
  constructor(private readonly svc: UserManagementService) {}

  @Get()
  @ApiOperation({ summary: 'Список пользователей', description: 'Пагинация, фильтры, сортировка' })
  @ApiResponse({ status: 200, type: UsersListResponseDto })
  async list(@Query() query: UsersListQueryDto): Promise<UsersListResponseDto> {
    return this.svc.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получение пользователя по ID' })
  @ApiParam({ name: 'id', example: 123 })
  async getOne(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Редактирование пользователя', description: 'ФИО, телефон, email, статус' })
  @ApiParam({ name: 'id', example: 101 })
  @ApiResponse({ status: 200, type: UsersListResponseDto })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return this.svc.update(id, dto);
  }
}
