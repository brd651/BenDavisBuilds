import type { Page } from '@playwright/test';

export async function chooseTheme(page: Page, theme: string) {
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const label = theme.charAt(0).toUpperCase() + theme.slice(1);
  await page.getByRole('button', { name: label, exact: true }).click();
}
