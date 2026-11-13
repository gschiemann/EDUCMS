import { defineConfig } from '@playwright/test';
import base from './playwright.sandbox.config';

export default defineConfig({
  ...base,
  use: { ...(base.use || {}), launchOptions: { executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] } },
});
