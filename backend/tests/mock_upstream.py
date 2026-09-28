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
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1])
STATE = {"mode": sys.argv[2]}


class Handler(BaseHTTPRequestHandler):
    def _handle(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length:
            self.rfile.read(length)

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

        if mode == "429":
            body = json.dumps({"error": {"message": "Rate limit reached per minute"}}).encode()
            self.send_response(429)
        else:
            self.send_response(200)
            if PORT == 11434:
                body = json.dumps({"response": "resposta mock do ollama"}).encode()
            else:
                body = json.dumps({
                    "choices": [{"message": {"content": "resposta mock do lm studio"}}]
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
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"mock upstream na porta {PORT} (modo {STATE['mode']})", flush=True)
    server.serve_forever()
