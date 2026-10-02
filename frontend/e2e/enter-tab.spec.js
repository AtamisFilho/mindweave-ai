import { test, expect } from '@playwright/test';

// E2E do B3 (v0.6.0): rajada "digitar → Enter → digitar" sem tocar o mouse,
// Tab criando irmão, e a GUARDA DE ESCOPO (a11y): fora da edição, Tab move
// o foco nativamente e Enter não cria nada.
test.beforeEach(async ({ request }) => {
  const maps = await (await request.get('http://127.0.0.1:8000/api/v1/maps')).json();
  for (const m of maps) {
    await request.delete(`http://127.0.0.1:8000/api/v1/maps/${m.id}`).catch(() => {});
  }
});

const editor = (page) => page.locator('textarea[aria-label="Texto do nó"]');

test('(a) rajada: Enter → filho, Tab → irmão, editor focado a cada tecla', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  // entra em edição da raiz (duplo clique no rótulo)
  await page.locator('.react-flow__node').first().getByText('Nó Raiz').dblclick();
  await expect(editor(page)).toBeFocused();

  await editor(page).fill('Raiz');
  await editor(page).press('Enter'); // filho da raiz, em edição
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(editor(page)).toBeFocused();
  await editor(page).fill('A');

  await editor(page).press('Enter'); // filho de A, em edição
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(editor(page)).toBeFocused();
  await editor(page).fill('B');

  await editor(page).press('Tab'); // IRMÃO de B (filho de A), em edição
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(editor(page)).toBeFocused();
  await editor(page).fill('C');
  await editor(page).press('Enter'); // fecha a rajada (filho de C)

  await expect(page.locator('.react-flow__node')).toHaveCount(5);

  // estrutura: Raiz > A > (B, C) + filho de C (ainda em edição)
  const body = await page.evaluate(() => document.body.innerText);
  expect(body).toContain('Raiz');
  for (const label of ['A', 'B', 'C']) {
    expect(body).toContain(label);
  }
  await expect(editor(page)).toHaveValue('Novo Nó'); // filho de C, em edição
});

test('(b) a11y: seleção SEM edição — Tab move foco, Enter não cria nada', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  await page.locator('.react-flow__node').first().click(); // seleciona (painel abre)
  await expect(page.getByRole('button', { name: 'Pesquisa IA' })).toBeVisible();

  // Tab fora da edição: foco nativo para o próximo tabbable (botão do painel)
  await page.keyboard.press('Tab');
  const focusedText = await page.evaluate(() => document.activeElement?.textContent ?? '');
  expect(focusedText).not.toBe('');
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON');
  await expect(page.locator('.react-flow__node')).toHaveCount(1); // zero nós criados

  // Enter fora da edição: nada é criado (o nó é um div, sem handler)
  await page.locator('.react-flow__node').first().click();
  await page.keyboard.press('Enter');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(editor(page)).toHaveCount(0); // editor nem abre
});

test('(c) Tab na raiz cria outra raiz; Escape continua não criando nada', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  await page.locator('.react-flow__node').first().getByText('Nó Raiz').dblclick();
  await expect(editor(page)).toBeFocused();
  await editor(page).press('Tab'); // irmão de raiz = outra raiz
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(editor(page)).toBeFocused();

  // Escape no editor do novo nó: cancela sem criar nada e sem gravar rótulo
  await editor(page).press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
});
