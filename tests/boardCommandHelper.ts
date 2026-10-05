import type { Page } from '@playwright/test';

export async function boardCommand(page: Page, name: string) {
  const insert = ['Brand logos', 'Link to item', 'Templates\u2026', 'Import Mermaid\u2026', 'Shape library'].includes(name);
  const trigger = page.getByRole('button', { name: insert ? 'Insert' : 'Export', exact: true });
  if (await trigger.getAttribute('aria-expanded') != 'true') await trigger.click();
  await page.getByRole('dialog', { name: insert ? 'Insert into board' : 'Export this board', exact: true })
    .getByRole('button', { name, exact: true }).click();
}
