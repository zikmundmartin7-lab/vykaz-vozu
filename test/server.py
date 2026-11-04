# Lokální server pro zkoušky čtení (test/vse.html): jako python3 -m http.server, navíc smí stránka uložit
# soubory do test/img/_vse/ (přečtený text fotek a základ k porovnání) – PUT, jen *.json, jen z 127.0.0.1.
# Moduly, stránky a JSON se při každém načtení ověří u serveru (no-cache), takže upravený kód platí hned.
# Spuštění z kořene projektu: python3 test/server.py 8771, pak http://localhost:8771/test/vse.html
import http.server
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAVE = re.compile(r'^/test/img/_vse/[\w.-]+\.json$')


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        if not self.path.split('?')[0].endswith(('.onnx', '.wasm', '.jpg')):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_PUT(self):
        path = self.path.split('?')[0]
        if not SAVE.match(path):
            return self.send_error(403)
        data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        dest = os.path.join(ROOT, path.lstrip('/'))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest + '.tmp', 'wb') as f:
            f.write(data)
        os.replace(dest + '.tmp', dest)
        self.send_response(204)
        self.end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8771
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
