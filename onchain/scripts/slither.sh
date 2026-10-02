#!/usr/bin/env bash
# Static analysis of every contract in contracts/ with Slither (pip install slither-analyzer;
# solc-select install 0.8.28 && solc-select use 0.8.28), Uniswap v4-core resolved from this
# package and its findings left out. Writes one JSON report per contract to $OUT (default
# onchain/slither/, ignored by git) and prints the findings by impact and detector.
# The triage of every High and Medium finding is in docs/STATIC_ANALYSIS.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${OUT:-onchain/slither}"
mkdir -p "$OUT"
for contract in contracts/*.sol; do
  name="$(basename "$contract" .sol)"
  # Slither exits non-zero when it reports findings; the summary below is what matters.
  slither "$contract" \
    --solc-remaps "@uniswap/=onchain/node_modules/@uniswap/" \
    --solc-args "--optimize --optimize-runs 200 --evm-version cancun" \
    --filter-paths "node_modules" --exclude-dependencies \
    --json "$OUT/$name.json" > "$OUT/$name.txt" 2>&1 || true
done
python3 - "$OUT" <<'PY'
import collections, glob, json, sys
order = ["High", "Medium", "Low", "Informational", "Optimization"]
findings = {}
for path in sorted(glob.glob(f"{sys.argv[1]}/*.json")):
    report = json.load(open(path))
    if not report.get("success"):
        sys.exit(f"{path}: {report.get('error')}")
    for item in report["results"].get("detectors", []):
        findings[item["id"]] = item
counts = collections.Counter((item["impact"], item["check"]) for item in findings.values())
print(f"{len(findings)} findings")
for (impact, check), count in sorted(counts.items(), key=lambda entry: (order.index(entry[0][0]), entry[0][1])):
    print(f"  {impact:<14} {check:<24} {count}")
PY
