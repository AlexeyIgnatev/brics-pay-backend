import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainConfigController } from './blockchain-config.controller';

describe('BlockchainConfigController', () => {
  let controller: BlockchainConfigController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlockchainConfigController],
    }).compile();

    controller = module.get<BlockchainConfigController>(BlockchainConfigController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
