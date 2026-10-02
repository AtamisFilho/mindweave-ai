/**
 * Parser do wire format SSE para o transporte fetch+ReadableStream (v0.4.5).
 *
 * Função PURA e incremental: recebe cada chunk de texto (fronteira arbitrária
 * do TCP — um delta JSON pode partir no meio entre dois chunks) e devolve os
 * eventos completos. Blocos são separados por linha vazia; linhas `: ...` são
 * comentários (heartbeat); linhas `data: {json}` viram eventos.
 */

export function createSSEParser(onEvent) {
  let buffer = "";

  const processBlock = (block) => {
    for (const line of block.split("\n")) {
      const trimmed = line.replace(/\r$/, "");
      if (trimmed.startsWith(":")) continue; // heartbeat/comentário
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue; // JSON malformado no wire: evento ignorado
      }
      // Exceções do CONSUMIDOR propagam (ex.: error event → retry) —
      // o try/catch acima protege só o parse.
      onEvent(parsed);
    }
  };

  return {
    /** Alimenta um chunk (pode conter eventos parciais) */
    feed(chunk) {
      buffer += chunk;
      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        processBlock(block);
      }
    },
    /** Processa o que sobrou (fim do stream sem linha vazia final) */
    flush() {
      if (buffer.trim()) {
        processBlock(buffer);
        buffer = "";
      }
    },
  };
}
