import { test, expect, type Page } from "@playwright/test";

const width = (page: Page) => page.locator(".sidebar").evaluate((el) => el.getBoundingClientRect().width);
async function start(page: Page) {
  const box = (await page.getByRole("separator", { name: "Resize sidebar" }).boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + 80 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  return point;
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole('button', { name: 'Reference', exact: true }).click();
  await page.locator('.workspace').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))));
  await expect(page.getByRole("separator", { name: "Resize sidebar" })).toBeVisible();
});

test("drag tracks displacement and reversal, preserving editor selection and persisted width", async ({ page }) => {
  const editor = page.getByRole("textbox", { name: "Note content", exact: true });
  await editor.evaluate((el) => {
    (window as any).originalEditor = el;
    (el as HTMLElement).focus();
    const range = document.createRange();
    range.selectNodeContents(el.firstChild!);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  });
  const selection = await page.evaluate(() => window.getSelection()?.toString());
  const initial = await width(page);
  const p = await start(page);
  await page.mouse.move(p.x + 5, p.y);
  expect(await width(page)).toBeCloseTo(initial, 0);
  await page.mouse.move(p.x + 80, p.y);
  await expect.poll(() => width(page)).toBeCloseTo(initial + 80, 0);
  await page.mouse.move(p.x + 30, p.y);
  await expect.poll(() => width(page)).toBeCloseTo(initial + 30, 0);
  await page.mouse.up();
  expect(await editor.evaluate((el) => el === (window as any).originalEditor)).toBe(true);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selection);
  await expect(editor).toBeFocused();
  await page.reload();
  await expect.poll(() => width(page)).toBeCloseTo(initial + 30, 0);
});

test("Escape, blur and pointer cancellation restore the pre-drag width", async ({ page }) => {
  const initial = await width(page);
  for (const cause of ["escape", "blur", "pointercancel"]) {
    const p = await start(page);
    await page.mouse.move(p.x + 90, p.y);
    await expect.poll(() => width(page)).toBeGreaterThan(initial + 60);
    if (cause === "escape") await page.keyboard.press("Escape");
    else await page.evaluate((cause) => {
      if (cause === "blur") window.dispatchEvent(new Event("blur"));
      else window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));
    }, cause);
    await page.mouse.up();
    await expect.poll(() => width(page)).toBeCloseTo(initial, 0);
    await expect(page.locator(".workspace")).not.toHaveAttribute("data-sidebar-resizing", "true");
  }
});

test("keyboard sizing, bounds, hiding and reset", async ({ page }) => {
  const handle = page.getByRole("separator", { name: "Resize sidebar" });
  const initial = await width(page);
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => width(page)).toBeCloseTo(initial + 10, 0);
  await page.keyboard.press("End");
  const max = Number(await handle.getAttribute("aria-valuemax"));
  await expect.poll(() => width(page)).toBeCloseTo(max, 0);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => width(page)).toBeCloseTo(max, 0);
  await page.keyboard.press("Home");
  await expect.poll(() => width(page)).toBeCloseTo(Number(await handle.getAttribute("aria-valuemin")), 0);
  await handle.dblclick();
  await expect.poll(() => width(page)).toBeCloseTo(initial, 0);
  expect(await page.evaluate(() => localStorage.getItem("notify-sidebar-width"))).toBeNull();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(handle).toBeHidden();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(handle).toBeVisible();
});

test("narrow windows clamp saved width and restore it when room returns under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  const p = await start(page);
  await page.mouse.move(p.x + 1000, p.y);
  await page.mouse.up();
  const preferred = await width(page);
  await page.setViewportSize({ width: 850, height: 600 });
  await expect.poll(() => width(page)).toBeLessThan(preferred);
  const editorWidth = await page.locator(".document-panel").evaluate((el) => el.getBoundingClientRect().width);
  expect(editorWidth).toBeGreaterThanOrEqual(360);
  expect(await page.locator(".workspace").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 920 });
  await expect.poll(() => width(page)).toBeCloseTo(preferred, 0);
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  const free = await start(page);
  await page.mouse.move(free.x + 1000, free.y);
  await page.mouse.up();
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await expect.poll(async () => page.locator(".document-panel").evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(360);
  await page.setViewportSize({ width: 960, height: 700 });
  const overlay = await page.locator(".reference-panel").boundingBox();
  const workspace = await page.locator(".workspace").boundingBox();
  expect(overlay!.y).toBeCloseTo(workspace!.y, 0);
  expect(overlay!.height).toBeCloseTo(workspace!.height, 0);
  await page.setViewportSize({ width: 650, height: 700 });
  await expect(page.getByRole("separator", { name: "Resize sidebar" })).toBeHidden();
});
