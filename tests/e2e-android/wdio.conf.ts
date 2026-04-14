import type { Options } from '@wdio/types';

/**
 * QA Architecture: Android Device Matrix
 * Mapping exact device bounds out of TEST_MATRIX.md for true Headless Android validation using Appium.
 */
export const config: Options.Testrunner = {
  runner: 'local',
  port: 4723, // Appium target port
  specs: [
    './tests/e2e-android/**/*.spec.ts' // Target Appium specs
  ],
  exclude: [],
  maxInstances: 1,

  // Device Matrix Bounds
  capabilities: [{
    platformName: 'Android',
    'appium:deviceName': 'Android_Signage_Emulator', // Mapped to Android 12 Target
    'appium:platformVersion': '12.0',
    'appium:automationName': 'UiAutomator2',
    // Mount the React Native / Kotlin shell for the Signage App
    // 'appium:app': join(process.cwd(), './apps/android/app/build/outputs/apk/debug/app-debug.apk'),
    'appium:appWaitActivity': 'com.schoolcms.MainActivity',
    'appium:autoGrantPermissions': true,
    'appium:noReset': false,
  }],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  services: ['appium'],
  framework: 'mocha',
  reporters: ['spec'],
  
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000
  },
};
