"""Settings. Everything comes from the .env file in the project root."""
import os
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "").strip()
if TAVILY_API_KEY.endswith("PASTE_YOUR_KEY_HERE"):
    TAVILY_API_KEY = ""
BIFROST_BASE_URL = os.getenv("BIFROST_BASE_URL", "http://localhost:8080").rstrip("/")
BIFROST_API_KEY = os.getenv("BIFROST_API_KEY", "").strip()
ANSWER_MODEL = os.getenv("ANSWER_MODEL", "openai/gpt-4o-mini")
HELPER_MODEL = os.getenv("HELPER_MODEL", ANSWER_MODEL)
RISK_THRESHOLD = float(os.getenv("RISK_THRESHOLD", "0.4"))
MAX_CLAIMS = int(os.getenv("MAX_CLAIMS_TO_VERIFY", "5"))
SEARCH_DEPTH = os.getenv("TAVILY_SEARCH_DEPTH", "basic")
CACHE_TTL = int(os.getenv("CACHE_TTL_SECONDS", "21600"))


def today() -> str:
    return os.getenv("TODAY_OVERRIDE") or date.today().isoformat()
