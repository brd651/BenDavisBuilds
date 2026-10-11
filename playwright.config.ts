import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4321', browserName: 'chromium', trace: 'off' },
  webServer: { command: 'npm run preview -- --port 4321', url: 'http://127.0.0.1:4321', reuseExistingServer: !process.env.CI },
});
