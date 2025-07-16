import { Test, TestingModule } from '@nestjs/testing';
import { AdminManagementController } from './admin-management.controller';

describe('AdminManagementController', () => {
  let controller: AdminManagementController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminManagementController],
    }).compile();

    controller = module.get<AdminManagementController>(AdminManagementController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
