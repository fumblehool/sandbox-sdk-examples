"""Helpers shared by the examples.

Output can only be read while a command runs, and a short command (mkdir,
base64) can exit before the SDK attaches to its output. `run` closes that
gap: the command first waits for a marker file, and a second command creates
the marker only once the output stream is attached.

The gate does not use stdin, because the stdin route is not deployed yet.
The Sandboxes API has no file-transfer routes either, so `write_file` sends
content as Base64 in the command line and `read_file` reads it from stdout.
"""

import base64
import shlex
import threading
import uuid
from dataclasses import dataclass
from typing import Callable, Mapping, Optional

from pydo import Sandbox

# Release the gate after this long if the stream sends no event first.
RELEASE_AFTER_SECONDS = 3.0
# The command stops waiting for the gate after 600 x 0.05 s = 30 s.
GATE_POLLS = 600
# Raw bytes per write_file command. Base64 adds a third; one argument may be 128 KiB.
CHUNK_BYTES = 48 * 1024


@dataclass
class Result:
    exit_code: int
    stdout: str
    stderr: str


def run(
    sandbox: Sandbox,
    command: str,
    *,
    cwd: Optional[str] = None,
    env_vars: Optional[Mapping[str, str]] = None,
    timeout_seconds: Optional[int] = None,
    on_stdout: Optional[Callable[[str], None]] = None,
    on_stderr: Optional[Callable[[str], None]] = None,
) -> Result:
    """Run a shell command and wait for it. A non-zero exit code is returned, not raised."""
    gate = "/tmp/.gate-%s" % uuid.uuid4().hex
    cmd = sandbox.commands.start(
        "bash",
        args=[
            "-lc",
            "for _ in $(seq %d); do [ -e %s ] && break; sleep 0.05; done; rm -f %s\n%s"
            % (GATE_POLLS, gate, gate, command),
        ],
        cwd=cwd,
        env_vars=env_vars,
        timeout_seconds=timeout_seconds,
    )

    lock = threading.Lock()
    released = []

    def release() -> None:
        with lock:
            if released:
                return
            released.append(True)
        sandbox.commands.start("touch", args=[gate])

    timer = threading.Timer(RELEASE_AFTER_SECONDS, release)
    timer.daemon = True
    timer.start()

    stdout, stderr = [], []
    try:
        for event in cmd.stream():
            # The first event means the stream is attached, so the command may run now.
            release()
            if event.type == "stdout":
                stdout.append(event.text)
                if on_stdout:
                    on_stdout(event.text)
            elif event.type == "stderr":
                stderr.append(event.text)
                if on_stderr:
                    on_stderr(event.text)
            elif event.type == "exit":
                return Result(event.exit_code or 0, "".join(stdout), "".join(stderr))
    finally:
        timer.cancel()
    raise RuntimeError("command %d ended without an exit event" % cmd.pid)


def run_checked(sandbox: Sandbox, command: str, **kwargs) -> Result:
    """Like `run`, but raise when the command exits non-zero."""
    result = run(sandbox, command, **kwargs)
    if result.exit_code != 0:
        raise RuntimeError(
            "command failed (%d): %s\n%s"
            % (result.exit_code, command[:200], result.stderr)
        )
    return result


def write_file(sandbox: Sandbox, path: str, content: str) -> None:
    """Write text to a file in the sandbox, creating its folder."""
    parent = path.rsplit("/", 1)[0] or "/"
    data = content.encode("utf-8")
    run_checked(sandbox, "mkdir -p %s && : > %s" % (shlex.quote(parent), shlex.quote(path)))
    for offset in range(0, len(data), CHUNK_BYTES):
        chunk = base64.b64encode(data[offset : offset + CHUNK_BYTES]).decode("ascii")
        run_checked(sandbox, "echo %s | base64 -d >> %s" % (chunk, shlex.quote(path)))


def read_file(sandbox: Sandbox, path: str) -> bytes:
    """Read a file out of the sandbox, as Base64 over stdout."""
    result = run_checked(
        sandbox, "base64 -w0 %s" % shlex.quote(path), timeout_seconds=120
    )
    return base64.b64decode(result.stdout.strip())


def install_chromium(sandbox: Sandbox) -> None:
    """Install Playwright for Python and headless Chromium.

    Needs internet access and takes a few minutes the first time.
    """
    run_checked(
        sandbox,
        "pip install --quiet playwright && playwright install --with-deps chromium",
        timeout_seconds=900,
        on_stdout=lambda text: print(text, end=""),
    )
