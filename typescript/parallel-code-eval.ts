// Run many untrusted code snippets at once, each in its own sandbox.
//
// This is the core of an LLM evaluation harness: you have N model-written
// solutions and one test, and you want pass or fail for each without any of
// them touching your machine or each other. Concurrency is capped so a large
// batch does not exceed your sandbox quota.
//
//   npx tsx parallel-code-eval.ts

import { Sandbox } from "@digitalocean/dots/sandbox";
import { exec, writeFile } from "./common.js";

const CONCURRENCY = 3;

// Three candidate solutions to "return the n-th Fibonacci number". The third is wrong.
const candidates: Record<string, string> = {
    iterative: `
def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
`,
    recursive_cached: `
from functools import lru_cache
@lru_cache(None)
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)
`,
    off_by_one: `
def fib(n):
    a, b = 1, 1
    for _ in range(n):
        a, b = b, a + b
    return a
`,
};

const TEST = `
from solution import fib
assert [fib(i) for i in range(10)] == [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
assert fib(50) == 12586269025
print("ok")
`;

interface Verdict {
    name: string;
    passed: boolean;
    seconds: number;
    detail: string;
}

async function evaluate(name: string, code: string): Promise<Verdict> {
    const started = Date.now();
    // allowInternetAccess false: untrusted code gets no outbound network.
    await using sandbox = await Sandbox.create({ allowInternetAccess: false });
    await writeFile(sandbox, "/workspace/solution.py", code);
    await writeFile(sandbox, "/workspace/test_solution.py", TEST);
    const result = await exec(sandbox, "python3 test_solution.py", {
        cwd: "/workspace",
        timeoutSeconds: 60,
    });
    return {
        name,
        passed: result.exitCode === 0,
        seconds: (Date.now() - started) / 1000,
        detail: (result.exitCode === 0 ? result.stdout : result.stderr).trim().split("\n").pop() ?? "",
    };
}

// A small worker pool: each worker takes the next candidate until none are left.
async function evaluateAll(items: [string, string][]): Promise<Verdict[]> {
    const verdicts: Verdict[] = [];
    const queue = [...items];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let item = queue.shift(); item; item = queue.shift()) {
            verdicts.push(await evaluate(...item));
        }
    });
    await Promise.all(workers);
    return verdicts;
}

const verdicts = await evaluateAll(Object.entries(candidates));
for (const v of verdicts.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`${v.passed ? "PASS" : "FAIL"}  ${v.name.padEnd(18)} ${v.seconds.toFixed(1)}s  ${v.detail}`);
}
console.log(`${verdicts.filter((v) => v.passed).length}/${verdicts.length} passed`);
