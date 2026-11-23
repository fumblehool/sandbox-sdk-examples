"""Checkpoint a prepared sandbox with a snapshot.

Do the slow setup once, snapshot the sandbox, and keep the snapshot as a
record of the environment. The snapshot has a time to live, so it cleans
itself up.

    python snapshot_checkpoint.py

The API cannot start a sandbox from a snapshot yet. This example shows
the create, wait, list and delete calls that are ready today.
"""

from pydo import Sandbox
from pydo.sandbox import Snapshot

from _common import run_checked

with Sandbox.create() as sandbox:
    print("preparing", sandbox.sandbox_id)
    run_checked(sandbox, "pip install --quiet requests rich", timeout_seconds=300)
    run_checked(sandbox, "echo 'prepared' > /root/READY")

    snapshot = sandbox.create_snapshot(name="python-tools-ready", ttl="24h")
    print("snapshot", snapshot.snapshot_id, snapshot.state)

    snapshot.wait_until_ready()  # raises with the API's error if it fails
    snapshot.refresh()
    print("complete, size in bytes:", snapshot.info.size_bytes)

    for item in Snapshot.list(sandbox_id=sandbox.sandbox_id):
        print(" ", item.snapshot_id, item.name, item.state)

    print("deleted:", snapshot.delete())
