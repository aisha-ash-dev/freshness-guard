# Freshness Guard

A companion service for the **Bifrost** open-source AI gateway. It catches facts in LLM answers that have gone
stale (prices, versions, office holders, laws), re-checks them on the live web with **Tavily**, and gives every
claim a freshness score and a sourced correction. Written in Python; no Go needed.

Hackathon tracks: Bifrost problem 04 (a feature the gateway is missing) + Tavily problem 01 (stale-answer detector).

## How it works
```
Your app -> Freshness Guard (:8000) -> Bifrost (:8080) -> any LLM provider
                  |
                  +-> 1. extract claims   2. score staleness risk (prices/versions/leaders = high)
                      3. Tavily live search, only for risky claims   4. judge: current / outdated / incorrect
                      5. freshness score per claim + optional corrected answer
```
Why not a native Bifrost plugin? Bifrost's plugin system is Go-only (.so files, dynamic builds). Because Bifrost
speaks the standard OpenAI API, Freshness Guard sits in front of it as a drop-in `/v1/chat/completions`
endpoint: apps change one URL, nothing else.

## Setup (10 minutes)
1. **Start Bifrost** (needs Node.js): `npx -y @maximhq/bifrost`, then open http://localhost:8080 and add an LLM
   provider key under Providers. Keep Bifrost on localhost and use the latest version (it had serious security
   fixes in 2026).
2. **Get the code running**
   ```
   python -m venv .venv
   source .venv/bin/activate          # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   cp .env.example .env               # Windows: copy .env.example .env
   ```
3. **Edit `.env`**: paste your Tavily key into `TAVILY_API_KEY`, and set `ANSWER_MODEL` / `HELPER_MODEL` to a
   model your Bifrost provider supports (format `provider/model`).
4. **Run**: `uvicorn backend.main:app --reload --port 8000` and open http://localhost:8000.
   A yellow banner appears on the page if the Tavily key or Bifrost is missing.

## Use it as a drop-in gateway
```
curl http://localhost:8000/v1/chat/completions -H "Content-Type: application/json" -d '{
  "model": "openai/gpt-4o-mini",
  "messages": [{"role":"user","content":"Who is the current UK prime minister?"}],
  "freshness": {"mode": "rewrite"}
}'
```
The normal OpenAI response comes back plus a `freshness` object, and `X-Freshness-Score` / `X-Freshness-Verdict`
headers. `mode` is `annotate` (flag only) or `rewrite` (also fix the answer). `stream:true` is not supported yet.

## Files
| File | Job |
|---|---|
| `backend/main.py` | API routes + serves the dashboard |
| `backend/pipeline.py` | claim extraction, risk, verification, scoring, rewrite, cache |
| `backend/clients.py` | calls to Bifrost and Tavily |
| `backend/config.py` | reads `.env` |
| `frontend/` | dashboard (plain HTML, CSS, JS, no build step) |
| `compare.py` | `python compare.py "your question"` shows plain Bifrost vs Freshness Guard side by side |
| `eval/` | 30-row test set and `python -m eval.run_eval` for accuracy, latency and credit numbers |

## Demo script (2 minutes)
1. Paste the sample stale text -> red claims, struck out, with corrections and source links.
2. Ask a live question -> the model's answer gets audited.
3. Switch to "Flag it and fix the answer" -> corrected answer with citations.
4. Show the `curl` drop-in call and the eval numbers.

## Known limits (say them honestly in your pitch)
No streaming yet. It is a companion proxy, not an in-process Go plugin. Accuracy depends on search results and the
judge model. The eval set is small; extend it with facts you have verified today.
