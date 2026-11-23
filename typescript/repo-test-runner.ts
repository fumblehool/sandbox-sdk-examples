// Run a Git repository's tests in a throwaway sandbox.
//
// Use it as a CI step or a pre-merge check on code you do not trust yet: the
// install scripts and the tests run in the sandbox, not on your machine. The
// process exits with 0 when the tests pass and 1 when they fail.
//
//   npx tsx repo-test-runner.ts https://github.com/<owner>/<repo>.git [branch]
//
// It detects npm, Python (pytest), and Go projects.

import { Sandbox } from "@digitalocean/dots/sandbox";
import { exec, runChecked, shellQuote } from "./common.js";

const [repoUrl, branch] = process.argv.slice(2);
if (!repoUrl) {
    console.error("usage: repo-test-runner.ts <git-url> [branch]");
    process.exit(2);
}

const DETECT = `
if [ -f package.json ]; then echo "npm ci || npm install; npm test"
elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then
  echo "pip install -q pytest; [ -f requirements.txt ] && pip install -q -r requirements.txt; pip install -q -e . 2>/dev/null; pytest -q"
elif [ -f go.mod ]; then echo "go test ./..."
else echo ""; fi
`;

await using sandbox = await Sandbox.create({ allowInternetAccess: true });
console.log(`sandbox ${sandbox.sandboxId}: cloning ${repoUrl}`);

const ref = branch ? `--branch ${shellQuote(branch)} ` : "";
await runChecked(sandbox, `git clone --depth 1 ${ref}${shellQuote(repoUrl)} /workspace/repo`, {
    timeoutSeconds: 300,
});

const detected = (await runChecked(sandbox, DETECT, { cwd: "/workspace/repo" })).stdout.trim();
if (!detected) {
    // Throw instead of process.exit: exit skips the cleanup that deletes the sandbox.
    throw new Error("no package.json, pyproject.toml, requirements.txt, or go.mod found");
}
console.log(`running: ${detected}`);

const result = await exec(sandbox, detected, {
    cwd: "/workspace/repo",
    timeoutSeconds: 1200,
    onStdout: (text) => process.stdout.write(text),
    onStderr: (text) => process.stderr.write(text),
});

console.log(result.exitCode === 0 ? "\nTESTS PASSED" : `\nTESTS FAILED (exit ${result.exitCode})`);
process.exitCode = result.exitCode === 0 ? 0 : 1;
