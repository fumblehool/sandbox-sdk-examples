"""Find broken links on a website.

A real browser follows links that depend on JavaScript, which a simple crawler
misses. The crawl stays on one origin, checks every link it finds, and exits
with 1 when it finds a broken one, so you can run it after a deploy.

    python broken_link_checker.py https://docs.digitalocean.com/ --max-pages 20
"""

import argparse
import json
import sys

from pydo import Sandbox

from _common import install_chromium, run_checked, write_file

SCRIPT = '''
import json, os
from urllib.parse import urljoin, urldefrag, urlparse
from playwright.sync_api import sync_playwright

start = os.environ["START"]
max_pages = int(os.environ["MAX_PAGES"])
origin = urlparse(start).netloc
queue, seen, status, found_on = [start], set(), {}, {}

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--disable-dev-shm-usage"])
    context = browser.new_context()
    page = context.new_page()
    visited = 0
    while queue and visited < max_pages:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        try:
            response = page.goto(url, wait_until="domcontentloaded", timeout=30000)
            status[url] = response.status if response else 0
        except Exception as err:
            status[url] = 0
            continue
        visited += 1
        if status[url] >= 400:
            continue
        hrefs = page.eval_on_selector_all("a[href]", "els => els.map(e => e.getAttribute('href'))")
        for href in hrefs:
            link, _ = urldefrag(urljoin(url, href))
            if not link.startswith(("http://", "https://")):
                continue
            found_on.setdefault(link, url)
            if urlparse(link).netloc == origin:
                queue.append(link)
            elif link not in status:
                try:
                    status[link] = context.request.head(link, timeout=15000).status
                except Exception:
                    status[link] = 0
    browser.close()

broken = [{"url": u, "status": s, "found_on": found_on.get(u)} for u, s in status.items() if s == 0 or s >= 400]
print("RESULT " + json.dumps({"checked": len(status), "broken": broken}))
'''

parser = argparse.ArgumentParser()
parser.add_argument("url")
parser.add_argument("--max-pages", type=int, default=25)
args = parser.parse_args()

with Sandbox.create(allow_internet_access=True) as sandbox:
    print("sandbox", sandbox.sandbox_id, "- installing Chromium")
    install_chromium(sandbox)
    write_file(sandbox, "/workspace/crawl.py", SCRIPT)
    result = run_checked(
        sandbox,
        "python3 /workspace/crawl.py",
        env_vars={"START": args.url, "MAX_PAGES": str(args.max_pages)},
        timeout_seconds=1200,
        on_stderr=lambda text: print(text, end="", file=sys.stderr),
    )

line = next(l for l in result.stdout.splitlines() if l.startswith("RESULT "))
report = json.loads(line[len("RESULT "):])
print("checked %d URL(s)" % report["checked"])
for item in report["broken"]:
    print("BROKEN %s  status %s  linked from %s" % (item["url"], item["status"] or "error", item["found_on"]))
print("%d broken" % len(report["broken"]))
sys.exit(1 if report["broken"] else 0)
