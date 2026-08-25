import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { StarterBoardService } from './starter-board.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { SampleDataModule } from '../sample-data/sample-data.module';

@Module({
  imports: [PrismaModule, AuthModule, EmailModule, SampleDataModule],
  controllers: [OnboardingController],
  // StarterBoardService gives every new tenant its first REAL board + playlist
  // at signup (see starter-board.service.ts). Prisma-only, so it needs nothing
  // beyond PrismaModule.
  providers: [OnboardingService, StarterBoardService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
