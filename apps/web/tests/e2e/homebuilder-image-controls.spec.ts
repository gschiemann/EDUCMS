import { test, expect, type Page, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const SCHOOL = "e2e-homebuilder";
const BOARD = "/templates/custom/brookfield/07-tour-takeaway.html";
const ASSETS = "/templates/signage/corporate/homebuilder/_assets/";
const CORS = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers":
    "authorization,content-type,x-csrf-token,x-requested-with",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};
const catalog = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../docs/templates/homebuilder-install-manifest.json",
    ),
    "utf8",
  ),
) as Array<{ id: string; url: string; orientation: string }>;

async function openBuilder(page: Page) {
  const user = {
    id: "homebuilder-user",
    email: "homebuilder@example.com",
    role: "SCHOOL_ADMIN",
    tenantId: SCHOOL,
    canTriggerPanic: false,
  };
  const tpl = {
    id: "homebuilder-board",
    name: "Model tour",
    tenantId: SCHOOL,
    isSystem: false,
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#fff",
    scenes: [],
    zones: [
      {
        id: "tour-zone",
        templateId: "homebuilder-board",
        name: "Board",
        widgetType: "EXTERNAL_HTML",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 1,
        sortOrder: 0,
        defaultConfig: { url: BOARD },
        sceneId: null,
      },
    ],
  };
  await page.addInitScript(() =>
    localStorage.setItem("edu_cms_eula_accepted_v1.0", "1"),
  );
  const json = (route: Route, body: unknown) =>
    route.fulfill({
      contentType: "application/json",
      headers: CORS,
      body: JSON.stringify(body),
    });
  await page.route(/^http:\/\/api\.invalid\//, (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: CORS });
    const endpoint = new URL(route.request().url()).pathname.replace(
      "/api/v1",
      "",
    );
    const body =
      endpoint === "/auth/me"
        ? user
        : endpoint === "/branding/me"
          ? {}
          : endpoint.startsWith("/templates/homebuilder-board")
            ? tpl
            : endpoint === "/templates"
              ? [tpl]
              : endpoint.startsWith("/tenants")
                ? [
                    {
                      id: SCHOOL,
                      name: "Homebuilder test",
                      slug: SCHOOL,
                      vertical: "CORPORATE",
                    },
                  ]
                : [];
    return json(route, body);
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/${SCHOOL}/templates/builder/homebuilder-board`);
  const frame = page
    .locator('[data-zone-id="tour-zone"] iframe')
    .contentFrame();
  await expect(
    frame.locator('[data-imgslot="tour.image"] img').last(),
  ).toBeVisible();
  await frame.locator('[data-imgslot="tour.image"]').click();
  await expect(
    page
      .locator('[data-edit-img="tour.image"]')
      .getByRole("button", { name: "Add photos from library" }),
  ).toBeVisible();
  return frame;
}

test("standard controls change the actual template preview, including reorder, fit, transition, focus and clearing", async ({
  page,
}, info) => {
  const frame = await openBuilder(page);
  const gallery = page.locator('[data-edit-img="tour.image"]');
  expect(
    await gallery.getByRole("button", { name: "Drag to reorder" }).count(),
  ).toBe(3);
  await gallery.getByRole("combobox").first().selectOption("contain");
  await expect
    .poll(() =>
      frame
        .locator('[data-imgslot="tour.image"] img')
        .last()
        .evaluate((img) => getComputedStyle(img).objectFit),
    )
    .toBe("contain");
  const handle = gallery
    .getByRole("button", { name: "Drag to reorder" })
    .first();
  await handle.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox();
  const to = await gallery.getByRole('button', { name: 'Drag to reorder' }).nth(1).boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2 + 5, { steps: 12 });
  await page.mouse.up();
  await expect(gallery.locator("span.font-mono").first()).toHaveText(
    "bonus-room.jpg",
  );
  await expect(
    frame.locator('[data-imgslot="tour.image"] img').last(),
  ).toHaveAttribute("src", `${ASSETS}bonus-room.jpg`);
  const duration = page
    .getByText("Show each photo for (seconds)", { exact: true })
    .locator("..")
    .locator("input");
  await duration.fill("1");
  const transition = page
    .getByText("Transition between photos", { exact: true })
    .locator("..")
    .locator("select");
  await transition.selectOption("slide-right");
  await expect(frame.locator('[data-field="carousel.transition"]')).toHaveText(
    "slide-right",
  );
  await expect
    .poll(() =>
      frame
        .locator('[data-imgslot="tour.image"] [data-native-image-carousel]')
        .getAttribute("data-carousel-index"),
    )
    .not.toBe("0");
  await gallery.getByText("Advanced image settings", { exact: true }).click();
  await gallery
    .getByText("Image focus", { exact: true })
    .locator("..")
    .locator("select")
    .selectOption("right center");
  await expect
    .poll(() =>
      frame
        .locator('[data-imgslot="tour.image"] img')
        .last()
        .evaluate((img) => getComputedStyle(img).objectPosition),
    )
    .toBe("100% 50%");
  await page.screenshot({
    path: info.outputPath("standard-homebuilder-editor.png"),
    fullPage: true,
  });
  for (let i = 0; i < 3; i++)
    await gallery
      .getByRole("button", { name: "Remove", exact: true })
      .first()
      .click();
  await expect(
    frame.locator('[data-imgslot="tour.image"] [data-native-image-carousel]'),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      frame
        .locator('[data-imgslot="tour.image"]')
        .evaluate((el) => getComputedStyle(el).backgroundImage),
    )
    .toBe("none");
});

test("all newly installed designs paint photos, logos and floor plans in the real opaque-origin sandbox", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  for (const record of catalog) {
    await page.setViewportSize(
      record.orientation === "PORTRAIT"
        ? { width: 720, height: 1280 }
        : { width: 1280, height: 720 },
    );
    await page.setContent(
      `<iframe title="Board" sandbox="allow-scripts" src="http://localhost:3000${record.url}?freeze=1" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"></iframe>`,
    );
    const frame = page.frameLocator("iframe");
    await expect(
      frame.locator("[data-native-image-carousel]").first(),
      record.id,
    ).toBeAttached();
    await expect
      .poll(
        () =>
          frame
            .locator("[data-native-image-carousel] img")
            .evaluateAll(
              (imgs) =>
                imgs.length > 0 &&
                imgs.every(
                  (img) =>
                    (img as HTMLImageElement).complete &&
                    (img as HTMLImageElement).naturalWidth > 0,
                ),
            ),
        { message: record.id },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          frame.locator("[data-native-image-carousel]").evaluateAll((nodes) =>
            nodes.some(node => node.getBoundingClientRect().width > 0) && nodes.every((node) => {
              const img = node.querySelector("img:last-of-type")!;
              const box = img.getBoundingClientRect();
              if (node.getBoundingClientRect().width === 0) return true; // Authored portrait-only logo is hidden in landscape.
              return (
                box.width > 0 &&
                box.height > 0 &&
                getComputedStyle(img).opacity === "1"
              );
            }),
          ),
        { message: `${record.id} visible image frame` },
      )
      .toBe(true);
  }
});

test("a slow next photo holds the decoded current frame until the replacement is ready", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/delayed-slide.svg", async (route) => {
    await gate;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="red"/></svg>',
    });
  });
  const enc = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  await page.goto(
    `${BOARD}?img=${enc({ "tour.image": [`${ASSETS}bedroom.jpg`, "/delayed-slide.svg"] })}&text=${enc({ "carousel.intervalSeconds": "1", "carousel.transition": "cut" })}`,
    { waitUntil: "domcontentloaded" },
  );
  const carousel = page.locator(
    '[data-imgslot="tour.image"] [data-native-image-carousel]',
  );
  await expect(carousel).toHaveAttribute("data-carousel-index", "0");
  await expect
    .poll(() =>
      carousel
        .locator("img")
        .last()
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(1500); // Cross the configured interval while the next request remains blocked.
  await expect(carousel).toHaveAttribute("data-carousel-index", "0");
  await expect(carousel.locator("img").last()).toHaveAttribute(
    "src",
    `${ASSETS}bedroom.jpg`,
  );
  release();
  await expect(carousel).toHaveAttribute("data-carousel-index", "1");
  await expect(carousel.locator("img").last()).toHaveAttribute(
    "src",
    "/delayed-slide.svg",
  );
});
