import { test, expect } from '@playwright/test';

// Fixture de config — provider ollama "disponível" (as chamadas de IA são mockadas)
const CONFIG_FIXTURE = {
  selectedProvider: 'ollama',
  ollamaConfig: { baseUrl: 'http://localhost:11434', model: 'llama3' },
  isOpenAiKeySet: false,
  isGoogleKeySet: false,
};

// Fixture de resposta em Markdown (tabela + listas) — Diretriz 2 do Bloco 4
const MD_FIXTURE = [
  '## Machine Learning — resumo',
  '',
  '**ML** é um subcampo da *IA*. Paradigmas:',
  '',
  '- **Supervisionado**: regressão',
  '- **Não supervisionado**: clustering',
  '',
  '| Paradigma | Exemplo |',
  '|---|---|',
  '| Supervisionado | Random Forest |',
].join('\n');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/ai/config', (route) => route.fulfill({ json: CONFIG_FIXTURE }));
  await page.route('**/api/v1/ai/deep-research', async (route) => {
    const body = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 300)); // deixa o "IA Processando..." aparecer
    await route.fulfill({ json: { nodeId: body.nodeId, researchSummary: MD_FIXTURE } });
  });
  await page.route('**/api/v1/ai/suggest-nodes', (route) =>
    route.fulfill({ json: { nodeId: 'x', suggestedNodes: [{ content: 'Sugestão A' }, { content: 'Sugestão B' }] } })
  );
});

async function selectRootNode(page) {
  await page.locator('.react-flow__node').first().click();
  await expect(page.getByRole('button', { name: 'Pesquisa IA' })).toBeVisible();
}

// Diretriz 1: fluxo por cliques + estado da API mockada (sem dependência do Ollama)
test('Pesquisa IA: toast de sucesso + painel renderiza markdown', async ({ page }) => {
  await page.goto('/');
  await selectRootNode(page);
  await page.getByRole('button', { name: 'Pesquisa IA' }).click();

  await expect(page.getByText('Pesquisa concluída')).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('heading', { name: 'Pesquisas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Machine Learning — resumo' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Paradigma' })).toBeVisible();
});

// Diretriz 1: invariante do DAG pelo botão (aresta criada atomicamente no store)
test('Adicionar Filho cria nó e aresta atomicamente', async ({ page }) => {
  await page.goto('/');
  await selectRootNode(page);
  await page.getByRole('button', { name: 'Adicionar Filho' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  await page.locator('.react-flow__node').first().click();
  await page.getByRole('button', { name: 'Adicionar Filho' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});

// Sugestões: mock da API → nós inseridos com arestas + toast
test('Sugerir Nós IA insere filhos com arestas', async ({ page }) => {
  await page.goto('/');
  await selectRootNode(page);
  await page.getByRole('button', { name: 'Sugerir Nós IA' }).click();
  await expect(page.getByText('2 nós sugeridos')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});

// Único sanity check de drag (Diretriz 1: tudo o resto evita precisão de mouse).
// Cadeia vertical Raiz->A->B (sem sobreposição de nós) e drag Raiz->B: cross-link
// válido, pois B já tem pai A e a aresta Raiz->B ainda não existe.
test('sanity: drag entre handles conecta nós (cross-link permitido)', async ({ page }) => {
  await page.goto('/');
  await selectRootNode(page);
  await page.getByRole('button', { name: 'Adicionar Filho' }).click(); // Raiz->A
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  await page.locator('.react-flow__node').nth(1).click(); // seleciona A
  await page.getByRole('button', { name: 'Adicionar Filho' }).click(); // A->B
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  // Desselecionar (clique no pane vazio) para nenhum painel de ações cobrir os handles
  await page.locator('.react-flow__pane').click({ position: { x: 320, y: 60 } });
  await page.getByRole('button', { name: 'Fit View' }).click();
  await page.waitForTimeout(300);

  const sourceHandle = page.locator('.react-flow__node').nth(0).locator('.react-flow__handle.source'); // Raiz
  const targetHandle = page.locator('.react-flow__node').nth(2).locator('.react-flow__handle.target'); // B

  const from = await sourceHandle.boundingBox();
  const to = await targetHandle.boundingBox();
  expect(from).toBeTruthy();
  expect(to).toBeTruthy();
  expect(from.y).toBeGreaterThan(0); // dentro do viewport após o Fit View
  expect(from.y + from.height).toBeLessThan(page.viewportSize().height);
  expect(to.y + to.height).toBeLessThan(page.viewportSize().height);

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();

  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
});
