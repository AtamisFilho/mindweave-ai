import { defineConfig, devices } from '@playwright/test';

// E2E do MindWeave AI — backend FastAPI NÃO é necessário: todas as rotas
// /api/v1/* são mockadas via page.route (suíte hermética, Diretriz 2 do Bloco 4).
export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
