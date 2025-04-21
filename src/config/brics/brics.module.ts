import { Module } from '@nestjs/common';
import { BricsService } from './brics.service';

@Module({
  providers: [BricsService],
  exports: [BricsService],
})
export class BricsModule {}
