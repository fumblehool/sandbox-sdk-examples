// A long-lived interactive process: send it requests, read its output as
// events.
//
// This is the shape of a chat-style code interpreter that keeps state between
// turns. The Python process below stays alive, so a variable you set in one
// turn is still there in the next.
//
//   npx tsx streaming-repl.ts
//
// Requests go in as files: the process polls /workspace/repl/in for
// 0.json, 1.json, and so on. Writing to the process's stdin would be simpler,
// but the stdin route is not deployed yet. Replies come back as stdout events.

import { Sandbox } from "@digitalocean/dots/sandbox";
import { runChecked, writeFile } from "./common.js";

const INBOX = "/workspace/repl/in";

// Waits for the next request file, runs it in a shared namespace, and prints
// one JSON reply per line.
const REPL = `
import contextlib, io, json, os, time, traceback
namespace, turn = {}, 0
while True:
    path = "${INBOX}/%d.json" % turn
    if not os.path.exists(path):
        time.sleep(0.05)
        continue
    with open(path) as f:
        request = json.load(f)
    os.remove(path)
    turn += 1
    if request.get("quit"):
        break
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            exec(request["code"], namespace)
        reply = {"ok": True, "output": out.getvalue()}
    except Exception as err:
        # Skip this file's own frame, so the traceback starts at the user's code.
        tb = traceback.format_exception(type(err), err, err.__traceback__.tb_next)
        reply = {"ok": False, "output": "".join(tb)}
    print(json.dumps(reply), flush=True)
`;

type Reply = { ok: boolean; output: string };

await using sandbox = await Sandbox.create();
await writeFile(sandbox, "/workspace/repl/repl.py", REPL);
await runChecked(sandbox, `mkdir -p ${INBOX}`);

const repl = await sandbox.commands.start("python3", { args: ["-u", "/workspace/repl/repl.py"] });

// Replies arrive as stdout events. Collect them into lines and hand each to
// whoever is waiting.
const pending: ((reply: Reply) => void)[] = [];
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

let turn = 0;
// Writes the request beside the inbox, then moves it in, so the process never
// reads a half-written file.
async function send(request: object): Promise<void> {
    const n = turn++;
    await writeFile(sandbox, `/workspace/repl/${n}.tmp`, JSON.stringify(request));
    await runChecked(sandbox, `mv /workspace/repl/${n}.tmp ${INBOX}/${n}.json`);
}

async function execute(code: string): Promise<Reply> {
    const reply = new Promise<Reply>((resolve) => pending.push(resolve));
    await send({ code });
    return reply;
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
    const output = reply.output.trimEnd() || "(ok)";
    console.log(`>>> ${code}\n${reply.ok ? "" : "[error] "}${output}\n`);
}

await send({ quit: true }); // the loop ends and the process exits
await reader;
