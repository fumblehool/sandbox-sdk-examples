"""An AI code interpreter: a model writes Python, a sandbox runs it.

The model never runs on your machine. Each reply that holds a ```python block
is run in a DigitalOcean Sandbox. The output goes back to the model, which
fixes errors or gives the final answer.

    export DIGITALOCEAN_ACCESS_TOKEN=...   # sandbox scopes
    export MODEL_ACCESS_KEY=...            # DigitalOcean Inference model access key
    export INFERENCE_MODEL=llama3.3-70b-instruct   # optional
    python ai_code_interpreter.py "What is the 50th prime number? Also plot nothing, just compute it."
"""

import os
import re
import sys

from pydo import Sandbox
from pydo.inference import Client

from _common import run, write_file

MAX_TURNS = 5
SYSTEM = (
    "You are a data scientist with a Linux sandbox that has Python 3. "
    "To run code, reply with exactly one ```python block and nothing else. "
    "The sandbox returns the output. Install packages with subprocess and pip if needed. "
    "When you have the answer, reply in plain text with no code block."
)
CODE_BLOCK = re.compile(r"```python\n(.*?)```", re.DOTALL)


def main(question: str) -> None:
    llm = Client(token=os.environ["MODEL_ACCESS_KEY"])
    model = os.environ.get("INFERENCE_MODEL", "llama3.3-70b-instruct")
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": question},
    ]

    with Sandbox.create() as sandbox:
        for turn in range(MAX_TURNS):
            reply = llm.chat.completions.create(
                model=model, messages=messages, max_tokens=1024
            )
            text = reply.choices[0].message.content or ""
            match = CODE_BLOCK.search(text)
            if not match:
                print(text)
                return

            code = match.group(1)
            print("--- turn %d: running\n%s" % (turn + 1, code))
            write_file(sandbox, "/workspace/step.py", code)
            result = run(
                sandbox,
                "python3 step.py", cwd="/workspace", timeout_seconds=120
            )
            observation = "exit code %d\nstdout:\n%s\nstderr:\n%s" % (
                result.exit_code,
                result.stdout[-4000:],
                result.stderr[-4000:],
            )
            print("--- output\n%s" % observation)
            messages.append({"role": "assistant", "content": text})
            messages.append({"role": "user", "content": observation})

        print("No final answer after %d turns." % MAX_TURNS)


if __name__ == "__main__":
    main(" ".join(sys.argv[1:]) or "What is the 50th prime number?")
