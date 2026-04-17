import { Controller, Get } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('api/v1/feature-flags')
export class FeatureFlagsController {
  constructor(private readonly ff: FeatureFlagsService) {}

  @Get()
  all(): Record<string, boolean> {
    return this.ff.allFlags();
  }
}
