import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  UsersListQueryDto,
  UsersListResponseDto,
  AdminUpdateUserDto,
  UsersListItemDto,
  UserStatusDtoEnum,
} from './dto/users-list.dto';
import {
  BalanceCacheService,
  UserAssetBalances,
} from './balance-cache.service';

@Injectable()
export class UserManagementService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly balanceCache: BalanceCacheService,
  ) {}

  async list(q: UsersListQueryDto): Promise<UsersListResponseDto> {
    const where: any = {};
    if (q?.status?.length) where.status = { in: q.status };
    if (q?.search) {
      const s = q.search;
      where.OR = [
        { first_name: { contains: s, mode: 'insensitive' } },
        { middle_name: { contains: s, mode: 'insensitive' } },
        { last_name: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [itemsRaw, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: (() => {
          switch (q.sort_by) {
            case 'createdAt':
              return { createdAt: q.sort_dir || 'desc' };
            case 'last_login_at':
              return { last_login_at: q.sort_dir || 'desc' } as any;
            case 'customer_id':
              return { customer_id: q.sort_dir || 'asc' } as any;
            case 'phone':
              return { phone: q.sort_dir || 'asc' } as any;
            case 'email':
              return { email: q.sort_dir || 'asc' } as any;
            default:
              return { customer_id: 'asc' } as any;
          }
        })(),
        skip: q.offset ?? 0,
        take: q.limit ?? 20,
        include: { balances: true },
      }),
      this.prisma.customer.count({ where }),
    ]);

    const items: UsersListItemDto[] = itemsRaw.map((c) => {
      const customer = c as any;
      const cached = this.balanceCache.get(c.customer_id);
      let ESOM: number, SOM: number, USDT_TRC20: number;
      if (cached) {
        ({ ESOM, SOM, USDT_TRC20 } = cached);
      } else {
        const bal = Object.fromEntries(
          c.balances.map((b) => [b.asset, Number(b.balance)]),
        ) as Record<string, number>;
        ESOM = Number(bal.ESOM || 0);
        SOM = Number(bal.SOM || 0);
        USDT_TRC20 = Number(bal.USDT_TRC20 || 0);
        this.balanceCache.set(c.customer_id, { ESOM, SOM, USDT_TRC20 });
      }

      const total_salam = SOM + ESOM + USDT_TRC20;

      return {
        customer_id: c.customer_id,
        first_name: c.first_name ?? undefined,
        middle_name: c.middle_name ?? undefined,
        last_name: c.last_name ?? undefined,
        phone: c.phone ?? undefined,
        email: c.email ?? undefined,
        status:
          c.status === 'BLOCKED'
            ? UserStatusDtoEnum.BLOCKED
            : c.status === 'FRAUD'
              ? UserStatusDtoEnum.FRAUD
              : UserStatusDtoEnum.ACTIVE,
        status_comment: customer.status_comment ?? undefined,
        tariff_category: c.tariff_category,
        residency: c.residency,
        balances: { ESOM, SOM, USDT_TRC20 },
        som_balance: SOM,
        total_balance: total_salam,
        createdAt: c.createdAt ?? undefined,
        last_login_at: c.last_login_at ?? undefined,
        last_login_ip: c.last_login_ip ?? undefined,
        last_login_device: c.last_login_device ?? undefined,
      };
    });

    return { total, offset: q.offset ?? 0, limit: q.limit ?? 20, items };
  }

  async update(id: number, dto: AdminUpdateUserDto) {
    const current = await this.prisma.customer.findUnique({
      where: { customer_id: id },
      select: { status: true },
    });

    const data: any = {};
    if (dto.first_name !== undefined) data.first_name = dto.first_name;
    if (dto.middle_name !== undefined) {
      const middleName = dto.middle_name.trim();
      data.middle_name = middleName.length > 0 ? middleName : null;
    }
    if (dto.last_name !== undefined) data.last_name = dto.last_name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    const statusChanged =
      dto.status !== undefined && current != null && dto.status !== current.status;
    const normalizedStatusComment =
      dto.status_comment !== undefined ? dto.status_comment.trim() : undefined;

    if (statusChanged && !normalizedStatusComment) {
      throw new BadRequestException(
        'Укажите комментарий с причиной изменения статуса',
      );
    }

    if (dto.status !== undefined) data.status = dto.status;
    if (dto.status_comment !== undefined) {
      data.status_comment =
        normalizedStatusComment && normalizedStatusComment.length > 0
          ? normalizedStatusComment
          : null;
    }
    if (dto.tariff_category !== undefined)
      data.tariff_category = dto.tariff_category;
    if (dto.residency !== undefined) data.residency = dto.residency;

    const c = await this.prisma.customer.update({
      where: { customer_id: id },
      data,
      include: { balances: true },
    });
    const customer = c as any;
    this.balanceCache.invalidate(id);

    const bal = Object.fromEntries(
      c.balances.map((b) => [b.asset, Number(b.balance)]),
    ) as Record<string, number>;
    const ESOM = Number(bal.ESOM || 0);
    const SOM = Number(bal.SOM || 0);
    const USDT_TRC20 = Number(bal.USDT_TRC20 || 0);
    const total_salam = SOM + ESOM + USDT_TRC20;

    return {
      customer_id: c.customer_id,
      first_name: c.first_name ?? undefined,
      middle_name: c.middle_name ?? undefined,
      last_name: c.last_name ?? undefined,
      phone: c.phone ?? undefined,
      email: c.email ?? undefined,
      status:
        c.status === 'BLOCKED'
          ? UserStatusDtoEnum.BLOCKED
          : c.status === 'FRAUD'
            ? UserStatusDtoEnum.FRAUD
            : UserStatusDtoEnum.ACTIVE,
      status_comment: customer.status_comment ?? undefined,
      tariff_category: c.tariff_category,
      residency: c.residency,
      balances: { ESOM, SOM, USDT_TRC20 },
      som_balance: SOM,
      total_balance: total_salam,
      createdAt: c.createdAt ?? undefined,
      last_login_at: c.last_login_at ?? undefined,
      last_login_ip: c.last_login_ip ?? undefined,
      last_login_device: c.last_login_device ?? undefined,
    };
  }

  async getById(id: number): Promise<UsersListItemDto | null> {
    const c = await this.prisma.customer.findUnique({
      where: { customer_id: id },
      include: { balances: true },
    });
    if (!c) return null;
    const customer = c as any;

    const cached = this.balanceCache.get(c.customer_id);
    let ESOM: number, SOM: number, USDT_TRC20: number;
    if (cached) {
      ({ ESOM, SOM, USDT_TRC20 } = cached);
    } else {
      const bal = Object.fromEntries(
        c.balances.map((b) => [b.asset, Number(b.balance)]),
      ) as Record<string, number>;
      ESOM = Number(bal.ESOM || 0);
      SOM = Number(bal.SOM || 0);
      USDT_TRC20 = Number(bal.USDT_TRC20 || 0);
      this.balanceCache.set(c.customer_id, { ESOM, SOM, USDT_TRC20 });
    }

    const total_salam = SOM + ESOM + USDT_TRC20;

    return {
      customer_id: c.customer_id,
      first_name: c.first_name ?? undefined,
      middle_name: c.middle_name ?? undefined,
      last_name: c.last_name ?? undefined,
      phone: c.phone ?? undefined,
      email: c.email ?? undefined,
      status:
        c.status === 'BLOCKED'
          ? UserStatusDtoEnum.BLOCKED
          : c.status === 'FRAUD'
            ? UserStatusDtoEnum.FRAUD
            : UserStatusDtoEnum.ACTIVE,
      status_comment: customer.status_comment ?? undefined,
      tariff_category: c.tariff_category,
      residency: c.residency,
      balances: { ESOM, SOM, USDT_TRC20 },
      last_login_at: c.last_login_at ?? undefined,
      last_login_ip: c.last_login_ip ?? undefined,
      last_login_device: c.last_login_device ?? undefined,

      som_balance: SOM,
      total_balance: total_salam,
      createdAt: c.createdAt ?? undefined,
    };
  }
}
