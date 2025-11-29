import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { PrismaService } from '../config/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { AdminResponseDto } from './dto/admin-response.dto';
import { AdminListQueryDto } from './dto/admin-list-query.dto';
import { PaginatedAdminResponseDto } from './dto/paginated-admin-response.dto';

@Injectable()
export class AdminManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  private toDto(a: any): AdminResponseDto {
    return {
      id: a.id,
      email: a.email,
      firstName: a.first_name,
      lastName: a.last_name,
      role: a.role,
      createdAt: a.createdAt ?? a.created_at ?? a.createdAt,
      updatedAt: a.updatedAt ?? a.updated_at ?? a.updatedAt,
    } as AdminResponseDto;
  }

  async create(dto: CreateAdminDto): Promise<AdminResponseDto> {
    const exists = await this.prisma.admin.findUnique({ where: { email: dto.email } });
    if (exists) throw new BadRequestException('Админ с таким email уже существует');

    const hash = await bcrypt.hash(dto.password, 10);
    const role: AdminRole = dto.role && Object.values(AdminRole).includes(dto.role as AdminRole)
      ? (dto.role as AdminRole)
      : AdminRole.SUPER_ADMIN;

    const admin = await this.prisma.admin.create({
      data: {
        email: dto.email,
        password_hash: hash,
        first_name: dto.firstName,
        last_name: dto.lastName,
        role,
      },
    });
    return this.toDto(admin);
  }

  async update(id: number, dto: UpdateAdminDto): Promise<AdminResponseDto> {
    const admin = await this.prisma.admin.findUnique({ where: { id } });
    if (!admin) throw new NotFoundException('Админ не найден');

    const data: any = {};
    if (dto.email) data.email = dto.email;
    if (dto.firstName) data.first_name = dto.firstName;
    if (dto.lastName) data.last_name = dto.lastName;
    if (dto.role && Object.values(AdminRole).includes(dto.role as AdminRole)) data.role = dto.role as AdminRole;
    if (dto.password) data.password_hash = await bcrypt.hash(dto.password, 10);

    const updated = await this.prisma.admin.update({ where: { id }, data });
    return this.toDto(updated);
  }

  async remove(id: number): Promise<void> {
    const admin = await this.prisma.admin.findUnique({ where: { id } });
    if (!admin) throw new NotFoundException('Админ не найден');
    await this.prisma.admin.delete({ where: { id } });
  }

  async findOne(id: number): Promise<AdminResponseDto> {
    const a = await this.prisma.admin.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Админ не найден');
    return this.toDto(a);
  }

  async list(query: AdminListQueryDto): Promise<PaginatedAdminResponseDto> {
    const where: any = {};

    if (query.firstNameQuery) where.first_name = { contains: query.firstNameQuery, mode: 'insensitive' };
    if (query.lastNameQuery) where.last_name = { contains: query.lastNameQuery, mode: 'insensitive' };
    if (query.emailQuery) where.email = { contains: query.emailQuery, mode: 'insensitive' };

    if (query.roles && query.roles.length) where.role = { in: query.roles as AdminRole[] };

    if (query.createdFrom || query.createdTo) {
      where.createdAt = {} as { gte?: Date; lte?: Date };
      if (query.createdFrom) (where.createdAt as { gte?: Date }).gte = new Date(query.createdFrom);
      if (query.createdTo) (where.createdAt as { lte?: Date }).lte = new Date(query.createdTo);
    }

    const orderBy: any[] = [];
    if (query.sortFirstName) orderBy.push({ first_name: query.sortFirstName });
    if (query.sortLastName) orderBy.push({ last_name: query.sortLastName });
    if (query.sortEmail) orderBy.push({ email: query.sortEmail });
    if (query.sortCreatedAt) orderBy.push({ createdAt: query.sortCreatedAt });

    const [total, items] = await this.prisma.$transaction([
      this.prisma.admin.count({ where }),
      this.prisma.admin.findMany({
        where,
        orderBy: orderBy.length ? orderBy : [{ id: 'asc' }],
        skip: query.offset ?? 0,
        take: query.limit ?? 10,
      }),
    ]);

    return {
      items: items.map((i) => this.toDto(i)),
      total,
      offset: query.offset ?? 0,
      limit: query.limit ?? 10,
    };
  }

  async validateAdmin(email: string, password: string) {
    const admin = await this.prisma.admin.findUnique({ where: { email } });
    if (!admin) throw new UnauthorizedException('Неверные учетные данные');
    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) throw new UnauthorizedException('Неверные учетные данные');
    return admin;
  }

  private async signTokens(payload: any) {
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('ADMIN_JWT_ACCESS_SECRET') || 'dev_admin_access_secret',
      expiresIn: this.config.get<string>('ADMIN_JWT_ACCESS_TTL') || '7d',
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('ADMIN_JWT_REFRESH_SECRET') || 'dev_admin_refresh_secret',
      expiresIn: this.config.get<string>('ADMIN_JWT_REFRESH_TTL') || '7d',
    });
    return { accessToken, refreshToken };
  }

  async login(email: string, password: string, ip?: string) {
    const admin = await this.validateAdmin(email, password);
    const payload = { sub: admin.id, email: admin.email, role: admin.role };
    const { accessToken, refreshToken } = await this.signTokens(payload);
    try {
      await this.prisma.adminActionLog.create({ data: { admin_id: admin.id, ip: ip || 'unknown', action: 'LOGIN', details: undefined } });
    } catch (_) {}
    return {
      accessToken,
      refreshToken,
      admin: this.toDto(admin),
    };
  }

  async refresh(refreshToken: string) {
    try {
      const decoded: any = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.config.get<string>('ADMIN_JWT_REFRESH_SECRET') || 'dev_admin_refresh_secret',
      });
      const admin = await this.prisma.admin.findUnique({ where: { id: decoded.sub } });
      if (!admin) throw new UnauthorizedException('Админ не найден');
      const payload = { sub: admin.id, email: admin.email, role: admin.role };
      return await this.signTokens(payload);
    } catch (e) {
      throw new UnauthorizedException('Неверный или истекший refresh токен');
    }
  }

  async me(adminId: number): Promise<AdminResponseDto> {
    const a = await this.prisma.admin.findUnique({ where: { id: adminId } });
    if (!a) throw new NotFoundException('Админ не найден');
    return this.toDto(a);
  }
}
