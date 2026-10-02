import { test, expect } from '@playwright/test';

// E2E da Provider Chain (v0.4 B2): backend REAL + upstreams MOCKADOS
// (tests/mock_upstream.py nas portas 1234/11434, controláveis por teste).
// Cenários da Diretriz 5: happy path, fallback e todos-falham — no nível API
// (a UI antiga ainda envia `provider`; a migração da UI é o B3).
test.beforeEach(async ({ request }) => {
  // cadeia = apenas locais (sem chaves configuradas): [lm studio, ollama]
  // apaga TODAS as chaves (inclusive as que você configurou manualmente —
  // este é o banco de dev compartilhado) e volta a cadeia ao PADRÃO —
  // specs anteriores reordenam e salvam; sem o reset, a ordem vazia.
  const keys = await (await request.get('http://127.0.0.1:8000/api/v1/ai/keys')).json();
  for (const k of keys) {
    await request.delete(`http://127.0.0.1:8000/api/v1/ai/keys/${k.provider}`).catch(() => {});
  }
  for (const provider of ['groq', 'openai', 'google', 'openrouter', 'cerebras', 'deepseek']) {
    await request.delete(`http://127.0.0.1:8000/api/v1/ai/keys/${provider}`).catch(() => {});
  }
  await request.post('http://127.0.0.1:8000/api/v1/ai/chain/reset');
  await request.post('http://127.0.0.1:8000/api/v1/ai/keys/reset-cooldowns');
});

async function setMode(request, port, mode) {
  await request.get(`http://127.0.0.1:${port}/control?mode=${mode}`);
}

async function deepResearch(request, payload = { nodeId: 'n1', nodeContent: 'Tópico de teste' }) {
  const response = await request.post('http://127.0.0.1:8000/api/v1/ai/deep-research', {
    data: payload,
  });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}

test('happy path: LM Studio responde → provider_used com trilha vazia', async ({ request }) => {
  await setMode(request, 1234, 'ok-openai');
  await setMode(request, 11434, 'ok-ollama');

  const { status, body } = await deepResearch(request);

  expect(status).toBe(200);
  expect(body.provider_used).toContain('LM Studio');
  expect(body.researchSummary).toContain('resposta mock do lm studio'); // v0.6.1: mock ecoa [model=...]
  expect(body.fallback_trail).toEqual([]);
});

test('fallback: LM Studio 429 → cadeia cai para o Ollama', async ({ request }) => {
  await setMode(request, 1234, '429');
  await setMode(request, 11434, 'ok-ollama');

  const { status, body } = await deepResearch(request);

  expect(status).toBe(200);
  expect(body.provider_used).toContain('Ollama');
  expect(body.researchSummary).toBe('resposta mock do ollama');
  expect(body.fallback_trail).toHaveLength(1);
  expect(body.fallback_trail[0].provider).toContain('LM Studio');
  expect(body.fallback_trail[0].kind).toBe('RATE_LIMIT');
});

test('todos falham → 503 ALL_PROVIDERS_FAILED com trilha completa', async ({ request }) => {
  await setMode(request, 1234, '429');
  await setMode(request, 11434, '429');

  const { status, body } = await deepResearch(request);

  expect(status).toBe(503);
  expect(body.detail.error_code).toBe('ALL_PROVIDERS_FAILED');
  expect(body.detail.fallback_trail).toHaveLength(2);
  expect(body.detail.fallback_trail.map((t) => t.kind)).toEqual(['RATE_LIMIT', 'RATE_LIMIT']);
});

test('campo legado provider: um provedor só, sem fallback', async ({ request }) => {
  await setMode(request, 1234, 'down'); // LM Studio fora do ar
  await setMode(request, 11434, 'ok-ollama');

  // provider fixado 'ollama': NEM tentaria o lm studio nem cairia para outro
  const { status, body } = await deepResearch(request, {
    nodeId: 'n1',
    nodeContent: 'Tópico',
    provider: 'ollama',
  });

  expect(status).toBe(200);
  expect(body.provider_used).toBe('ollama');
  expect(body.fallback_trail).toEqual([]);
});
