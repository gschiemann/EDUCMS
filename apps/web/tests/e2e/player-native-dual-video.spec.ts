import { test, expect, type Page } from "@playwright/test";
import { bootMockPlayer, playerManifest, ok } from "./helpers/mock-player";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const screen = "11111111-1111-4111-8111-111111111111";
const tenant = "22222222-2222-4222-8222-222222222222";
const peer = "33333333-3333-4333-8333-333333333333";
const asset = "44444444-4444-4444-8444-444444444444";
const url =
  "https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/native-test.mp4";
const clip = fs.readFileSync(path.join(__dirname, "fixtures", "loop-clip.mp4"));
const sha256 = createHash("sha256").update(clip).digest("hex");

async function bootDual(page: Page) {
  await page.addInitScript(
    ({ sha256 }) => {
      const w = window as any;
      w.__eduCmsBridgeNonce = "fake-test-nonce";
      const d = (w.__dualTest = {
        ready: false,
        committed: false,
        advance: true,
        fail: false,
        frames: 0,
        commits: [] as number[],
        stops: 0,
      });
      w.EduCmsNative = {
        sharedVideoPrepare() {},
        sharedVideoCommit() {
          d.commits.push(document.querySelectorAll("video").length);
          d.committed = true;
        },
        sharedVideoStop() {
          d.stops++;
        },
        sharedVideoState() {
          if (d.committed && d.advance) d.frames += 15;
          return JSON.stringify({
            version: 1,
            state: d.fail
              ? "failed"
              : d.committed
                ? "presenting"
                : d.ready
                  ? "ready"
                  : "preparing",
            sessionId: "55555555-5555-4555-8555-555555555555",
            revision: "test-revision",
            sha256,
            faceIndex: 0,
            reason: d.fail ? "codec-failed" : undefined,
            codecName: "OMX.test.avc",
            elapsedMs: (d.frames * 1000) / 30,
            loops: 0,
            output: {
              attached: true,
              visible: true,
              hardwareAccelerated: true,
              viewUpdates: d.frames,
              uniqueFrames: d.frames,
              sourcePtsUs: d.frames * 33333,
              width: 1280,
              height: 720,
              lastUpdateElapsedMs: 10000,
              ageMs: 0,
            },
          });
        },
      };
    },
    { sha256 },
  );
  const manifest = {
    ...playerManifest(screen, "video", { loopMode: "native" }, 1, true),
    tenantId: tenant,
    nativeSharedVideo: {
      version: 1,
      screenId: screen,
      tenantId: tenant,
      primaryScreenId: screen,
      peerScreenId: peer,
      faceIndex: 0,
      revision: "test-revision",
      asset: {
        id: asset,
        url,
        sha256,
        size: clip.length,
        width: 320,
        height: 180,
        fps: 30,
      },
      transform: { orientation: "LANDSCAPE", rotation: 0, fit: "fill" },
    },
  };
  Object.assign(manifest.playlists[0].items[0], {
    asset_id: asset,
    url,
    asset_hash: sha256,
    asset_size: clip.length,
  });
  const manifestRef: { value: typeof manifest } = { value: manifest };
  await bootMockPlayer(page, {
    tag: "native-dual",
    kind: "video",
    videoMp4: true,
    manifest,
    identity: {
      screenId: screen,
      fingerprint: "fake-native-dual",
      deviceToken: "fake.native.dual",
    },
    videoFixtures: { [url]: "loop-clip.mp4" },
    extraRoutes: async (p) => {
      await p.route(`**/api/v1/screens/${screen}/manifest*`, (route) =>
        ok(route, manifestRef.value),
      );
      await p.addInitScript(() => {
        const Real = window.WebSocket;
        window.WebSocket = new Proxy(Real, {
          construct(target, args) {
            const socket = Reflect.construct(target, args);
            if (String(args[0]).includes("/realtime"))
              (window as any).__dualSocket = socket;
            return socket;
          },
        });
      });
    },
  });
  return { manifestRef, manifest };
}

async function push(page: Page, type: string) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (window as any).__dualSocket;
        return s?.readyState === 1 && !!s.onmessage;
      }),
    )
    .toBe(true);
  await page.evaluate((type) => {
    (window as any).__dualSocket.onmessage(
      new MessageEvent("message", {
        data: JSON.stringify({
          type,
          signature: "fake-local-test-signature",
          idempotencyKey: `native-test-${type}`,
          timestamp: Date.now(),
          payload: {},
        }),
      }),
    );
  }, type);
}

test("native handoff releases the HTML decoder, proves own output and restores browser on failure without navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let navigations = 0;
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navigations++;
  });
  await bootDual(page);
  await expect(page.locator("video")).toHaveCount(1);
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(0.5);
  expect(await page.evaluate(() => (window as any).__dualTest.commits)).toEqual(
    [],
  );
  const before = navigations;
  await page.evaluate(() => ((window as any).__dualTest.ready = true));
  await expect(page.locator("[data-native-shared-video]")).toHaveAttribute(
    "data-native-shared-video",
    "presenting",
  );
  await expect(page.locator("video")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__dualTest.commits)).toEqual(
    [0],
  );
  const backgrounds = await page
    .locator("[data-native-shared-video]")
    .evaluate((el) => {
      const values = [];
      for (let node: Element | null = el; node; node = node.parentElement)
        values.push(getComputedStyle(node).backgroundColor);
      return values;
    });
  expect(backgrounds.every((x) => x === "rgba(0, 0, 0, 0)")).toBe(true);
  await page.screenshot({ path: "/tmp/dh43-native-handoff.png" });
  await page.evaluate(() => ((window as any).__dualTest.fail = true));
  await expect(page.locator("[data-native-shared-video]")).toHaveAttribute(
    "data-native-shared-video",
    "browser",
  );
  await expect(page.locator("video")).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0.5),
    )
    .toBe(true);
  await expect(page.locator('[data-edu-player-root="media"]')).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)",
  );
  await page.screenshot({ path: "/tmp/dh43-native-browser-restored.png" });
  expect(await page.evaluate(() => (window as any).__dualTest.stops)).toBe(1);
  expect(navigations).toBe(before);
  expect(errors).toEqual([]);
});

test("an emergency manifest retires active native video and all-clear restores the assigned browser video", async ({
  page,
}) => {
  const { manifestRef, manifest } = await bootDual(page);
  await page.evaluate(() => ((window as any).__dualTest.ready = true));
  await expect(page.locator("[data-native-shared-video]")).toHaveAttribute(
    "data-native-shared-video",
    "presenting",
  );
  manifestRef.value = {
    ...manifest,
    isEmergency: true,
    emergencyType: "LOCKDOWN",
    emergencySeverity: "CRITICAL",
    emergencyScope: "tenant",
    playlists: [],
  } as typeof manifest;
  await push(page, "OVERRIDE");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = localStorage.getItem("edu_emergency_cache_v1");
        return value ? JSON.parse(value).payload?.type : null;
      }),
    )
    .toBe("LOCKDOWN");
  await expect(page.locator("[data-native-shared-video]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__dualTest.stops)).toBe(1);
  await expect(page.locator('[data-edu-player-root="media"]')).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)",
  );
  // The clear manifest intentionally removes the native admission. Existing browser playback is the recovery.
  const { nativeSharedVideo: _native, ...normal } = manifest;
  manifestRef.value = normal as typeof manifest;
  await push(page, "ALL_CLEAR");
  await expect(page.locator("video")).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0.5),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("edu_emergency_cache_v1")),
    )
    .toBeNull();
});
