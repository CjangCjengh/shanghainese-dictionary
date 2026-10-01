#!/usr/bin/env python3
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import build

parser = argparse.ArgumentParser(description='本地阅读上海话大词典')
parser.add_argument('--port', type=int, default=8780)
parser.add_argument('--host', default='127.0.0.1')
args = parser.parse_args()
build.main()
server = ThreadingHTTPServer((args.host, args.port), partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).resolve().parents[1] / '_site')))
print(f'打开 http://{args.host}:{args.port}', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
