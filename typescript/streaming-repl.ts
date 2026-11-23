// A long-lived interactive process: write to its standard input, read its
// output as events.
//
// This is the shape of a chat-style code interpreter that keeps state between
// turns. The Python process below stays alive, so a variable you set in one
// turn is still there in the next.
//
//   npx tsx streaming-repl.ts

import { Sandbox } from "@digitalocean/dots/sandbox";
import { writeFile } from "./common.js";

// Reads one JSON request per line, runs it in a shared namespace, and prints
// one JSON reply per line followed by a marker.
const REPL = `
import contextlib, io, json, sys, traceback
namespace = {}
for line in sys.stdin:
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            exec(json.loads(line)["code"], namespace)
        reply = {"ok": True, "output": out.getvalue()}
    except Exception:
        reply = {"ok": False, "output": traceback.format_exc()}
    print(json.dumps(reply), flush=True)
`;

await using sandbox = await Sandbox.create();
await writeFile(sandbox, "/workspace/repl.py", REPL);

const repl = await sandbox.commands.start("python3", {
    args: ["-u", "/workspace/repl.py"],
    stdin: true,
});

// Replies arrive as stdout events. Collect them into lines and hand each to
// whoever is waiting.
const pending: ((reply: { ok: boolean; output: string }) => void)[] = [];
const reader = (async () => {
    let buffer = "";
    for await (const event of repl.stream()) {
        if (event.type === "stderr") process.stderr.write(event.text);
        if (event.type !== "stdout") continue;
        buffer += event.text;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            pending.shift()?.(JSON.parse(line));
            newline = buffer.indexOf("\n");
        }
    }
})();

function execute(code: string) {
    return new Promise<{ ok: boolean; output: string }>(async (resolve) => {
        pending.push(resolve);
        await repl.writeStdin(JSON.stringify({ code }) + "\n");
    });
}

const turns = [
    "x = 21",
    "print(x * 2)",
    "import math; y = math.factorial(10)",
    "print(x, y)",
    "print(undefined_name)",
];
for (const code of turns) {
    const reply = await execute(code);
    console.log(`>>> ${code}\n${reply.ok ? "" : "[error] "}${reply.output.trimEnd()}\n`);
}

await repl.closeStdin(); // the loop ends, the process exits
await reader;
