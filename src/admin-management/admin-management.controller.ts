import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { AdminResponseDto } from './dto/admin-response.dto';
import { PaginatedAdminResponseDto } from './dto/paginated-admin-response.dto';
import { SettingsService } from '../config/settings/settings.service';
import { SettingsDto } from './dto/settings.dto';
import { AdminManagementService } from './admin-management.service';
import { AdminAuthDto, AdminAuthResponseDto } from './dto/admin-auth.dto';
import { AdminListQueryDto } from './dto/admin-list-query.dto';
import { AdminAuthGuard } from './guards/admin-auth.guard';

@ApiTags('Управление администраторами')
@Controller('admin-management')
export class AdminManagementController {
  constructor(private readonly settingsService: SettingsService, private readonly service: AdminManagementService) {}

  @Post('auth/login')
  @ApiOperation({ summary: 'Авторизация администратора (email+password)' })
  @ApiResponse({ status: 200, type: AdminAuthResponseDto })
  async login(@Body() dto: AdminAuthDto): Promise<AdminAuthResponseDto> {
    const res = await this.service.login(dto.email, dto.password);
    return { accessToken: res.accessToken, refreshToken: res.refreshToken };
  }

  @Post()
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({
    summary: 'Создать нового администратора',
  })
  @ApiResponse({ status: 201, type: AdminResponseDto })
  async create(@Body() createAdminDto: CreateAdminDto): Promise<AdminResponseDto> {
    return this.service.create(createAdminDto);
  }

  @Get()
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Получить список администраторов' })
  @ApiResponse({ status: 200, type: PaginatedAdminResponseDto })
  async findAll(@Query() query: AdminListQueryDto): Promise<PaginatedAdminResponseDto> {
    return this.service.list(query);
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Текущий админ' })
  @ApiResponse({ status: 200, type: AdminResponseDto })
  async getMe(@Req() req: any): Promise<AdminResponseDto> {
    return this.service.me(req.admin.id);
  }

  @Get(':id')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Получить администратора по ID' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiResponse({ status: 200, type: AdminResponseDto })
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<AdminResponseDto> {
    return this.service.findOne(id);
  }

  @Get('settings')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Получить текущие настройки системы' })
  @ApiResponse({ status: 200, type: SettingsDto })
  async getSettings(): Promise<SettingsDto> {
    const s = await this.settingsService.get();
    return s as any;
  }

  @Put('settings')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Обновить настройки системы' })
  @ApiResponse({ status: 200, type: SettingsDto })
  async updateSettings(@Body() dto: Partial<SettingsDto>): Promise<SettingsDto> {
    const s = await this.settingsService.update(dto as any);
    return s as any;
  }

  @Put(':id')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @ApiOperation({ summary: 'Обновить данные администратора' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiResponse({ status: 200, type: AdminResponseDto })
  async update(@Param('id', ParseIntPipe) id: number, @Body() updateAdminDto: UpdateAdminDto): Promise<AdminResponseDto> {
    return this.service.update(id, updateAdminDto);
  }

  @Delete(':id')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('Bearer')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить администратора' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiResponse({ status: 204, description: 'Администратор успешно удалён' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.service.remove(id);
  }
}
