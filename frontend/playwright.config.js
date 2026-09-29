import { defineConfig, devices } from '@playwright/test';

// E2E do MindWeave AI.
// - app.spec.js: rotas /api/* mockadas via page.route (hermético).
// - persistence.spec.js: usa o backend REAL (segundo webServer, banco próprio).
export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  fullyParallel: false, // testes de persistência compartilham o /last do backend real
  workers: 1, // e sem paralelismo ENTRE arquivos: o beforeEach de um limpa o mapa do outro
  retries: process.env.CI ? 2 : 0, // runners do Actions são mais lentos — janelas de tempo estouram
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
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
    {
      // Mock upstream LM Studio (OpenAI-compatible) — controlável por /control?mode=
      command: 'python tests/mock_upstream.py 1234 ok-openai',
      cwd: '../backend',
      url: 'http://127.0.0.1:1234/',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      // Mock upstream Ollama — controlável por /control?mode=
      command: 'python tests/mock_upstream.py 11434 ok-ollama',
      cwd: '../backend',
      url: 'http://127.0.0.1:11434/',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
