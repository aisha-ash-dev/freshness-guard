"""Ask the SAME question two ways and compare. Bifrost and Freshness Guard must both be running.
Usage:   python compare.py "Who is the current CEO of Intel?"
"""
import json
import sys
import urllib.request

from backend import config

sys.stdout.reconfigure(encoding="utf-8")


def post(url, payload, headers=None):
    req = urllib.request.Request(url, json.dumps(payload).encode(),
                                 {"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


question = " ".join(sys.argv[1:]) or "Who is the current CEO of Intel?"
auth = {"Authorization": f"Bearer {config.BIFROST_API_KEY}"} if config.BIFROST_API_KEY else {}

# 1) Plain Bifrost: exactly what your app gets today
raw = post(f"{config.BIFROST_BASE_URL}/v1/chat/completions",
           {"model": config.ANSWER_MODEL, "messages": [{"role": "user", "content": question}]}, auth)
answer = raw["choices"][0]["message"]["content"]
print("=== 1) PLAIN BIFROST (no freshness check) ===\n" + answer)

# 2) The same answer audited by Freshness Guard
res = post("http://localhost:8000/api/check", {"text": answer, "mode": "rewrite"})
print(f"\n=== 2) WITH FRESHNESS GUARD: score {res['overall_score']}/100, verdict: {res['overall_verdict']} ===")
for c in res["claims"]:
    print(f"- [{c['verdict']}] {c['text']}" + (f"\n    now: {c['corrected']}" if c.get("corrected") else ""))
if res.get("corrected_answer"):
    print("\n=== CORRECTED ANSWER ===\n" + res["corrected_answer"])
