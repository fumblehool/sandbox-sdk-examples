"""Scrape structured data from a JavaScript-heavy page with headless Chromium.

Plain HTTP clients miss content that a page builds in the browser. This loads
the page in Chromium inside a sandbox, so scripts on the page never run on your
machine, and prints the items you select as JSON.

    python web_scraper.py
    python web_scraper.py https://news.ycombinator.com/ \\
        --item "tr.athing" \\
        --field "title=.titleline > a" \\
        --field "link=.titleline > a@href"

A field is `name=css selector`. Add `@attribute` to read an attribute instead
of the text. With no arguments it scrapes the Hacker News front page.
"""

import argparse
import json

from pydo import Sandbox

from _common import install_chromium, run_checked, write_file

SCRIPT = '''
import json, os
from playwright.sync_api import sync_playwright

fields = json.loads(os.environ["FIELDS"])
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto(os.environ["URL"], wait_until="networkidle", timeout=45000)
    items = page.eval_on_selector_all(os.environ["ITEM"], """(nodes, fields) =>
        nodes.map(node => Object.fromEntries(Object.entries(fields).map(([name, spec]) => {
            const [selector, attr] = spec.split("@");
            const el = selector ? node.querySelector(selector) : node;
            const value = !el ? null : attr ? el.getAttribute(attr) : el.textContent.trim();
            return [name, value];
        })))""", fields)
    browser.close()
print("RESULT " + json.dumps(items))
'''

parser = argparse.ArgumentParser()
parser.add_argument("url", nargs="?", default="https://news.ycombinator.com/")
parser.add_argument("--item", default="tr.athing", help="CSS selector for one item")
parser.add_argument(
    "--field",
    action="append",
    default=None,
    help="name=selector[@attribute], repeatable",
)
args = parser.parse_args()

fields = {}
for spec in args.field or ["title=.titleline > a", "link=.titleline > a@href"]:
    name, _, selector = spec.partition("=")
    fields[name] = selector

with Sandbox.create(allow_internet_access=True) as sandbox:
    print("sandbox", sandbox.sandbox_id, "- installing Chromium")
    install_chromium(sandbox)
    write_file(sandbox, "/workspace/scrape.py", SCRIPT)
    result = run_checked(
        sandbox,
        "python3 /workspace/scrape.py",
        env_vars={"URL": args.url, "ITEM": args.item, "FIELDS": json.dumps(fields)},
        timeout_seconds=300,
    )

line = next(l for l in result.stdout.splitlines() if l.startswith("RESULT "))
items = json.loads(line[len("RESULT "):])
print(json.dumps(items, indent=2))
print("%d item(s)" % len(items))
