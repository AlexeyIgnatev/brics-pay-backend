import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BlockchainConfigController } from './blockchain-config.controller';
import { SettingsService } from '../config/settings/settings.service';
import { AdminAuthGuard } from '../admin-management/guards/admin-auth.guard';
import { UsdtTreasuryOrchestratorService } from '../payments/usdt-treasury-orchestrator.service';

describe('BlockchainConfigController', () => {
  let controller: BlockchainConfigController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlockchainConfigController],
      providers: [
        { provide: SettingsService, useValue: {} },
        {
          provide: UsdtTreasuryOrchestratorService,
          useValue: { getTreasuryReserveSnapshot: jest.fn() },
        },
        {
          provide: AdminAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    controller = module.get<BlockchainConfigController>(
      BlockchainConfigController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
