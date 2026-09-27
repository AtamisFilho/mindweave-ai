import { defineConfig, devices } from '@playwright/test';

// E2E do MindWeave AI.
// - app.spec.js: rotas /api/* mockadas via page.route (hermético).
// - persistence.spec.js: usa o backend REAL (segundo webServer, banco próprio).
export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  fullyParallel: false, // testes de persistência compartilham o /last do backend real
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      // Backend real para os E2Es de persistência; em CI roda com python do setup-python
      command: 'python -m uvicorn app.main:app --host 127.0.0.1 --port 8000',
      cwd: '../backend',
      url: 'http://127.0.0.1:8000/',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      env: process.env.CI ? { DATABASE_URL: 'sqlite:///./e2e_mindweave.db' } : {},
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
