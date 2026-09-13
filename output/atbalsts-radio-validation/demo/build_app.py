"""Splice the tested modules into the page.

Two outputs, because the two hosts differ:
  receiver.html  a complete standalone document (doctype + charset) for local
                 serving, where nothing wraps it
  artifact.html  the bare fragment the Artifact host wraps in its own skeleton
Without the explicit charset the standalone copy renders Latvian diacritics as
mojibake, which is exactly what happened the first time.
"""
import os, pathlib
H = pathlib.Path(os.path.dirname(os.path.abspath(__file__)))
body = (H / "app.template.html").read_text()
for token, name in [("DATA", "data.js"), ("DECODER", "decoder.js"),
                    ("PROTOCOL", "protocol.js"), ("ENCODER", "encoder.js"),
                    ("APP", "app.js")]:
    body = body.replace(f"/*__{token}__*/", (H / name).read_text())

(H / "artifact.html").write_text(body)

# --- hosted copy for atbalsts.sortium.co -----------------------------------
# This one goes on a live civil-protection domain, so it carries a permanent
# banner and is kept out of search results. The statuses in it are fictional.
BANNER = ("""<div style="background:#A32A21;color:#fff;padding:9px 14px;margin:0 -14px 4px;
 font-family:'IBM Plex Sans Condensed',Arial Narrow,sans-serif;font-size:.86rem;
 line-height:1.4;text-align:center">
 <b>MĀCĪBU DEMONSTRĀCIJA · EXERCISE DEMONSTRATION.</b>
 Šī nav oficiāla informācija. Patvertņu statusi šeit ir izdomāti un neatspoguļo
 reālo situāciju. &nbsp;·&nbsp; Shelter statuses on this page are fictional test data and
 must not be acted on. Official information: <a href="/" style="color:#fff">atbalsts.sortium.co</a>
</div>""")
hosted = ('<!doctype html>\n<html lang="lv">\n<head>\n'
          '<meta charset="utf-8">\n'
          '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
          '<meta name="robots" content="noindex, nofollow">\n'
          '<title>Atbalsts radio · mācību demonstrācija</title>\n'
          '<style>body{margin:0;font:14px system-ui}img{max-width:100%}'
          '[hidden]{display:none!important}</style>\n'
          '</head>\n<body>\n' + BANNER + body + '\n</body>\n</html>\n')
(H / "hosted.html").write_text(hosted, encoding="utf-8")
print(f"hosted.html    {len(hosted)/1024:.0f} kB (exercise banner, noindex)")

standalone = ('<!doctype html>\n<html lang="lv">\n<head>\n'
              '<meta charset="utf-8">\n'
              '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
              '<style>body{margin:0;font:14px system-ui}img{max-width:100%}'
              '[hidden]{display:none!important}</style>\n'
              '</head>\n<body>\n' + body + '\n</body>\n</html>\n')
(H / "receiver.html").write_text(standalone, encoding="utf-8")
print(f"receiver.html  {len(standalone)/1024:.0f} kB (standalone, charset declared)")
print(f"artifact.html  {len(body)/1024:.0f} kB (fragment for the Artifact host)")
