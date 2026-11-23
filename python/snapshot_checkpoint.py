"""Checkpoint a prepared sandbox with a snapshot.

Do the slow setup once, snapshot the sandbox, and keep the snapshot as a
record of the environment. The snapshot has a time to live, so it cleans
itself up.

    python snapshot_checkpoint.py

The API cannot start a sandbox from a snapshot yet. This example shows
the create, wait, get, list and delete calls that are ready today.
"""

from pydo import Sandbox
from pydo.sandbox import NotFoundError, Snapshot

from _common import run_checked

with Sandbox.create() as sandbox:
    print("preparing", sandbox.sandbox_id)
    run_checked(sandbox, "pip install --quiet requests rich", timeout_seconds=300)
    run_checked(sandbox, "echo 'prepared' > /root/READY")

    snapshot = sandbox.create_snapshot(name="python-tools-ready", ttl="24h")
    print("snapshot", snapshot.snapshot_id, snapshot.state)
    try:
        snapshot.wait_until_ready()  # raises with the API's error if it fails
        print("complete")

        again = Snapshot.get(snapshot.snapshot_id)
        size = again.info.size_bytes
        print("get:", again.name, again.state, "ttl", again.info.ttl,
              "size", "%s bytes" % size if size else "not reported")

        try:
            for item in Snapshot.list(sandbox_id=sandbox.sandbox_id):
                print("list:", item.snapshot_id, item.name, item.state)
        except NotFoundError:
            # GET /v2/sandboxes/snapshots returns 404 on preview for now.
            print("list: not available on this API yet")
    finally:
        # Delete even when a step above fails, so no snapshot is left behind.
        print("deleted:", snapshot.delete())
