import { test, expect } from '@playwright/test';

// E2Es do layout (v0.5) contra o BACKEND REAL: o layout aplicado tem que
// sobreviver ao reload via autosave (positions + meta no documento).
test.beforeEach(async ({ page, request }) => {
  await page.route('**/api/v1/ai/**', (route) => route.fulfill({ json: {} }));
  const maps = await (await request.get('http://127.0.0.1:8000/api/v1/maps')).json();
  for (const map of maps) {
    await request.delete(`http://127.0.0.1:8000/api/v1/maps/${map.id}`);
  }
});

test.afterAll(async ({ request }) => {
  try {
    const maps = await (await request.get('http://127.0.0.1:8000/api/v1/maps')).json();
    for (const map of maps) {
      if (map.title.startsWith('E2E ') || map.title === 'Mapa sem título') {
        await request.delete(`http://127.0.0.1:8000/api/v1/maps/${map.id}`);
      }
    }
  } catch { /* teardown best-effort */ }
});

async function openLayoutPopover(page) {
  await page.locator('button', { hasText: '⚡ Layout' }).first().click();
  await expect(page.locator('select[aria-label="Schema do layout"]')).toBeVisible();
}

async function transformsOf(page) {
  return page.$$eval('.react-flow__node', (els) => els.map((e) => e.style.transform));
}

test.afterAll(async ({ request }) => {
  try {
    const maps = await (await request.get('http://127.0.0.1:8000/api/v1/maps')).json();
    for (const map of maps) {
      if (map.title.startsWith('E2E ') || map.title === 'Mapa sem título') {
        await request.delete(`http://127.0.0.1:8000/api/v1/maps/${map.id}`);
      }
    }
  } catch { /* teardown best-effort */ }
});

test('layout aplicado sobrevive ao reload (posições + schema persistidos)', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  // filho via "Adicionar Filho" (raiz+filho no MESMO grafo — "Nó Raiz" criaria
  // uma 2ª raiz desconexa, que o LR posiciona no mesmo rank, x≈0)
  await page.locator('.react-flow__node').first().click();
  await page.getByRole('button', { name: 'Adicionar Filho' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  // Popover: schema LR + aplicar posições
  await openLayoutPopover(page);
  await page.selectOption('select[aria-label="Schema do layout"]', 'LR');
  await page.getByRole('button', { name: 'Aplicar posições agora' }).click();

  // servidor tem o layout (filho à direita da raiz no documento)
  await expect
    .poll(async () => {
      const map = await (await request.get('http://127.0.0.1:8000/api/v1/maps/last')).json();
      const [n1, n2] = map.document.nodes;
      return n2 && n1 && n2.position.x > n1.position.x + 200;
    }, { timeout: 10000, intervals: [300, 600] })
    .toBe(true);

  const before = await transformsOf(page);
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 15000 });

  const after = await transformsOf(page);
  // posições idênticas pós-reload (o documento carrega as posições do layout)
  expect(after[0]).toBe(before[0]);
  expect(after[1]).toBe(before[1]);
  // e o schema segue selecionado no popover
  await openLayoutPopover(page);
  await expect(page.locator('select[aria-label="Schema do layout"]')).toHaveValue('LR');
});

test('Auto: ON reorganiza sozinho após mudança estrutural', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  await openLayoutPopover(page);
  await page.selectOption('select[aria-label="Schema do layout"]', 'LR');
  await page.getByRole('button', { name: /Auto: OFF/ }).click(); // liga o auto
  await expect(page.getByRole('button', { name: /Auto: ON/ })).toBeVisible();

  // mudança estrutural: novo nó nasce perto do pai; o auto-layout (debounce
  // 800ms) deve reorganizá-lo para a posição determinística do LR
  await page.locator('.react-flow__node').first().click();
  await page.getByRole('button', { name: 'Adicionar Filho' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  await expect
    .poll(async () => {
      const t = await transformsOf(page);
      const xRoot = Number(t[0].match(/translate\(([\d.]+)px/)?.[1] ?? 0);
      const xChild = Number(t[1]?.match(/translate\(([\d.]+)px/)?.[1] ?? 0);
      return xChild > xRoot + 200;
    }, { timeout: 10000, intervals: [400, 800] })
    .toBe(true);
});
