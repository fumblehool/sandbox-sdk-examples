"""Analyze a local CSV file in a sandbox with pandas.

Your data goes to a throwaway sandbox, so nothing needs installing locally. The
sandbox is deleted when the script ends.

    python csv_data_analysis.py [path/to/data.csv]

With no argument it generates sample sales data.
"""

import csv
import io
import random
import sys

from pydo import Sandbox

from _common import run_checked, write_file

ANALYSIS = '''
import pandas as pd

df = pd.read_csv("/workspace/data.csv", parse_dates=["date"])
print("rows:", len(df), "columns:", list(df.columns))
print()
print(df.describe(include="all").to_string())
print()
if {"region", "revenue"} <= set(df.columns):
    by_region = df.groupby("region")["revenue"].agg(["sum", "mean", "count"])
    print(by_region.sort_values("sum", ascending=False).to_string())
'''


def sample_csv() -> str:
    random.seed(7)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["date", "region", "product", "units", "revenue"])
    for day in range(1, 29):
        for region in ("nyc", "sfo", "ams", "sgp"):
            units = random.randint(5, 60)
            writer.writerow(["2026-02-%02d" % day, region, "widget", units, units * 19])
    return out.getvalue()


def main() -> None:
    data = open(sys.argv[1]).read() if len(sys.argv) > 1 else sample_csv()
    with Sandbox.create() as sandbox:
        print("installing pandas in", sandbox.sandbox_id)
        run_checked(sandbox, "pip install --quiet pandas", timeout_seconds=300)
        write_file(sandbox, "/workspace/data.csv", data)
        write_file(sandbox, "/workspace/analyze.py", ANALYSIS)
        result = run_checked(sandbox, "python3 /workspace/analyze.py")
        print(result.stdout)


if __name__ == "__main__":
    main()
