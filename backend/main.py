"""Web server. Run:  uvicorn backend.main:app --reload --port 8000"""
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import clients, config, pipeline

app = FastAPI(title="Freshness Guard")


class CheckIn(BaseModel):
    text: str
    mode: str = "annotate"  # "annotate" = flag only, "rewrite" = flag and correct


class AskIn(BaseModel):
    question: str
    mode: str = "annotate"
    model: Optional[str] = None


def to_http_error(e: Exception) -> HTTPException:
    if isinstance(e, HTTPException):
        return e
    if isinstance(e, httpx.HTTPStatusError):
        return HTTPException(502, f"{e.request.url} returned {e.response.status_code}: {e.response.text[:300]}")
    if isinstance(e, httpx.HTTPError):
        return HTTPException(502, f"Cannot reach Bifrost at {config.BIFROST_BASE_URL} ({type(e).__name__}). Is it running?")
    return HTTPException(500, f"{type(e).__name__}: {e}")


@app.post("/api/check")
async def check(body: CheckIn):
    """Paste ANY LLM answer, get per-claim freshness scores."""
    try:
        return await pipeline.analyze(body.text, body.mode)
    except Exception as e:
        raise to_http_error(e)


@app.post("/api/ask")
async def ask(body: AskIn):
    """Ask a model through Bifrost, then audit its answer."""
    try:
        data = await clients.chat([{"role": "user", "content": body.question}], model=body.model or config.ANSWER_MODEL)
        answer = data["choices"][0]["message"]["content"]
        return {"answer": answer, **await pipeline.analyze(answer, body.mode)}
    except Exception as e:
        raise to_http_error(e)


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    """Drop-in replacement for the OpenAI endpoint. Point any app's base_url at this service."""
    body = await request.json()
    if body.get("stream"):
        raise HTTPException(400, "Freshness Guard does not support stream=true yet. Send stream=false.")
    opts = body.pop("freshness", None) or {}
    mode = request.headers.get("x-freshness-mode") or opts.get("mode", "annotate")
    try:
        extra = {k: v for k, v in body.items() if k not in ("messages", "model")}
        upstream = await clients.chat(body["messages"], model=body.get("model") or config.ANSWER_MODEL, **extra)
        msg = upstream["choices"][0]["message"]
        result = await pipeline.analyze(msg.get("content") or "", mode)
    except Exception as e:
        raise to_http_error(e)
    result["original_answer"] = msg.get("content")
    if result["corrected_answer"]:
        msg["content"] = result["corrected_answer"]
    upstream["freshness"] = result
    return JSONResponse(upstream, headers={"X-Freshness-Score": str(result["overall_score"]),
                                           "X-Freshness-Verdict": result["overall_verdict"]})


@app.get("/api/stats")
async def stats():
    return {**clients.stats, "cached_verdicts": len(pipeline._cache)}


@app.get("/api/health")
async def health():
    reachable = True
    try:
        await clients.http().get(config.BIFROST_BASE_URL, timeout=3)
    except Exception:
        reachable = False
    return {"tavily_key_set": bool(config.TAVILY_API_KEY), "bifrost_reachable": reachable,
            "bifrost_url": config.BIFROST_BASE_URL, "answer_model": config.ANSWER_MODEL,
            "helper_model": config.HELPER_MODEL}


app.mount("/", StaticFiles(directory=config.ROOT / "frontend", html=True), name="ui")
