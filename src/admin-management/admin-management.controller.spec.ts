import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AdminManagementController } from './admin-management.controller';
import { AdminManagementService } from './admin-management.service';
import { AdminAuthGuard } from './guards/admin-auth.guard';

describe('AdminManagementController', () => {
  let controller: AdminManagementController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminManagementController],
      providers: [
        { provide: AdminManagementService, useValue: {} },
        {
          provide: AdminAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    controller = module.get<AdminManagementController>(
      AdminManagementController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
