import { test, expect } from '@playwright/test';

// E2Es do fechamento da v0.4.5 (B4): Resumir mapa (reusa o chat), expansão
// em lote (seleção múltipla) e reordenação da cadeia por drag (dnd-kit).
// Backend REAL; rotas de IA mockadas no nível do page.route.
test.beforeEach(async ({ request }) => {
  const keys = await (await request.get('http://127.0.0.1:8000/api/v1/ai/keys')).json();
  for (const k of keys) {
    await request.delete(`http://127.0.0.1:8000/api/v1/ai/keys/${k.provider}`).catch(() => {});
  }
  await request.post('http://127.0.0.1:8000/api/v1/ai/keys/reset-cooldowns');
  await request.post('http://127.0.0.1:8000/api/v1/ai/chain/reset');
  // mapas limpos: cada teste boota com um mapa novo de 1 nó (Fricção Zero)
  const maps = await (await request.get('http://127.0.0.1:8000/api/v1/maps')).json();
  for (const m of maps) {
    await request.delete(`http://127.0.0.1:8000/api/v1/maps/${m.id}`).catch(() => {});
  }
});

test.afterEach(async ({ request }) => {
  await request.post('http://127.0.0.1:8000/api/v1/ai/chain/reset');
});

// (a) Resumir mapa: abre a aba Chat com a pergunta fixa e a resposta em stream
test('(a) Resumir mapa: abre a aba Chat e anexa a resposta', async ({ page }) => {
  await page.route('**/api/v1/ai/chat/stream', async (route) => {
    const body = route.request().postDataJSON();
    const sse = [
      { event: 'chain', provider: 'lmstudio', provider_label: 'LM Studio (local)', status: 'trying' },
      { event: 'chain', provider_label: 'LM Studio (local)', status: 'committed' },
      { event: 'token', delta: `Resumo do mapa sobre: ${body.question.slice(0, 20)}…` },
      { event: 'done', provider_used: 'LM Studio (local)', model: 'm', fallback_trail: [],
        context_meta: { strategy: 'outline', nodes_included: 1, chars: 90 } },
    ].map((ev) => `data: ${JSON.stringify(ev)}\n\n`).join('');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse });
  });

  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  await page.getByRole('button', { name: /Mapas/ }).click();
  await page.getByRole('button', { name: '📄 Resumir mapa' }).click();

  // a aba Chat abre automaticamente e a conversa nasce lá
  await expect(page.locator('input[aria-label="Pergunta para o chat"]')).toBeVisible();
  await expect(page.getByText(/resumo executivo/).first()).toBeVisible();
  await expect(page.getByText(/Resumo do mapa sobre/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Resumo gerado na aba Chat')).toBeVisible();
});

// (b) Seleção múltipla → "Expandir N nós com IA" no último selecionado
test('(b) expandir 2 nós selecionados em lote', async ({ page }) => {
  await page.route('**/api/v1/ai/suggest-nodes-batch', async (route) => {
    const body = route.request().postDataJSON();
    const results = body.node_ids.map((id) => ({
      node_id: id,
      suggestedNodes: [{ content: `Sugestão de ${id}` }],
      provider_used: 'Ollama (local)',
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }) });
  });

  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  // cria um filho e confirma o rótulo (o nó nasce em modo de edição)
  await page.locator('.react-flow__node').first().click();
  await page.getByRole('button', { name: 'Adicionar Filho' }).click();
  await page.locator('textarea[aria-label="Texto do nó"]').fill('Filho');
  // commit por blur (B3: Enter passou a criar filho)
  await page.locator('.react-flow__node').first().click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  // seleção múltipla: Ctrl+click no segundo nó (multiSelectionKeyCode do
  // React Flow; Shift é o modificador da seleção por retângulo).
  // Filtro exato: hasText simples casaria com o botão "Adicionar Filho" do raiz.
  const filho = page.locator('.react-flow__node').filter({
    has: page.getByText('Filho', { exact: true }),
  });
  await filho.click({ modifiers: ['Control'] });
  await expect(page.getByRole('button', { name: 'Expandir 2 nós com IA' })).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: 'Expandir 2 nós com IA' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4); // raiz + filho + 2 sugestões
  await expect(page.getByText('2 nós sugeridos adicionados')).toBeVisible();
});

// (c) Cadeia: reordenação por drag no handle ⠿ (dnd-kit) reflete no servidor
test('(c) drag handle reordena a cadeia e salva', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });
  await page.getByRole('button', { name: 'IA Config' }).click();
  await expect(page.getByRole('heading', { name: 'Cadeia de Provedores' })).toBeVisible();

  const rowOf = (provider) =>
    page.locator('div.rounded-md', { has: page.locator(`span[title="${provider}"]`) });

  // arrasta o handle ⠿ do lmstudio (último) DUAS linhas para cima (openai):
  // deslocamento maior evita ambiguidade de colisão na linha vizinha.
  const handle = rowOf('lmstudio').locator('button[aria-label="Reordenar lmstudio"]');
  const alvo = await rowOf('openai').boundingBox();
  expect(alvo).not.toBeNull();
  await handle.hover();
  await page.mouse.down();
  await page.mouse.move(alvo.x + alvo.width / 2, alvo.y + alvo.height / 2, { steps: 12 });
  await page.mouse.up();

  await page.getByRole('button', { name: 'Salvar cadeia' }).click();
  await expect(page.getByText('Cadeia salva').first()).toBeVisible({ timeout: 10000 });

  // o servidor reflete o drag: lmstudio subiu acima do ollama
  const chain = await (await request.get('http://127.0.0.1:8000/api/v1/ai/chain')).json();
  const lm = chain.findIndex((c) => c.provider === 'lmstudio');
  const ol = chain.findIndex((c) => c.provider === 'ollama');
  expect(lm).toBeLessThan(ol);
});
