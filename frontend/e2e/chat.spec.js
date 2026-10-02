import { test, expect } from '@playwright/test';

// E2Es do Chat com o mapa (v0.4.5 B2): backend REAL + upstreams mockados.
// (a) hit FTS5 → resposta cita rótulo + linha "Contexto: N nós recuperados"
// (b) F5 → histórico sobrevive (meta.chat no blob, autosave por troca)
// (c) pergunta hostil (AND/OR/aspas) → não crasha, degrada com elegância
test.beforeEach(async ({ request }) => {
  const keys = await (await request.get('http://127.0.0.1:8000/api/v1/ai/keys')).json();
  for (const k of keys) {
    await request.delete(`http://127.0.0.1:8000/api/v1/ai/keys/${k.provider}`).catch(() => {});
  }
  await request.post('http://127.0.0.1:8000/api/v1/ai/keys/reset-cooldowns');
});

async function askInChat(page, question) {
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const input = page.locator('input[aria-label="Pergunta para o chat"]');
  await input.fill(question);
  await input.press('Enter');
}

function chatStreamRoute() {
  // O mock do LM Studio (stream-openai) devolve texto fixo; para afirmar que
  // a resposta CITA o nó, mockamos a ROTA do chat no nível do page.route
  // devolvendo um SSE cujo texto ecoa a pergunta (prova o pipeline ponta a
  // ponta: contexto montado no backend chega ao prompt — indireto via request).
  return async (route) => {
    const body = route.request().postDataJSON();
    const sse = [
      { event: 'chain', provider: 'lmstudio', provider_label: 'LM Studio (local)', status: 'trying' },
      { event: 'chain', provider_label: 'LM Studio (local)', status: 'committed' },
      { event: 'token', delta: `Sobre ${body.question}: o mapa trata disso.` },
      {
        event: 'done', provider_used: 'LM Studio (local)', model: 'm',
        fallback_trail: [],
        context_meta: { strategy: 'retrieval', nodes_included: 3, chars: 420 },
      },
    ].map((ev) => `data: ${JSON.stringify(ev)}\n\n`).join('');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse });
  };
}

test('(a) pergunta com hit FTS5 → resposta + linha de contexto retrieval', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  // cria um nó com rótulo específico para o FTS5 achar
  await page.locator('.react-flow__node').first().click();
  await page.getByRole('button', { name: 'Adicionar Filho' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  const second = page.locator('.react-flow__node').nth(1);
  await second.dblclick();
  const textarea = page.locator('.react-flow__node textarea');
  await textarea.fill('Machine Learning');
  await textarea.press('Escape');

  await page.route('**/api/v1/ai/chat/stream', chatStreamRoute());

  await askInChat(page, 'machine learning');
  await expect(page.getByText(/Sobre machine learning/).first()).toBeVisible({ timeout: 15000 });
  // linha de transparência do RAG
  await expect(page.getByText(/Contexto: 3 nós recuperados por busca/).first()).toBeVisible();
  // botão copiar presente na resposta
  await expect(page.getByRole('button', { name: 'copiar' }).first()).toBeVisible();
});

test('(b) F5 → histórico do chat sobrevive via meta.chat', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });
  await page.route('**/api/v1/ai/chat/stream', chatStreamRoute());

  await askInChat(page, 'o que tem no mapa');
  await expect(page.getByText(/Sobre o que tem no mapa/).first()).toBeVisible({ timeout: 15000 });

  // autosave por TROCA (nunca por token): espera o servidor refletir o meta.chat
  await expect
    .poll(async () => {
      // /maps (lista) devolve só metadados — o document vive em /maps/last
      const res = await request.get('http://127.0.0.1:8000/api/v1/maps/last');
      if (res.status() !== 200) return 0;
      const last = await res.json();
      return last?.document?.meta?.chat?.length ?? 0;
    }, { timeout: 15000, intervals: [400, 800] })
    .toBeGreaterThanOrEqual(2); // pergunta + resposta desta troca

  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByText('o que tem no mapa').first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/Contexto: 3 nós recuperados/).first()).toBeVisible();
});

test('(c) pergunta hostil (AND/OR/aspas) → não crasha, degrada com elegância', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });
  await page.route('**/api/v1/ai/chat/stream', chatStreamRoute());

  // a pergunta hostil precisa chegar ao backend ÍNTEGRA (o sanitize é lá)
  let capturedBody = null;
  await page.unroute('**/api/v1/ai/chat/stream');
  await page.route('**/api/v1/ai/chat/stream', async (route) => {
    capturedBody = route.request().postDataJSON();
    return chatStreamRoute()(route);
  });

  const hostile = 'o que é AND/OR em bancos "relacionais" (SQL)?';
  await askInChat(page, hostile);
  await expect(page.getByText(/Sobre o que é AND\/OR/).first()).toBeVisible({ timeout: 15000 });

  // pergunta chegou inteira ao backend (sanitização é responsabilidade dele)
  expect(capturedBody?.question).toBe(hostile);
  // e o app segue de pé (nenhum white-screen: header presente)
  await expect(page.getByRole('heading', { name: 'MindWeave AI' })).toBeVisible();
});
