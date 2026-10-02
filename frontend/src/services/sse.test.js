import { describe, expect, it, vi } from 'vitest';
import { createSSEParser } from './sse';

/**
 * Fixtures adversariais de fronteira de chunk (Diretriz 1 do Tech Lead):
 * o parser de ~20 linhas precisa sobreviver a TCP real — eventos partidos
 * no meio do JSON, heartbeat partido, linhas vazias duplas.
 */
const WIRE = [
  'data: {"event":"chain","status":"trying"}',
  '',
  ': ping',
  '',
  'data: {"event":"token","delta":"Olá, "}',
  '',
  'data: {"event":"token","delta":"mundo!"}',
  '',
  '',
  'data: {"event":"done","provider_used":"groq"}',
  '',
].join('\n');

function feedInSplits(wire, sizes) {
  const events = [];
  const onEvent = vi.fn((ev) => events.push(ev));
  const parser = createSSEParser(onEvent);
  let pos = 0;
  for (const size of sizes) {
    parser.feed(wire.slice(pos, pos + size));
    pos += size;
  }
  if (pos < wire.length) parser.feed(wire.slice(pos));
  parser.flush();
  return events;
}

describe('createSSEParser (fronteiras de chunk adversariais)', () => {
  it('parseia o wire completo de uma vez', () => {
    const events = feedInSplits(WIRE, [Infinity]);
    expect(events.map((e) => e.event)).toEqual(['chain', 'token', 'token', 'done']);
    expect(events[1].delta).toBe('Olá, ');
    expect(events[2].delta).toBe('mundo!');
  });

  it('sobrevive a chunk de 1 byte (pior caso do TCP)', () => {
    const events = feedInSplits(WIRE, Array(WIRE.length).fill(1));
    expect(events.map((e) => e.event)).toEqual(['chain', 'token', 'token', 'done']);
  });

  it('delta JSON partido no meio entre dois chunks', () => {
    // quebra exatamente dentro do JSON do segundo token
    const cut = WIRE.indexOf('"delta":"mundo') + 6;
    const events = feedInSplits(WIRE, [cut]);
    expect(events).toHaveLength(4);
    expect(events[2].delta).toBe('mundo!');
  });

  it('": ping" partido no meio não vira evento', () => {
    const wire = 'data: {"event":"token","delta":"x"}\n\n: pi\ning\n\ndata: {"event":"done"}\n\n';
    const events = feedInSplits(wire, [wire.indexOf(': pi') + 4]);
    expect(events.map((e) => e.event)).toEqual(['token', 'done']);
  });

  it('linhas vazias duplas e blocos sem evento não quebram', () => {
    const wire = '\n\n\n:data ping\n\ndata: {"event":"done"}\n\n';
    const events = feedInSplits(wire, [3]);
    expect(events).toHaveLength(1);
  });

  it('JSON malformado é ignorado sem derrubar o parser', () => {
    const events = [];
    const parser = createSSEParser((ev) => events.push(ev));
    parser.feed('data: {quebrado\n\ndata: {"event":"done"}\n\n');
    expect(events.map((e) => e.event)).toEqual(['done']);
  });

  it('flush processa bloco final sem linha vazia', () => {
    const events = [];
    const parser = createSSEParser((ev) => events.push(ev));
    parser.feed('data: {"event":"done"}'); // sem \n\n final
    expect(events).toHaveLength(0);
    parser.flush();
    expect(events).toHaveLength(1);
  });
});
