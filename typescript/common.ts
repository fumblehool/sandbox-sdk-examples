// Helpers shared by the examples.
//
// Output can only be read while a command runs, and a short command (mkdir,
// base64) can exit before the SDK attaches to its output. `exec` closes that
// gap: the command first waits for a marker file, and a second command
// creates the marker only once the output stream is attached.
//
// The gate does not use stdin, because the stdin route is not deployed yet.
// The Sandboxes API has no file-transfer routes either, so `writeFile` sends
// content as Base64 in the command line and `readFile` reads it from stdout.

import { randomUUID } from "node:crypto";
import type { Sandbox } from "@digitalocean/dots/sandbox";

export interface ExecOptions {
    cwd?: string;
    envVars?: Record<string, string>;
    timeoutSeconds?: number;
    onStdout?: (text: string) => void;
    onStderr?: (text: string) => void;
}

export interface ExecResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

// Release the gate after this long if the stream sends no event first.
const RELEASE_AFTER_MS = 3000;
// The command stops waiting for the gate after 600 x 0.05 s = 30 s.
const GATE_POLLS = 600;
// Raw bytes per writeFile command. Base64 adds a third; one argument may be 128 KiB.
const CHUNK_BYTES = 48 * 1024;

export function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Runs a shell command and waits for it. A non-zero exit code is returned, not thrown. */
export async function exec(sandbox: Sandbox, command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const gate = `/tmp/.gate-${randomUUID()}`;
    const cmd = await sandbox.commands.start("bash", {
        args: [
            "-lc",
            `for _ in $(seq ${GATE_POLLS}); do [ -e ${gate} ] && break; sleep 0.05; done; rm -f ${gate}\n${command}`,
        ],
        cwd: opts.cwd,
        envVars: opts.envVars,
        timeoutSeconds: opts.timeoutSeconds,
    });

    let released: Promise<unknown> | undefined;
    const release = () => (released ??= sandbox.commands.start("touch", { args: [gate] }));
    const timer = setTimeout(() => void release().catch(() => {}), RELEASE_AFTER_MS);

    let stdout = "";
    let stderr = "";
    try {
        for await (const event of cmd.stream()) {
            // The first event means the stream is attached, so the command may run now.
            await release();
            if (event.type === "stdout") {
                stdout += event.text;
                opts.onStdout?.(event.text);
            } else if (event.type === "stderr") {
                stderr += event.text;
                opts.onStderr?.(event.text);
            } else if (event.type === "exit") {
                return { exitCode: event.exitCode, stdout, stderr };
            }
        }
    } finally {
        clearTimeout(timer);
    }
    throw new Error(`command ${cmd.pid} ended without an exit event`);
}

/** Like `exec`, but throws when the command exits non-zero. */
export async function runChecked(sandbox: Sandbox, command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const result = await exec(sandbox, command, opts);
    if (result.exitCode !== 0) {
        throw new Error(`command failed (${result.exitCode}): ${command.slice(0, 200)}\n${result.stderr}`);
    }
    return result;
}

/** Writes text to a file in the sandbox, creating its folder. */
export async function writeFile(sandbox: Sandbox, path: string, content: string): Promise<void> {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    const bytes = Buffer.from(content, "utf8");
    await runChecked(sandbox, `mkdir -p ${shellQuote(parent)} && : > ${shellQuote(path)}`);
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        const chunk = bytes.subarray(offset, offset + CHUNK_BYTES).toString("base64");
        await runChecked(sandbox, `echo ${chunk} | base64 -d >> ${shellQuote(path)}`);
    }
}

/** Reads a file out of the sandbox, as Base64 over stdout. Fine for screenshots and PDFs. */
export async function readFile(sandbox: Sandbox, path: string): Promise<Buffer> {
    const result = await runChecked(sandbox, `base64 -w0 ${shellQuote(path)}`, { timeoutSeconds: 120 });
    return Buffer.from(result.stdout.trim(), "base64");
}

/**
 * Installs Playwright and headless Chromium into /workspace/browser. Needs
 * internet access and takes a few minutes the first time.
 */
export async function installChromium(sandbox: Sandbox): Promise<void> {
    await runChecked(
        sandbox,
        "mkdir -p /workspace/browser && cd /workspace/browser && npm init -y >/dev/null " +
            "&& npm install --silent playwright && npx playwright install --with-deps chromium",
        { timeoutSeconds: 900, onStdout: (t) => process.stdout.write(t) },
    );
}
