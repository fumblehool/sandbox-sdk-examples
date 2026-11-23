"""Delete sandboxes that have lived longer than a limit.

A sandbox that a crashed job left behind keeps costing money. Run this from
cron or CI. It only reports unless you pass --delete.

    python sandbox_janitor.py --max-age-hours 6            # dry run
    python sandbox_janitor.py --max-age-hours 6 --delete
"""

import argparse
from datetime import datetime, timedelta, timezone

from pydo import Sandbox

parser = argparse.ArgumentParser()
parser.add_argument("--max-age-hours", type=float, default=6)
parser.add_argument("--delete", action="store_true", help="delete instead of report")
args = parser.parse_args()

cutoff = datetime.now(timezone.utc) - timedelta(hours=args.max_age_hours)
stale = []
for sandbox in Sandbox.list():  # walks every page
    created = sandbox.info.created_at
    if created is None:
        continue
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if created < cutoff:
        stale.append(sandbox)

for sandbox in stale:
    age = datetime.now(timezone.utc) - sandbox.info.created_at.replace(
        tzinfo=sandbox.info.created_at.tzinfo or timezone.utc
    )
    line = "%s  %-12s  %-10s  age %s" % (
        sandbox.sandbox_id,
        sandbox.template,
        sandbox.state,
        str(age).split(".")[0],
    )
    if args.delete:
        print("deleting", line, "->", "ok" if sandbox.kill() else "already gone")
    else:
        print("stale   ", line)

print("%d stale sandbox(es)%s" % (len(stale), "" if args.delete else " (dry run)"))
