import { test, expect } from '@playwright/test';

// E2E do undo/redo (v0.6.0 B1): teclado no canvas, botões do header com
// tooltip do rótulo, guarda do input (Ctrl+Z dentro do editor desfaz TEXTO,
// não grafo) e lote de IA como UMA entrada.
test.beforeEach(async ({ request }) => {
  // mapas limpos: boot determinístico de 1 nó
  const maps = await (await request.get('http://127.0.0.1:8000/api/v1/maps')).json();
  for (const m of maps) {
    await request.delete(`http://127.0.0.1:8000/api/v1/maps/${m.id}`).catch(() => {});
  }
});

const undoBtn = page => page.locator('button[aria-label="Desfazer"]');
const redoBtn = page => page.locator('button[aria-label="Refazer"]');

async function addChild(page) {
  // SEM renomear: label padrão sem mudança = 1 entrada ('adicionar nó').
  // Escape fecha o editor (B3: Enter passou a CRIAR FILHO — não serve aqui).
  await page.locator('.react-flow__node').first().click();
  await page.getByRole('button', { name: 'Adicionar Filho' }).click();
  await page.locator('textarea[aria-label="Texto do nó"]').press('Escape');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
}

test('(a) adicionar → Ctrl+Z → Ctrl+Shift+Z (teclado no canvas)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  await addChild(page);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);

  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
});

test('(b) guarda do input: Ctrl+Z no editor desfaz TEXTO, não grafo', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  // sem ações de grafo: ↩ começa desabilitado
  await expect(undoBtn(page)).toBeDisabled();

  await page.locator('.react-flow__node').first().dblclick();
  const editor = page.locator('textarea[aria-label="Texto do nó"]');
  await expect(editor).toBeVisible();
  await editor.fill('Nó Raiz editado');

  // Ctrl+Z dentro do textarea = undo NATIVO do campo (o store não é tocado)
  await editor.press('Control+z');
  await expect(editor).toHaveValue(/Nó Raiz/);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(undoBtn(page)).toBeDisabled(); // nenhuma entrada de grafo

  // e fora do editor o undo de grafo volta a valer
  await page.keyboard.press('Escape'); // sai da edição sem gravar
  await page.getByRole('button', { name: 'Adicionar Nó Raiz' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  const novoEditor = page.locator('textarea[aria-label="Texto do nó"]');
  if (await novoEditor.isVisible().catch(() => false)) await novoEditor.press('Escape');
  await expect(undoBtn(page)).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
});

test('(c) botões do header com tooltip do rótulo da entrada pendente', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  await addChild(page);
  await expect(undoBtn(page)).toBeEnabled();
  await expect(undoBtn(page)).toHaveAttribute('title', 'Desfazer: adicionar nó');
  await expect(redoBtn(page)).toBeDisabled();

  await undoBtn(page).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(redoBtn(page)).toHaveAttribute('title', 'Refazer: adicionar nó');

  await redoBtn(page).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
});

test('(d) lote de IA = UMA entrada de undo', async ({ page }) => {
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

  await addChild(page);

  // seleção múltipla (Ctrl+clique no filho = último selecionado)
  const filho = page.locator('.react-flow__node').filter({
    has: page.getByText('Novo Filho', { exact: true }),
  });
  await filho.click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'Expandir 2 nós com IA' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4); // raiz + filho + 2 sugestões

  // as sugestões nascem em edição (isNew): fecha o editor antes do Ctrl+Z
  // (a guarda do input desviaria o atalho para o undo nativo do campo)
  await page.keyboard.press('Escape');

  // UM Ctrl+Z desfaz o lote inteiro (as 2 sugestões somem juntas)
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
});
