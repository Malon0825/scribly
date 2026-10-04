import { test, expect, type Page } from "@playwright/test";

const width = (page: Page) => page.locator(".reference-panel").evaluate(el => el.getBoundingClientRect().width);
const handle = (page: Page) => page.getByRole("separator", { name: "Resize reference" });
async function start(page: Page) {
  const box = (await handle(page).boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + 80 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  return point;
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole('button', { name: 'Reference', exact: true }).click();
  await page.locator('.workspace').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))));
  await expect(handle(page)).toBeVisible();
});

test("drag tracks both directions, preserves the draft and selection, and remembers width", async ({ page }) => {
  const editor = page.getByRole("textbox", { name: "Note content", exact: true });
  await editor.fill("Keep this selected draft while resizing Reference.");
  await editor.evaluate(el => {
    (window as any).originalEditor = el;
    const range = document.createRange();
    range.selectNodeContents(el.firstChild!);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  });
  const selection = await page.evaluate(() => window.getSelection()?.toString());
  const initial = await width(page);
  const p = await start(page);
  await expect(handle(page)).toHaveAttribute("data-pressed", "true");
  await page.mouse.move(p.x - 5, p.y);
  expect(await width(page)).toBeCloseTo(initial, 0);
  await page.mouse.move(p.x - 80, p.y);
  await expect.poll(() => width(page)).toBeCloseTo(initial + 80, 0);
  await page.mouse.move(p.x - 30, p.y);
  await expect.poll(() => width(page)).toBeCloseTo(initial + 30, 0);
  await page.mouse.up();
  await expect(editor).toBeFocused();
  expect(await editor.evaluate(el => el === (window as any).originalEditor)).toBe(true);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selection);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1") || "null")?.document.notes.some((note: { content: string }) => note.content.includes("Keep this selected draft while resizing Reference.")))).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Reference', exact: true }).click();
  await expect.poll(() => width(page)).toBeCloseTo(initial + 30, 0);
  await expect(editor).toHaveText(selection!);
});

test("Escape, blur, pointercancel and lost capture restore the last committed width", async ({ page }) => {
  const initial = await width(page);
  for (const cause of ["escape", "blur", "pointercancel", "lostpointercapture"]) {
    const p = await start(page);
    await page.mouse.move(p.x - 90, p.y);
    await expect.poll(() => width(page)).toBeCloseTo(initial + 90, 0);
    if (cause === "escape") await page.keyboard.press("Escape");
    else await page.evaluate(cause => {
      if (cause === "blur") window.dispatchEvent(new Event("blur"));
      else if (cause === "lostpointercapture") document.querySelector(".reference-resize")!.dispatchEvent(new PointerEvent(cause, { pointerId: 1 }));
      else window.dispatchEvent(new PointerEvent(cause, { pointerId: 1 }));
    }, cause);
    await page.mouse.up();
    await expect.poll(() => width(page)).toBeCloseTo(initial, 0);
    await expect(page.locator(".workspace")).not.toHaveAttribute("data-reference-resizing", "true");
    await expect(handle(page)).not.toHaveAttribute("data-pressed", "true");
  }
});

test("keyboard follows the divider direction, clamps at limits, and resets", async ({ page }) => {
  const initial = await width(page);
  await handle(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => width(page)).toBeCloseTo(initial + 10, 0);
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => width(page)).toBeCloseTo(initial - 30, 0);
  await page.keyboard.press("End");
  const max = Number(await handle(page).getAttribute("aria-valuemax"));
  await expect.poll(() => width(page)).toBeCloseTo(max, 0);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => width(page)).toBeCloseTo(max, 0);
  await page.keyboard.press("Home");
  await expect.poll(() => width(page)).toBeCloseTo(Number(await handle(page).getAttribute("aria-valuemin")), 0);
  await handle(page).dblclick();
  await expect.poll(() => width(page)).toBeCloseTo(initial, 0);
  expect(await page.evaluate(() => localStorage.getItem("notify-reference-width"))).toBeNull();
});

test("both resizers reserve writing space and saved widths adapt to narrow overlays", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await handle(page).focus(); await page.keyboard.press("End");
  const preferred = await width(page);
  await page.getByRole("separator", { name: "Resize sidebar" }).focus();
  await page.keyboard.press("End");
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect.poll(async () => page.locator(".document-panel").evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(359.5);
  await expect.poll(() => width(page)).toBeLessThan(preferred);
  await page.setViewportSize({ width: 960, height: 700 });
  await expect.poll(() => width(page)).toBeCloseTo(preferred, 0);
  const p = await start(page);
  await page.mouse.move(p.x + 50, p.y); await page.mouse.up();
  await expect.poll(() => width(page)).toBeCloseTo(preferred - 50, 0);
  await page.setViewportSize({ width: 650, height: 700 });
  await expect(handle(page)).toBeVisible();
  const panelBox = (await page.locator(".reference-panel").boundingBox())!;
  const handleBox = (await handle(page).boundingBox())!;
  expect(handleBox.x + handleBox.width / 2).toBeCloseTo(panelBox.x, 0);
  expect(await page.locator(".workspace").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("hiding or focusing away removes the handle and restores keyboard focus", async ({ page }) => {
  await handle(page).focus();
  await page.keyboard.press("Control+Shift+f");
  await expect(handle(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Focus", exact: true })).toBeFocused();
  await page.keyboard.press("Control+Shift+f");
  await expect(handle(page)).toBeVisible();
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await expect(handle(page)).toBeHidden();
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await expect(handle(page)).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} note actions stay inset and clear of long note text`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const title = "A very long note title that must leave room for its More button";
    await page.getByRole("textbox", { name: "Note title", exact: true }).fill(title);
    const row = page.locator(".note-row.active");
    await row.hover();
    const actions = page.getByRole("button", { name: `Actions for ${title}`, exact: true });
    const rowBox = (await row.boundingBox())!;
    const actionBox = (await actions.boundingBox())!;
    const textBox = (await row.locator(".note-name").boundingBox())!;
    expect(rowBox.x + rowBox.width - actionBox.x - actionBox.width).toBeGreaterThanOrEqual(8);
    expect(textBox.x + textBox.width).toBeLessThan(actionBox.x);
    await actions.click();
    await expect(page.locator(".sidebar-note-dropdown")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(actions).toBeFocused();
  });
}
