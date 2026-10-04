import { test, expect } from "@playwright/test";

test("icon follows explicit theme, rapid reversals, and the saved preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const icon = page.locator('link[rel="icon"]');
  await expect(page.getByRole("button", { name: "Use dark mode" })).toBeVisible();
  await expect(icon).toHaveAttribute("href", "/scribly-icon.png");
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Use dark mode" }).click();
    await expect(icon).toHaveAttribute("href", "/scribly-icon-dark.png");
    await page.getByRole("button", { name: "Use light mode" }).click();
    await expect(icon).toHaveAttribute("href", "/scribly-icon.png");
  }
  await page.getByRole("button", { name: "Use dark mode" }).click();
  await expect.poll(() => page.evaluate(() => {
    const stored = localStorage.getItem("still-notes-browser-v1");
    return stored && JSON.parse(stored).document.theme;
  })).toBe("dark");
  await page.reload();
  await expect(icon).toHaveAttribute("href", "/scribly-icon-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(icon).toHaveAttribute("href", "/scribly-icon-dark.png");
});

test("System appearance updates the icon live and both assets decode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "System", exact: true }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveAttribute("href", "/scribly-icon.png");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(icon).toHaveAttribute("href", "/scribly-icon-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(icon).toHaveAttribute("href", "/scribly-icon.png");
  const dimensions = await page.evaluate(async () => {
    return Promise.all(["/scribly-icon.png", "/scribly-icon-dark.png"].map(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }));
  });
  expect(dimensions).toEqual([[64, 64], [64, 64]]);
});
