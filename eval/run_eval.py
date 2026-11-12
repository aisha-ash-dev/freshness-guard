"""Measure how well Freshness Guard spots stale facts.
Run from the project root (Bifrost + .env must be ready):   python -m eval.run_eval
Add your own rows to dataset.json. Only add facts you have double-checked as of today."""
import asyncio
import json
from pathlib import Path

from backend import clients, pipeline


async def main():
    rows = json.loads((Path(__file__).parent / "dataset.json").read_text(encoding="utf-8"))
    tp = fp = fn = tn = 0
    latencies = []
    for row in rows:  # one at a time to respect rate limits
        r = await pipeline.analyze(row["text"])
        pred, truth = r["overall_verdict"] == "stale", row["expected"] == "stale"
        tp += pred and truth; fp += pred and not truth; fn += (not pred) and truth; tn += (not pred) and not truth
        latencies.append(r["latency_ms"])
        print(f'{"OK  " if pred == truth else "MISS"} expected={row["expected"]:5} got={r["overall_verdict"]:9} {row["text"][:60]}')
    n = len(rows)
    print(f"\nAccuracy  {(tp + tn) / n:.0%}   Precision {tp / max(tp + fp, 1):.0%}   Recall {tp / max(tp + fn, 1):.0%}")
    print(f"Avg latency {sum(latencies) / n / 1000:.1f}s   Tavily credits {clients.stats['tavily_credits']}   "
          f"Credits per answer {clients.stats['tavily_credits'] / n:.2f}")

asyncio.run(main())
