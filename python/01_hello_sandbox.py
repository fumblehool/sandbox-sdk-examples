"""Create a sandbox, run a command, stream output, clean up.

    python 01_hello_sandbox.py
"""

from pydo import Sandbox

from _common import run

# The with-block kills the sandbox when it ends, even if the code raises.
with Sandbox.create() as sandbox:
    print("sandbox", sandbox.sandbox_id, sandbox.state)

    result = run(sandbox, "uname -a && python3 --version")
    print(result.stdout, end="")

    # Output arrives as the command runs.
    run(
        sandbox,
        "for i in 1 2 3; do echo tick $i; sleep 1; done",
        on_stdout=lambda text: print("live:", text, end=""),
    )

    # A non-zero exit code is returned, not raised.
    failed = run(sandbox, "ls /does-not-exist")
    print("exit code:", failed.exit_code)
    print("stderr:", failed.stderr.strip())
