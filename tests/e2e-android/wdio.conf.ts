import { join } from 'node:path';
import type { Options } from '@wdio/types';

/**
 * Android (Appium) scaffold — NEVER RUN, NOT FLEET COVERAGE.
 *
 * ⚠️ Read this before citing it as Android test coverage. As of 2026-09-08 this
 * config had never executed successfully, and carried three identifiers that
 * pointed at nothing:
 *   · 'appium:app' was COMMENTED OUT, so no APK was ever installed
 *   · it pointed at './apps/android/...' — the app lives at 'apps/player/'
 *   · it waited on 'com.schoolcms.MainActivity' — the real applicationId is
 *     'com.educms.player' (apps/player/app/build.gradle.kts:13)
 * The paths below are corrected so it CAN run, but "it runs" is not "it passes",
 * and nothing here has been validated against a device.
 *
 * ⚠️ AND EVEN WHEN GREEN, THIS IS NOT A FLEET CLAIM. CLAUDE.md's hardware
 * qualification gate exists because emulators do not reproduce what actually
 * breaks our screens: OEM certificate stores, OEM DNS, broken WebView providers,
 * remote-key firmware, memory pressure and storage corruption. Two units bricked
 * at install and an Android-9 Goodview sat on "Connecting…" with every automated
 * check green. Release readiness comes from apps/player/HARDWARE-QUALIFICATION.md
 * run on real glass — never from this file.
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
    // The Kotlin player shell. Build it first:
    //   cd apps/player && ./gradlew :app:assembleDebug
    // NOTE: the debug build splits per ABI — there is no universal app-debug.apk.
    // Pick the ABI your emulator/device actually runs (arm64-v8a on Apple silicon).
    'appium:app': join(process.cwd(), './apps/player/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk'),
    // Activity class is namespaced com.educms.player (build.gradle.kts:9); the
    // DEBUG build additionally carries applicationIdSuffix '.debug' (:334), so the
    // installed package is com.educms.player.debug while the class name is not.
    'appium:appWaitActivity': 'com.educms.player.MainActivity',
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
