import { test, expect } from '@playwright/test';

// E2E da geração de mapa (v0.4.5 B3): backend REAL + /ai/generate mockado
// (a geração de verdade exige provedor vivo — a conversão e a navegação são
// o que a UI prova aqui). Árvore assimétrica: 1 ramo com 2 filhos, outro com 1.
const TREE = {
  topic: 'Energias renováveis no Brasil',
  children: [
    { topic: 'Solar', children: [{ topic: 'Fotovoltaica' }, { topic: 'Térmica' }] },
    { topic: 'Eólica', children: [{ topic: 'Onshore' }] },
  ],
};

test.afterEach(async ({ request }) => {
  try {
    const maps = await (await request.get('http://127.0.0.1:8000/api/v1/maps')).json();
    for (const map of maps) {
      if (map.title.startsWith('Energias')) {
        await request.delete(`http://127.0.0.1:8000/api/v1/maps/${map.id}`);
      }
    }
  } catch { /* teardown best-effort */ }
});

test('gera mapa a partir de um tópico: conversão + mapa novo + toast Voltar', async ({ page, request }) => {
  await page.route('**/api/v1/ai/generate', async (route) => {
    await route.fulfill({
      status: 200,
      json: { title: TREE.topic, tree: TREE, provider_used: 'Groq', fallback_trail: [] },
    });
  });

  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  // Maps ▼ → "✨ Gerar mapa a partir de um tópico…"
  await page.getByRole('button', { name: /Mapas/ }).click();
  await page.getByText('✨ Gerar mapa a partir de um tópico').click();

  const dialog = page.locator('[role="dialog"][aria-label="Gerar mapa a partir de um tópico"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('input').first().fill('Energias renováveis no Brasil');
  await dialog.getByRole('button', { name: /Gerar mapa/ }).click();

  // mapa novo: raiz + 3 filhos (2 solar + 1 eólica)
  await expect(page.locator('.react-flow__node')).toHaveCount(4, { timeout: 15000 });
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);

  // título do mapa novo no header
  await expect(page.locator('header button[title*="Renomear"]')).toHaveText('Energias renováveis no Brasil');

  // toast "Voltar ao anterior" presente (mapa anterior não é órfão)
  await expect(page.getByText(/Voltar ao anterior/).first()).toBeVisible();

  // autosave persistiu o mapa gerado
  await expect
    .poll(async () => {
      const res = await request.get('http://127.0.0.1:8000/api/v1/maps/last');
      if (res.status() !== 200) return null;
      const m = await res.json();
      return m.document.nodes.length === 4 && m.title === 'Energias renováveis no Brasil' ? true : null;
    }, { timeout: 10000 })
    .toBe(true);
});
