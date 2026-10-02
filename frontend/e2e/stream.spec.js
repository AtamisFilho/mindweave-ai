import { test, expect } from '@playwright/test';

// E2E do streaming (v0.4.5 B1): mock upstream em modos de stream + UI.
// Cenários: tokens progressivos com linha de status viva e
// PROVIDER_STREAM_INTERRUPTED (morte APÓS o commit) com "Tentar novamente".
test.beforeEach(async ({ request }) => {
  const keys = await (await request.get('http://127.0.0.1:8000/api/v1/ai/keys')).json();
  for (const k of keys) {
    await request.delete(`http://127.0.0.1:8000/api/v1/ai/keys/${k.provider}`).catch(() => {});
  }
  await request.post('http://127.0.0.1:8000/api/v1/ai/keys/reset-cooldowns');
});

test.afterEach(async ({ request }) => {
  await request.post('http://127.0.0.1:8000/api/v1/ai/keys/reset-cooldowns');
});

test('stream: linha de status viva + tokens progressivos + done no painel', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  // mock LM Studio em stream (é o primeiro efetivo da cadeia sem chaves)
  await request.get('http://127.0.0.1:1234/control?mode=stream-openai');
  await request.get('http://127.0.0.1:11434/control?mode=stream-ollama');

  await page.locator('.react-flow__node').first().click();
  await page.getByRole('button', { name: 'Pesquisa IA' }).click();

  // linha de status viva aparece (trying ou committed — janela dos 300ms/chunk)
  const liveLine = page.getByText(/Tentando LM Studio|Gerando via LM Studio/);
  await expect(liveLine).toBeVisible({ timeout: 15000 });

  // texto progressivo aparece ANTES do done (chunks de 300ms garantem a janela)
  await expect(page.locator('pre', { hasText: 'resposta' })).toBeVisible({ timeout: 15000 });

  // done: toast + badge + entrada no painel
  await expect(page.getByText('Pesquisa concluída').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('header').getByText(/Usando: LM Studio \(local\)/)).toBeVisible();
  await expect(page.getByText('resposta mock do lm studio em stream').first()).toBeVisible({ timeout: 10000 });
});

test('stream interrompido APÓS o commit: toast com Tentar novamente → retry completa', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  // LM Studio morre no meio do stream (2 chunks e connection close, sem sentinel)
  await request.get('http://127.0.0.1:1234/control?mode=stream-mid-death');
  await request.get('http://127.0.0.1:11434/control?mode=stream-ollama');

  await page.locator('.react-flow__node').first().click();
  await page.getByRole('button', { name: 'Pesquisa IA' }).click();

  // PROVIDER_STREAM_INTERRUPTED (sem fallback após o commit)
  await expect(page.getByText('Conexão interrompida').first()).toBeVisible({ timeout: 15000 });
  const retry = page.getByRole('button', { name: 'Tentar novamente' });
  await expect(retry).toBeVisible();

  // upstream curado: o retry re-executa a cadeia e completa.
  // dispatchEvent em vez de click(): o clique por coordenadas já disparou
  // DUAS pesquisas na suíte — com o toast animando a entrada, o hit-test
  // acertou o botão "Pesquisa IA" do nó (outra pesquisa concorrente, que
  // zera o streamState compartilhado e deixa o resumo do retry vazio).
  // O dispatch vai direto ao onClick do botão do toast, sem hit-test.
  await request.get('http://127.0.0.1:1234/control?mode=stream-openai');
  await retry.dispatchEvent('click');

  await expect(page.getByText('Pesquisa concluída').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('resposta mock do lm studio em stream').first()).toBeVisible({ timeout: 10000 });
});
