# DigitalOcean Sandboxes SDK examples

Runnable examples for the DigitalOcean Sandbox SDKs: [DoTs](https://github.com/digitalocean/dots) (TypeScript), [PyDo](https://github.com/digitalocean/pydo) (Python), and [Godo](https://github.com/digitalocean/godo) (Go). Each example solves a task you would otherwise do on your own machine or CI runner, with the risky or slow part moved into an isolated microVM.

## Examples

| Example | Language | What it does |
| --- | --- | --- |
| [python/01_hello_sandbox.py](python/01_hello_sandbox.py) | Python | Create a sandbox, run commands, stream output, read exit codes, clean up. |
| [python/ai_code_interpreter.py](python/ai_code_interpreter.py) | Python | A model on DigitalOcean Inference writes Python, the sandbox runs it, and the output goes back to the model until it has an answer. |
| [python/csv_data_analysis.py](python/csv_data_analysis.py) | Python | Upload a CSV into a sandbox and analyze it with pandas, with nothing installed locally. |
| [python/snapshot_checkpoint.py](python/snapshot_checkpoint.py) | Python | Prepare an environment, snapshot it with a time to live, then list and delete snapshots. |
| [python/sandbox_janitor.py](python/sandbox_janitor.py) | Python | Find and delete sandboxes older than a limit. Dry run by default. Fit for cron. |
| [python/web_scraper.py](python/web_scraper.py) | Python | Scrape structured data from a JavaScript-heavy page with headless Chromium and print it as JSON. |
| [python/broken_link_checker.py](python/broken_link_checker.py) | Python | Crawl a site in a real browser, check every link, and exit 1 if any is broken. |
| [typescript/repo-test-runner.ts](typescript/repo-test-runner.ts) | TypeScript | Clone a Git repository and run its tests (npm, pytest, or Go) in a sandbox. Exits 0 or 1, so it works as a CI step. |
| [typescript/parallel-code-eval.ts](typescript/parallel-code-eval.ts) | TypeScript | Evaluate many untrusted code snippets at once, one sandbox each, with a concurrency cap and no network access. |
| [typescript/streaming-repl.ts](typescript/streaming-repl.ts) | TypeScript | Keep a Python process alive, write to its standard input, and read its output as events. State carries over between turns. |
| [typescript/custom-template.ts](typescript/custom-template.ts) | TypeScript | Build a template from your container image, wait for the build, and create a sandbox from it. |
| [typescript/web-screenshot.ts](typescript/web-screenshot.ts) | TypeScript | Screenshot web pages with headless Chromium at desktop and phone sizes. |
| [typescript/html-to-pdf.ts](typescript/html-to-pdf.ts) | TypeScript | Render a URL or local HTML file to a PDF with headless Chromium. |
| [go/command-runner](go/command-runner) | Go | A small CLI that runs one shell command in a fresh sandbox and exits with its exit code. |

## Before you start

1. Create a DigitalOcean API token that has the sandbox scopes and export it. Every example reads it from this variable:

   ```shell
   export DIGITALOCEAN_ACCESS_TOKEN=<your-token>
   ```

2. Install the dependencies for the language you want. The SDKs install from the `feat/sandbox-sdk` branch until the sandbox SDK is released.

   ```shell
   # Python
   cd python && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt

   # TypeScript
   cd typescript && npm install

   # Go (godo is pinned to a commit of feat/sandbox-sdk in go.mod)
   cd go/command-runner && go build ./...
   ```

3. Run an example:

   ```shell
   python python/01_hello_sandbox.py
   npx tsx typescript/repo-test-runner.ts https://github.com/<owner>/<repo>.git
   (cd go/command-runner && go run . 'echo hello')
   ```

`python/ai_code_interpreter.py` also needs `MODEL_ACCESS_KEY`, a DigitalOcean Inference model access key. `typescript/custom-template.ts` needs `TEMPLATE_IMAGE`.

## Limits that shape these examples

* **No file transfer yet.** The API has no upload or download route. `writeFile` sends content as Base64 chunks in the command line, and `readFile` prints a file as Base64 and decodes it locally. That is how scripts go in and screenshots and PDFs come out.
* **Browser examples install Chromium on every run.** They need internet access and take a few minutes. A custom template with Chromium preinstalled removes that wait.
* **No start from a snapshot yet.** `snapshot_checkpoint.py` shows create, wait, list, and delete. Nothing can start a sandbox from the snapshot today.
* **Output is readable only while a command runs.** A short command such as `mkdir` can exit before the SDK attaches to its output, and the attach then fails with `NotFoundError`. The helpers `exec` (TypeScript), `run` (Python), and `runGated` (Go) prevent this: the command waits for a marker file, and a second command creates it only after the output stream is attached.
* **The stdin route is not deployed yet.** Writing to a command's stdin returns 404 on preview, so the helpers avoid it and `typescript/streaming-repl.ts` fails until the route lands.
* **Always clean up.** Sandboxes bill while they exist. The examples use `with`, `await using`, or `defer` so a failure still deletes the sandbox. `python/sandbox_janitor.py` catches anything a crashed run leaves behind.

## Status

The examples compile (`tsc`, `go vet`, `py_compile`) but have not been run against the live API. Run each one once against a real account before you demo it.
