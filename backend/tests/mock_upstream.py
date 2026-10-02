"""Mock upstream para E2Es da Provider Chain.

Uso: python tests/mock_upstream.py <porta> <modo_inicial>
  porta: 1234 (LM Studio, formato OpenAI) | 11434 (Ollama, formato próprio)
  modo_inicial: ok-openai | ok-ollama | 429 | down

Troca de modo em runtime (por teste E2E):
  GET http://127.0.0.1:<porta>/control?mode=429

Modos:
  ok-openai -> 200 no formato OpenAI   ("resposta mock do lm studio")
  ok-ollama -> 200 no formato Ollama   ("resposta mock do ollama")
  429       -> 429 Rate limit (por minuto)
  down      -> fecha a conexão sem responder (NETWORK_ERROR)
"""
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1])
STATE = {"mode": sys.argv[2]}


class Handler(BaseHTTPRequestHandler):
    def _handle(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        payload = {}
        if length:
            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw)
            except Exception:
                payload = {}
        if payload.get("model"):
            STATE["last_model"] = payload["model"]  # eco: prova fios no E2E

        path = self.path.split("?")[0]

        if path == "/control":
            from urllib.parse import parse_qs, urlparse
            qs = parse_qs(urlparse(self.path).query)
            STATE["mode"] = qs.get("mode", [STATE["mode"]])[0]
            body = b'{"mode": "' + STATE["mode"].encode() + b'"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        mode = STATE["mode"]
        if mode == "down":
            self.close_connection = True
            return

        # listagem de modelos locais (v0.6.1): probe do onboarding
        if path.endswith("/models") and PORT == 1234:
            body = json.dumps({"data": [{"id": "qwen2.5-7b-instruct"}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.endswith("/api/tags") and PORT == 11434:
            body = json.dumps({"models": [{"name": "llama3"}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/control":
            from urllib.parse import parse_qs, urlparse
            qs = parse_qs(urlparse(self.path).query)
            STATE["mode"] = qs.get("mode", [STATE["mode"]])[0]
            body = b'{"mode": "' + STATE["mode"].encode() + b'"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return


        # --- modos de stream (v0.4.5): corpo progressivo + sentinel ---
        # O FORMATO segue a PORTA (1234 = SSE OpenAI, 11434 = NDJSON Ollama) —
        # o modo controla apenas se o sentinel é enviado (mid-death = não).
        NL2 = chr(10) + chr(10)
        if mode == "stream-reasoning" and PORT == 1234:
            # v0.6.1.1: modelo de raciocínio — SÓ reasoning_content + [DONE],
            # NENHUM content (fixture da fricção #2)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            for _ in range(4):
                chunk = 'data: ' + json.dumps({"choices": [{"delta": {"reasoning_content": "pensando..."}}]}) + chr(10) + chr(10)
                self.wfile.write(chunk.encode())
                self.wfile.flush()
                time.sleep(0.2)
            self.wfile.write(b'data: [DONE]' + b'\n\n')
            self.wfile.flush()
            return

        if mode in ("stream-openai", "stream-ollama", "stream-mid-death"):
            is_openai = PORT == 1234
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream" if is_openai else "application/json")
            self.send_header("Connection", "close")
            self.end_headers()
            label = "lm studio" if PORT == 1234 else "ollama"
            parts = ["resposta ", f"mock do {label}", " em stream"]
            if STATE.get("last_model"):
                parts.append(f" [model={STATE['last_model']}]")  # prova o fio modelo→chamada
            for part in parts:
                chunk = ('data: ' + json.dumps({"choices": [{"delta": {"content": part}}]}) if is_openai
                         else json.dumps({"response": part})) + NL2
                self.wfile.write(chunk.encode())
                self.wfile.flush()
                time.sleep(0.3)
            if mode != "stream-mid-death":
                sentinel = ('data: [DONE]' if is_openai else json.dumps({"response": "", "done": True})) + NL2
                self.wfile.write(sentinel.encode())
                self.wfile.flush()
            else:
                self.close_connection = True  # morre SEM o sentinel
            return

        if mode == "429":
            body = json.dumps({"error": {"message": "Rate limit reached per minute"}}).encode()
            self.send_response(429)
        else:
            self.send_response(200)
            if PORT == 11434:
                body = json.dumps({"response": "resposta mock do ollama"}).encode()
            else:
                suffix = f" [model={STATE['last_model']}]" if STATE.get("last_model") else ""
                body = json.dumps({
                    "choices": [{"message": {"content": f"resposta mock do lm studio{suffix}"}}]
                }).encode()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = _handle
    do_POST = _handle

    def log_message(self, *args):  # silencia o log por request
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"mock upstream na porta {PORT} (modo {STATE['mode']})", flush=True)
    server.serve_forever()
