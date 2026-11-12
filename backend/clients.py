"""All outbound calls live here: Bifrost (any LLM) and Tavily (live web search)."""
import asyncio
import json
import re

import httpx

from . import config

# Counters shown on the dashboard
stats = {"checks": 0, "claims_seen": 0, "claims_verified": 0,
         "cache_hits": 0, "tavily_credits": 0, "llm_calls": 0}

_client = None
_tavily_gate = asyncio.Semaphore(5)  # stay under Tavily's rate limit


def http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(60.0))
    return _client


async def chat(messages, model=None, **extra) -> dict:
    """Call Bifrost's OpenAI-compatible endpoint. Bifrost routes it to the right provider."""
    headers = {"Content-Type": "application/json"}
    if config.BIFROST_API_KEY:
        headers["Authorization"] = f"Bearer {config.BIFROST_API_KEY}"
    body = {"model": model or config.HELPER_MODEL, "messages": messages, **extra}
    r = await http().post(f"{config.BIFROST_BASE_URL}/v1/chat/completions", json=body, headers=headers)
    r.raise_for_status()
    stats["llm_calls"] += 1
    return r.json()


def parse_json(text: str):
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise ValueError("The model did not return JSON")
        return json.loads(m.group(0))


async def chat_json(system: str, user: str):
    data = await chat([{"role": "system", "content": system},
                       {"role": "user", "content": user}], temperature=0)
    return parse_json(data["choices"][0]["message"]["content"])


async def tavily_search(query: str, topic: str = "general") -> list:
    """Live web search. Costs 1 credit (basic) or 2 (advanced)."""
    if not config.TAVILY_API_KEY:
        raise RuntimeError("TAVILY_API_KEY is empty - paste your key into .env")
    body = {"query": query[:400], "search_depth": config.SEARCH_DEPTH,
            "max_results": 5, "topic": topic}
    async with _tavily_gate:
        r = await http().post("https://api.tavily.com/search", json=body,
                              headers={"Authorization": f"Bearer {config.TAVILY_API_KEY}"})
    r.raise_for_status()
    stats["tavily_credits"] += 2 if config.SEARCH_DEPTH == "advanced" else 1
    return r.json().get("results", [])
