import { test, expect } from '@playwright/test';

// E2E da v0.6.1 — onboarding de provedores locais.
// O mock_upstream (porta 1234) serve /v1/models com qwen2.5-7b-instruct e
// ECOA o modelo recebido no texto da resposta ("[model=...]") — provando o
// fio seleção → chamada. Ollama é forçado FORA (mode=down na 11434) para
// exercitar chip, instruções e helper de primeira execução.
test.beforeEach(async ({ request }) => {
  const keys = await (await request.get('http://127.0.0.1:8000/api/v1/ai/keys')).json();
  for (const k of keys) {
    await request.delete(`http://127.0.0.1:8000/api/v1/ai/keys/${k.provider}`).catch(() => {});
  }
  await request.post('http://127.0.0.1:8000/api/v1/ai/keys/reset-cooldowns');
  await request.post('http://127.0.0.1:8000/api/v1/ai/chain/reset');
  const maps = await (await request.get('http://127.0.0.1:8000/api/v1/maps')).json();
  for (const m of maps) {
    await request.delete(`http://127.0.0.1:8000/api/v1/maps/${m.id}`).catch(() => {});
  }
});

test.afterEach(async ({ request }) => {
  await request.get('http://127.0.0.1:11434/control?mode=ok-ollama');
});

test('(a) servidor no ar: chip ●, cartão popula modelos, seleção persiste e É USADA', async ({ page, request }) => {
  await request.get('http://127.0.0.1:11434/control?mode=down'); // só o LM Studio no ar
  await request.get('http://127.0.0.1:1234/control?mode=stream-openai'); // deep-research/stream é SSE
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  await page.getByRole('button', { name: 'IA Config' }).click();

  // chip do LM Studio no ar (probe passou); ollama fora
  await expect(page.getByText('● no ar').first()).toBeVisible({ timeout: 15000 });

  // cartão LM Studio: SELECT populado pelo servidor
  const cardSelect = page.locator('select[aria-label="Modelo do LM Studio (local)"]');
  await expect(cardSelect).toBeVisible();
  await expect(cardSelect.locator('option', { hasText: 'qwen2.5-7b-instruct' })).toHaveCount(1);

  // seleção persiste: espera a RESPOSTA do PUT e o servidor refletir
  // (waitForRequest resolve no ENVIO — a gravação pode ainda não ter caído)
  const putPromise = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes('/ai/chain') && r.request().postData()?.includes('qwen2.5-7b-instruct'),
  );
  await cardSelect.selectOption('qwen2.5-7b-instruct');
  const putResp = await putPromise;
  expect(putResp.status()).toBe(200);
  await expect.poll(async () => {
    const chain = await (await request.get('http://127.0.0.1:8000/api/v1/ai/chain')).json();
    return chain.find((c) => c.provider === 'lmstudio')?.model ?? '';
  }, { timeout: 5000 }).toBe('qwen2.5-7b-instruct');

  // a seleção É USADA: pesquisa passa o modelo ao servidor, que ecoa no texto
  await page.locator('.react-flow__node').first().click();
  await page.getByRole('button', { name: 'Pesquisa IA' }).click();
  await expect(page.getByText('Pesquisa concluída').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/resposta mock do lm studio em stream \[model=qwen2\.5-7b-instruct\]/).first())
    .toBeVisible({ timeout: 10000 });
});

test('(b) servidor fora: chip ○ com instruções + helper de primeira execução', async ({ page, request }) => {
  await request.get('http://127.0.0.1:11434/control?mode=down');
  await request.get('http://127.0.0.1:1234/control?mode=down'); // NENHUM local no ar
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });

  await page.getByRole('button', { name: 'IA Config' }).click();

  // helper de primeira execução: dois caminhos locais, sem jargão de chave
  await expect(page.getByText('Como ativar a IA em 2 minutos')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Opção A — LM Studio')).toBeVisible();
  await expect(page.getByText('Start Server').first()).toBeVisible();
  await expect(page.getByText('ollama serve').first()).toBeVisible(); // helper e cartão citam

  // chip do LM Studio fora → instruções ao clicar
  const chip = page.getByRole('button', { name: /○ servidor fora/ }).first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByText('Como ligar o servidor:')).toBeVisible();

  // sem select com servidor fora: texto livre no lugar
  await expect(page.locator('select[aria-label="Modelo do LM Studio (local)"]')).toHaveCount(0);
});

test('(c) depois de ligar o servidor, helper some e chip vira ●', async ({ page, request }) => {
  await request.get('http://127.0.0.1:11434/control?mode=down');
  await request.get('http://127.0.0.1:1234/control?mode=down');
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15000 });
  await page.getByRole('button', { name: 'IA Config' }).click();
  await expect(page.getByText('Como ativar a IA em 2 minutos')).toBeVisible({ timeout: 15000 });

  // servidor liga (modo muda no mock) + "Verificar de novo" do helper
  await request.get('http://127.0.0.1:1234/control?mode=ok-openai');
  await page.getByRole('button', { name: 'Verificar de novo' }).first().click();

  await expect(page.getByText('Como ativar a IA em 2 minutos')).toBeHidden({ timeout: 15000 });
  await expect(page.getByText('● no ar').first()).toBeVisible();
});
