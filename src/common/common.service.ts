import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateCommonDto } from './dto/create-common.dto';
import { UpdateCommonDto } from './dto/update-common.dto';
import { PrismaClient } from '@prisma/client';
import { StatusOKDto } from './dto/status.dto';

@Injectable()
export abstract class CommonService<CommonEntity> {
  protected constructor(protected readonly prisma: PrismaClient) {}

  async findAll(params: any, userId?: number): Promise<CommonEntity[]> {
    throw new BadRequestException('Method findAll not implemented.');
  }

  async findOne(id: number): Promise<CommonEntity | null> {
    throw new BadRequestException('Method findOne not implemented.');
  }

  async create(createDto: CreateCommonDto, arg?: any): Promise<CommonEntity> {
    throw new BadRequestException('Method create not implemented.');
  }

  async update(id: number, updateDto: UpdateCommonDto): Promise<CommonEntity> {
    throw new BadRequestException('Method update not implemented.');
  }

  async remove(id: number): Promise<StatusOKDto> {
    throw new BadRequestException('Method remove not implemented.');
  }
}
