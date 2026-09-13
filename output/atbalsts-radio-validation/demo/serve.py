#!/usr/bin/env python3
"""Serve the demo on http://localhost:8000 so the microphone works.

Browsers only grant microphone access in a *secure context*: https, or
http://localhost. Opening receiver.html as a file:// URL, or inside an embedded
frame that was not granted the permission, will fail no matter how many times
the permission is allowed. Running this is the fix.

    python3 serve.py            then open http://localhost:8000/receiver.html

To let a phone on the same Wi-Fi listen instead, use --lan and open the printed
address on the phone. Note that a plain http:// address on the LAN is NOT a
secure context, so the phone can play files but cannot use its microphone; for
that, run this script on the phone's own machine or put it behind https.
"""
import argparse, datetime, http.server, json, os, socket, socketserver, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOGS = os.path.join(HERE, "logs")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def guess_type(self, path):
        t = super().guess_type(path)
        # Latvian diacritics need this stated explicitly, not guessed.
        if t in ("text/html", "application/javascript", "text/javascript", "application/json"):
            return t + "; charset=utf-8"
        return t

    def do_POST(self):
        """Receive a diagnostic report from the page and write it to logs/.

        This is what makes a phone test inspectable afterwards: the page posts
        its own report here instead of the tester having to describe symptoms.
        """
        if self.path.rstrip("/").rsplit("/", 1)[-1] != "log":
            self.send_error(404); return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > 4_000_000:
                self.send_error(413); return
            body = self.rfile.read(n)
            data = json.loads(body)
            os.makedirs(LOGS, exist_ok=True)
            stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            name = f"{stamp}-{str(data.get('session', 'anon'))[:12]}.json"
            path = os.path.join(LOGS, name)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
            sys.stderr.write(f"  LOG  {name}  result: {data.get('result')}\n")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"saved": name}).encode())
        except Exception as e:
            self.send_error(400, str(e))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--lan", action="store_true", help="also accept connections from the network")
    a = ap.parse_args()
    host = "" if a.lan else "127.0.0.1"
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((host, a.port), Handler) as httpd:
        print(f"\n  Atbalsts demo:  http://localhost:{a.port}/receiver.html")
        if a.lan:
            print(f"  On this network: http://{lan_ip()}:{a.port}/receiver.html"
                  f"  (file playback only — not a secure context, so no microphone)")
        print(f"  Reports posted by the page land in {os.path.relpath(LOGS, os.getcwd())}/")
        print("  Ctrl+C to stop\n")
        httpd.serve_forever()
