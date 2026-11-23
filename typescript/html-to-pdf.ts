// Turn a web page or a local HTML file into a PDF with headless Chromium.
//
// Typical uses are invoices, reports, and receipts that you render from HTML
// templates. Chromium prints CSS the way a browser does, including backgrounds
// and page breaks, and it runs in the sandbox instead of on your server.
//
//   npx tsx html-to-pdf.ts                         # Hacker News best, to hn-best.pdf
//   npx tsx html-to-pdf.ts https://example.com example.pdf
//   npx tsx html-to-pdf.ts ./invoice.html invoice.pdf

import { readFile as readLocal, writeFile as saveLocal } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Sandbox } from "@digitalocean/dots/sandbox";
import { installChromium, readFile, runChecked, writeFile } from "./common.js";

const DEFAULT_SOURCE = "https://news.ycombinator.com/best";

const args = process.argv.slice(2);
const source = args[0] ?? DEFAULT_SOURCE;
const output = args[1] ?? (args[0] ? "output.pdf" : "hn-best.pdf");
if (!args[0]) console.log(`no page given, using ${DEFAULT_SOURCE}`);

const SCRIPT = `
import { chromium } from "playwright";
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.goto(process.env.TARGET, { waitUntil: "load", timeout: 45000 });
await page.waitForTimeout(1000); // let late scripts and fonts settle
await page.pdf({ path: "/workspace/out/page.pdf", format: "A4", printBackground: true,
  margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" } });
await browser.close();
`;

const isFile = existsSync(source);
await using sandbox = await Sandbox.create({ allowInternetAccess: true });
console.log(`sandbox ${sandbox.sandboxId}: installing Chromium (a few minutes)`);
await installChromium(sandbox);

let target = source;
if (isFile) {
    await writeFile(sandbox, "/workspace/out/input.html", await readLocal(source, "utf8"));
    target = "file:///workspace/out/input.html";
}
await writeFile(sandbox, "/workspace/browser/print.mjs", SCRIPT);
await runChecked(sandbox, "mkdir -p /workspace/out");
await runChecked(sandbox, "node print.mjs", {
    cwd: "/workspace/browser",
    envVars: { TARGET: target },
    timeoutSeconds: 300,
    onStderr: (text) => process.stderr.write(text),
});

const pdf = await readFile(sandbox, "/workspace/out/page.pdf");
await saveLocal(output, pdf);
console.log(`saved ${output} (${pdf.length} bytes)`);
