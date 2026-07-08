#!/usr/bin/env python3
"""
Inlines app.css and the JS files (qrcode.js, grid-shim.js, app.js) into
index.html, producing a single self-contained HTML file. Grid only accepts a
single .html upload (no folders/zips) for this account, so this is the file
that actually gets uploaded there. index.html + assets/ stay as the editable
source for local dev (python3 -m http.server) and testing.
"""
import re
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE.parent / "dist" / "nex-ssc2-presorting.html"

html = (HERE / "index.html").read_text(encoding="utf-8")
css = (HERE / "assets" / "app.css").read_text(encoding="utf-8")
js_parts = [
    (HERE / "assets" / "qrcode.js").read_text(encoding="utf-8"),
    (HERE / "assets" / "grid-shim.js").read_text(encoding="utf-8"),
    (HERE / "assets" / "app.js").read_text(encoding="utf-8"),
]
js = "\n;\n".join(js_parts)

html = re.sub(
    r'<link rel="stylesheet" href="assets/app\.css">',
    lambda m: "<style>\n" + css + "\n</style>",
    html,
)
html = re.sub(
    r'(\s*<script src="assets/[\w.-]+\.js"></script>)+',
    lambda m: "\n<script>\n" + js + "\n</script>",
    html,
)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8")
print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KB)")
