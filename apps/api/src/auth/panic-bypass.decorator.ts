import { SetMetadata } from '@nestjs/common';

export const ALLOW_PANIC_BYPASS_KEY = 'allow_panic_bypass';
export const AllowPanicBypass = () => SetMetadata(ALLOW_PANIC_BYPASS_KEY, true);
