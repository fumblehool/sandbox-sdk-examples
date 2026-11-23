// Screenshot web pages with headless Chromium, on desktop and phone sizes.
//
// Use it for visual checks of a staging site, a preview of a pull request, or
// a nightly capture. The browser runs in the sandbox, so you install nothing
// locally. Screenshots come back as Base64 over the command output and are
// saved to ./screenshots.
//
//   npx tsx web-screenshot.ts                      # https://www.digitalocean.com
//   npx tsx web-screenshot.ts https://example.com https://docs.digitalocean.com

import { mkdir, writeFile as saveLocal } from "node:fs/promises";
import { Sandbox } from "@digitalocean/dots/sandbox";
import { installChromium, readFile, runChecked, writeFile } from "./common.js";

const DEFAULT_URLS = ["https://www.digitalocean.com"];

let urls = process.argv.slice(2);
if (urls.length === 0) {
    urls = DEFAULT_URLS;
    console.log(`no URL given, using ${urls.join(" ")}`);
}

const SCRIPT = `
import { chromium } from "playwright";
const urls = JSON.parse(process.env.URLS);
const sizes = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const done = [];
for (const [i, url] of urls.entries()) {
  for (const [name, viewport] of Object.entries(sizes)) {
    const page = await browser.newPage({ viewport });
    try {
      console.error("capturing " + url + " (" + name + ")");
      await page.goto(url, { waitUntil: "load", timeout: 45000 });
      await page.waitForTimeout(1000); // let late scripts and fonts settle
      const file = "/workspace/out/" + i + "-" + name + ".png";
      await page.screenshot({ path: file, fullPage: true });
      done.push({ url, size: name, file, title: await page.title() });
    } catch (err) {
      console.error("failed", url, name, String(err));
    } finally {
      await page.close();
    }
  }
}
await browser.close();
console.log("RESULT " + JSON.stringify(done));
`;

await using sandbox = await Sandbox.create({ allowInternetAccess: true });
console.log(`sandbox ${sandbox.sandboxId}: installing Chromium (a few minutes)`);
await installChromium(sandbox);

await writeFile(sandbox, "/workspace/browser/shoot.mjs", SCRIPT);
await runChecked(sandbox, "mkdir -p /workspace/out");
const run = await runChecked(sandbox, "node shoot.mjs", {
    cwd: "/workspace/browser",
    envVars: { URLS: JSON.stringify(urls) },
    timeoutSeconds: 600,
    // Progress and per-page errors go to stderr; show them as they happen.
    onStderr: (text) => process.stderr.write(text),
});

const line = run.stdout.split("\n").find((l) => l.startsWith("RESULT "));
const shots: { url: string; size: string; file: string; title: string }[] = line
    ? JSON.parse(line.slice("RESULT ".length))
    : [];

await mkdir("screenshots", { recursive: true });
for (const shot of shots) {
    const name = `${new URL(shot.url).hostname}-${shot.size}.png`;
    await saveLocal(`screenshots/${name}`, await readFile(sandbox, shot.file));
    console.log(`saved screenshots/${name}  (${shot.title})`);
}
if (shots.length === 0) {
    console.error("no screenshots were taken; see the errors above");
    process.exitCode = 1;
}
