import { test, expect } from '@playwright/test';

// E2Es de persistência contra o BACKEND REAL (SQLite).
// Nada de /api/v1/maps é mockado aqui; apenas isola a IA.
//
// Sinal de "salvou": NUNCA o indicador do header (fica "Salvo" desde o boot) —
// consultamos o servidor (/last) até refletir a mudança esperada.
test.beforeEach(async ({ page, request }) => {
  await page.route('**/api/v1/ai/**', (route) => route.fulfill({ json: {} }));
  // Isolação: cada teste começa SEM mapas -> o boot sempre cria um mapa novo de 1 nó
  const maps = await (await request.get('http://127.0.0.1:8000/api/v1/maps')).json();
  for (const map of maps) {
    await request.delete(`http://127.0.0.1:8000/api/v1/maps/${map.id}`);
  }
});

const uniqueTitle = () => `E2E ${Date.now()}`;

async function waitServerDoc(request, check, description) {
  let i = 0;
  await expect
    .poll(
      async () => {
        const res = await request.get('http://127.0.0.1:8000/api/v1/maps/last');
        if (res.status() !== 200) {
          console.log(`[poll ${++i}] /last -> HTTP ${res.status()}`);
          return false;
        }
        const map = await res.json();
        console.log(`[poll ${++i}] /last -> "${map.title}" v${map.version} nós=${map.document.nodes.length}`);
        return check(map);
      },
      { timeout: 15000, intervals: [250, 500, 1000], message: `servidor nunca refletiu: ${description}` },
    )
    .toBe(true);
}

async function renameMap(page, title) {
  await page.locator('header button[title*="Renomear"]').click();
  const input = page.locator('header input[aria-label="Nome do mapa"]');
  await input.fill(title);
  await input.press('Enter');
}

test('cria -> recarrega -> está lá (autosave + boot)', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  const title = uniqueTitle();
  await renameMap(page, title);
  await page.getByRole('button', { name: 'Adicionar Nó Raiz' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  // o servidor precisa ter título + nós ANTES do reload (senão o boot traz versão velha)
  await waitServerDoc(
    request,
    (m) => m.title === title && m.document.nodes.length === 2,
    `título "${title}" com 2 nós`,
  );

  await page.reload();
  await expect(page.locator('header button[title*="Renomear"]')).toHaveText(title, { timeout: 15000 });
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
});

test('autosave dispara em mudança estrutural sem Ctrl+S', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  await page.getByRole('button', { name: 'Adicionar Nó Raiz' }).click();
  // nenhum Ctrl+S: o debounce de 1s precisa salvar sozinho
  await waitServerDoc(request, (m) => m.document.nodes.length === 2, '2 nós no servidor');

  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 15000 });
});

test('409: duas abas no mesmo mapa, a lenta recebe conflito', async ({ browser, request }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // Aba A boota primeiro (cria ou carrega o /last)
  await pageA.goto('/');
  await expect(pageA.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });
  const title = await pageA.locator('header button[title*="Renomear"]').textContent();

  // Aba B carrega o MESMO mapa
  await pageB.goto('/');
  await expect(pageB.locator('header button[title*="Renomear"]')).toHaveText(title, { timeout: 15000 });
  await expect(pageB.locator('.react-flow__node')).toHaveCount(1);

  // A salva primeiro com Ctrl+S (imediato) e o servidor avança de versão
  await pageA.getByRole('button', { name: 'Adicionar Nó Raiz' }).click();
  await pageA.keyboard.press('Control+s');
  await waitServerDoc(request, (m) => m.document.nodes.length === 2, 'versão avançada no servidor');

  // B salva com a versão velha -> 409 -> toast de conflito (nunca sobrescreve calado)
  await pageB.getByRole('button', { name: 'Adicionar Nó Raiz' }).click();
  await pageB.keyboard.press('Control+s');
  await expect(pageB.getByText('Mapa alterado em outra aba')).toBeVisible({ timeout: 15000 });
  await expect(pageB.getByRole('button', { name: 'Recarregar' })).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});

test.afterAll(async ({ request }) => {
  // limpeza: remove mapas criados pelos testes (títulos marcados ou sem título)
  try {
    const maps = await (await request.get('http://127.0.0.1:8000/api/v1/maps')).json();
    for (const map of maps) {
      if (map.title.startsWith('E2E ') || map.title === 'Mapa sem título') {
        await request.delete(`http://127.0.0.1:8000/api/v1/maps/${map.id}`);
      }
    }
  } catch {
    // backend indisponível no teardown — ignora
  }
});
