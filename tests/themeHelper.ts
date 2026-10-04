import type { Page } from '@playwright/test';
export async function chooseTheme(page: Page, theme: 'light' | 'dark' | 'system') {
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('dialog', { name: 'Appearance', exact: true })
    .getByRole('button', { name: theme[0].toUpperCase() + theme.slice(1), exact: true }).click();
}
