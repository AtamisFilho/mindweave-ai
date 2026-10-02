import fs from 'node:fs';
import { test, expect } from '@playwright/test';

// E2E do B2 (export Markdown, download real via backend) e B2.5 (o diário de
// pesquisas sobrevive ao F5 — meta.research no blob).
test.beforeEach(async ({ request }) => {
  const maps = await (await request.get('http://127.0.0.1:8000/api/v1/maps')).json();
  for (const m of maps) {
    await request.delete(`http://127.0.0.1:8000/api/v1/maps/${m.id}`).catch(() => {});
  }
});

test('(B2) export: item desabilitado com ≤1 nó; download com H1 e aninhamento', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  const openMenu = async () => {
    await page.getByRole('button', { name: /Mapas/ }).click();
    await expect(page.getByText('＋ Novo mapa')).toBeVisible(); // gate: menu aberto
  };

  // ≤1 nó: desabilitado com tooltip explicando
  await openMenu();
  const item = page.getByRole('button', { name: /Markdown \(\.md\)/ });
  await expect(item).toBeDisabled();
  await expect(item).toHaveAttribute('title', /Adicione nós ao mapa antes de exportar/);
  await page.getByRole('button', { name: /Mapas/ }).click(); // fecha

  // adiciona um filho e exporta (backend REAL)
  await page.locator('.react-flow__node').first().click();
  await page.getByRole('button', { name: 'Adicionar Filho' }).click();
  const editor = page.locator('textarea[aria-label="Texto do nó"]');
  await editor.fill('Solar');
  await editor.press('Enter');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  // o export lê do SERVIDOR: espera o autosave (debounce 1s) persistir o filho
  await expect.poll(async () => {
    const res = await request.get('http://127.0.0.1:8000/api/v1/maps/last');
    if (res.status() !== 200) return 0;
    const m = await res.json();
    return m.document?.nodes?.length ?? 0;
  }, { timeout: 10000 }).toBe(2);

  await openMenu();
  await expect(item).toBeEnabled();

  const downloadPromise = page.waitForEvent('download');
  await item.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  const content = fs.readFileSync(await download.path(), 'utf8');
  expect(content).toMatch(/^# Mapa sem título\n/); // H1 = título do mapa
  expect(content).toContain('- Nó Raiz');
  expect(content).toContain('  - Solar'); // aninhado sob a raiz
  await expect(page.getByText(/Exportado: .+\.md/)).toBeVisible(); // toast
});

test('(B2.5) pesquisa sobrevive ao F5 (meta.research no blob)', async ({ page, request }) => {
  await page.route('**/api/v1/ai/deep-research/stream', async (route) => {
    const sse = [
      { event: 'chain', provider: 'lmstudio', provider_label: 'LM Studio (local)', status: 'trying' },
      { event: 'chain', provider_label: 'LM Studio (local)', status: 'committed' },
      { event: 'token', delta: 'Achado: o mapa cobre o tema central.' },
      { event: 'done', provider_used: 'LM Studio (local)', model: 'm', fallback_trail: [] },
    ].map((ev) => `data: ${JSON.stringify(ev)}\n\n`).join('');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse });
  });

  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  await page.locator('.react-flow__node').first().click();
  await page.getByRole('button', { name: 'Pesquisa IA' }).click();
  await expect(page.getByText('Pesquisa concluída').first()).toBeVisible({ timeout: 15000 });

  // o autosave tem debounce de 1s: espera o PUT com meta.research aterrissar
  await expect.poll(async () => {
    const res = await request.get('http://127.0.0.1:8000/api/v1/maps/last');
    if (res.status() !== 200) return 0;
    const m = await res.json();
    return m.document?.meta?.research?.length ?? 0;
  }, { timeout: 10000 }).toBeGreaterThan(0);

  // F5: o diário vem do servidor (meta.research), não da sessão
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });
  await page.getByRole('button', { name: 'Pesquisas' }).click();
  await expect(page.getByText('Achado: o mapa cobre o tema central.')).toBeVisible({ timeout: 10000 });
});
