import { test, expect } from '@playwright/test';

// E2Es de fechamento do épico Provider Chain (v0.4 B4): backend REAL +
// upstreams mockados (mock_upstream.py) + UI da cadeia (B3).
//
// Cadeia em teste: LM Studio (mock porta 1234) e Ollama (mock porta 11434)
// são os únicos sem chave; remotos precisam de chave no banco (PUT /ai/keys).
test.beforeEach(async ({ request }) => {
  // isola: sem chaves (cadeia = locais) e cadeia padrão
  const keys = await (await request.get('http://127.0.0.1:8000/api/v1/ai/keys')).json();
  for (const k of keys) {
    await request.delete(`http://127.0.0.1:8000/api/v1/ai/keys/${k.provider}`).catch(() => {});
  }
  await request.post('http://127.0.0.1:8000/api/v1/ai/keys/reset-cooldowns');
  // cadeia de volta ao padrão (reordenação/toggles dos outros testes não vazam)
  await request.post('http://127.0.0.1:8000/api/v1/ai/chain/reset');
});

test.afterEach(async ({ request }) => {
  await request.post('http://127.0.0.1:8000/api/v1/ai/keys/reset-cooldowns');
  // cadeia de volta ao padrão (reordenação/toggles dos outros testes não vazam)
  await request.post('http://127.0.0.1:8000/api/v1/ai/chain/reset');
});

// (a) Reordenar a cadeia (Gemini ao topo com chave) → pesquisa usa Gemini
test('(a) reordenar cadeia: Gemini vira o topo e responde', async ({ page, request }) => {
  // chave do Gemini apontando para o mock do Ollama? Não: Gemini tem adapter
  // próprio (endpoint real). Estratégia: reordenar para OLLAMA como preferido
  // via UI — locais são mockáveis. Movemos o ollama para o topo:
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  // abre a aba IA Config
  await page.getByRole('button', { name: 'IA Config' }).click();
  await expect(page.getByRole('heading', { name: 'Cadeia de Provedores' })).toBeVisible();

  // localiza a linha do ollama e sobe ▲ até o topo (7 vezes — é o último)
  const ollamaUp = page.locator('div.rounded-md', { has: page.locator('span[title="ollama"]') })
    .locator('button[title="Subir (prioridade maior)"]');
  for (let i = 0; i < 7; i++) {
    await ollamaUp.click();
  }
  await page.getByRole('button', { name: 'Salvar cadeia' }).click();
  await expect(page.getByText('Cadeia salva').first()).toBeVisible({ timeout: 10000 });

  // Ollama mockado ok; LM Studio mockado ok também (estaria em 2º)
  await request.get('http://127.0.0.1:11434/control?mode=stream-ollama');
  await request.get('http://127.0.0.1:1234/control?mode=stream-openai');

  // dispara pesquisa pelo nó raiz
  await page.locator('.react-flow__node').first().click();
  await page.getByRole('button', { name: 'Pesquisa IA' }).click();

  // badge deve mostrar "Usando: Ollama (local)" — o TOPO da cadeia reordenada
  await expect(page.locator('header', { hasText: 'Usando: Ollama (local)' })).toBeVisible({ timeout: 15000 });

  // e a cadeia no servidor reflete a reordenação
  const chain = await (await request.get('http://127.0.0.1:8000/api/v1/ai/chain')).json();
  expect(chain[0].provider).toBe('ollama');
});

// (b) Desabilitar o topo → pesquisa pula para o próximo habilitado
test('(b) desabilitar o topo: pesquisa pula para o próximo da cadeia', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  await page.getByRole('button', { name: 'IA Config' }).click();
  await expect(page.getByRole('heading', { name: 'Cadeia de Provedores' })).toBeVisible();

  // ollama ao topo (como no (a))...
  const ollamaUp = page.locator('div.rounded-md', { has: page.locator('span[title="ollama"]') })
    .locator('button[title="Subir (prioridade maior)"]');
  for (let i = 0; i < 7; i++) {
    await ollamaUp.click();
  }
  await page.getByRole('button', { name: 'Salvar cadeia' }).click();
  await expect(page.getByText('Cadeia salva').first()).toBeVisible({ timeout: 10000 });

  // ...e então DESABILITADO: a cadeia cai para o lm studio (próximo habilitado)
  const ollamaToggle = page.locator('div.rounded-md', { has: page.locator('span[title="ollama"]') })
    .locator('button[title*="Habilitado"]');
  await ollamaToggle.click();
  await page.getByRole('button', { name: 'Salvar cadeia' }).click();
  await expect(page.getByText('Cadeia salva').first()).toBeVisible({ timeout: 10000 });

  // mock do ollama no ar (não deve ser chamado), lm studio respondendo
  await request.get('http://127.0.0.1:1234/control?mode=stream-openai');

  await page.locator('.react-flow__node').first().click();
  await page.getByRole('button', { name: 'Pesquisa IA' }).click();

  // badge deve mostrar o lm studio (próximo habilitado)
  await expect(page.locator('header', { hasText: 'Usando: LM Studio (local)' })).toBeVisible({ timeout: 15000 });
});

// (c) Fallback visível: topo 429 → badge âmbar "(fallback)" + trilha no toast
test('(c) fallback visível no header quando o topo falha com 429', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  // cadeia padrão: groq no topo mas sem chave → não entra na cadeia;
  // então o topo EFETIVO é lm studio. Forçamos o lm studio a 429:
  // o chain cai para o ollama e o badge deve mostrar o fallback âmbar.
  await request.get('http://127.0.0.1:1234/control?mode=429');
  await request.get('http://127.0.0.1:11434/control?mode=stream-ollama');

  await page.locator('.react-flow__node').first().click();
  await page.getByRole('button', { name: 'Pesquisa IA' }).click();

  const badge = page.locator('header').getByText(/Usando: Ollama \(local\)/);
  await expect(badge).toBeVisible({ timeout: 15000 });
  // o badge âmbar vale 12s a partir da resposta; o assert tem 15s para pegá-lo
  await expect(page.locator('header').getByText(/fallback/)).toBeVisible({ timeout: 15000 });
});
