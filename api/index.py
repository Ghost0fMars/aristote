from __future__ import annotations

import asyncio
import base64
import json
import os
import pathlib
from collections.abc import AsyncGenerator

from dotenv import load_dotenv

_env = pathlib.Path(__file__).parent.parent / ".env.local"
if _env.exists():
    load_dotenv(_env, override=False)

import firebase_admin
from firebase_admin import auth as fb_auth, credentials
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from api.metrics.dramatic_integral import calculate_dramatic_tension

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Config ───────────────────────────────────────────────────────────────────

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

ACADEMIC_DOMAINS = [
    "pubmed.ncbi.nlm.nih.gov", "arxiv.org", "doi.org", "scholar.google.com",
    "jstor.org", "springer.com", "wiley.com", "sciencedirect.com",
    "nature.com", "science.org", "hal.science", "persee.fr",
    "cairn.info", "openedition.org", "erudit.org", "cambridge.org",
]

STATIC_MODELS: dict = {
    "openai": {
        "label": "OpenAI",
        "models": [
            {"id": "gpt-4o-search-preview", "label": "GPT-4o Search", "web_search": True},
            {"id": "gpt-4o-mini-search-preview", "label": "GPT-4o mini Search", "web_search": True},
            {"id": "gpt-4o", "label": "GPT-4o", "web_search": False},
            {"id": "gpt-4.1", "label": "GPT-4.1", "web_search": False},
            {"id": "gpt-4.1-mini", "label": "GPT-4.1 mini", "web_search": False},
            {"id": "o4-mini", "label": "o4-mini", "web_search": False},
            {"id": "o3", "label": "o3", "web_search": False},
        ],
    },
    "anthropic": {
        "label": "Anthropic",
        "models": [
            {"id": "claude-opus-4-8", "label": "Claude Opus 4.8", "web_search": True},
            {"id": "claude-sonnet-4-6", "label": "Claude Sonnet 4.6", "web_search": True},
            {"id": "claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5", "web_search": True},
        ],
    },
    "gemini": {
        "label": "Google Gemini",
        "models": [
            {"id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro", "web_search": True},
            {"id": "gemini-2.0-flash", "label": "Gemini 2.0 Flash", "web_search": True},
        ],
    },
    "perplexity": {
        "label": "Perplexity",
        "models": [
            {"id": "sonar-pro", "label": "Sonar Pro", "web_search": True},
            {"id": "sonar", "label": "Sonar", "web_search": True},
            {"id": "sonar-reasoning-pro", "label": "Sonar Reasoning Pro", "web_search": True},
        ],
    },
}

# Models that support native web search per provider
_WEB_SEARCH: dict[str, set[str]] = {
    "openai": {"gpt-4o-search-preview", "gpt-4o-mini-search-preview"},
    "anthropic": {
        "claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001",
        "claude-opus-4", "claude-sonnet-4", "claude-haiku-4",
    },
    "gemini": {
        "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash",
    },
    # Perplexity: search always on — handled separately
}


def _wants_web_search(provider: str, model: str) -> bool:
    if provider == "perplexity":
        return True
    return model in _WEB_SEARCH.get(provider, set())


# ── Firebase Admin ───────────────────────────────────────────────────────────

_firebase_ready = False


def _init_firebase() -> None:
    global _firebase_ready
    try:
        firebase_admin.get_app()
        _firebase_ready = True
        return
    except ValueError:
        pass

    sa_env = os.getenv("FIREBASE_SERVICE_ACCOUNT", "")
    if not sa_env:
        return
    try:
        try:
            sa = json.loads(base64.b64decode(sa_env))
        except Exception:
            sa = json.loads(sa_env)
        firebase_admin.initialize_app(credentials.Certificate(sa))
        _firebase_ready = True
    except Exception:
        pass


_init_firebase()


async def verify_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Non authentifié.")
    if not _firebase_ready:
        raise HTTPException(status_code=503, detail="Firebase non configuré côté serveur.")
    token = auth.removeprefix("Bearer ")
    try:
        decoded = fb_auth.verify_id_token(token)
        return str(decoded["uid"])
    except Exception:
        raise HTTPException(status_code=401, detail="Token invalide ou expiré.")


# ── Pydantic models ───────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    model: str | None = None
    provider: str = "openai"
    source_text: str | None = None


# ── System prompt ─────────────────────────────────────────────────────────────

def _build_system(source_text: str | None, score: float, is_desis: bool) -> str:
    system = (
        "Tu es Aristote — un interlocuteur dialectique rigoureux. "
        "Tu n'es ni un assistant généraliste, ni un résumeur : "
        "tu éprouves les thèses par l'argument et la confrontation au champ.\n\n"
    )

    if source_text and source_text.strip():
        system += (
            "━━ TEXTE SOURCE (position à éprouver) ━━\n"
            f"{source_text.strip()[:8000]}\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            "Ce texte est la thèse de départ. Identifie sa thèse centrale et ses présupposés.\n\n"
        )

    system += (
        "MÉTHODE DIALECTIQUE :\n"
        "1. Va chercher dans le champ (recherche web) les positions académiques reconnues "
        "qui s'opposent à cette thèse, la nuancent ou y résonnent.\n"
        "2. CITE systématiquement tes sources (auteur, titre, date, lien URL). Distingue :\n"
        "   • [SOURCE CHAMP] — position défendue dans la littérature, sourcée\n"
        "   • [ARISTOTE] — mon objection dialectique personnelle\n"
        "   Ne présente jamais une objection personnelle comme un fait sourcé.\n"
        "3. Prioritise les sources académiques : doi.org, pubmed, arxiv, hal.science, "
        "cairn.info, persee.fr, jstor.org, presses universitaires, domaines .edu et .gov.\n"
        "4. Dialectique, pas éristique : tu éprouves pour clarifier, pas pour contredire.\n\n"
        f"[S(t)={score} | {'Desis — mise en crise' if is_desis else 'Lusis — dénouement'}]\n\n"
    )

    if is_desis:
        system += (
            "POSTURE DESIS : Intensifie la friction — objections précises, contradictions "
            "internes, présupposés non examinés. Mets la thèse en crise.\n\n"
        )
    else:
        system += (
            "POSTURE LUSIS : L'effort est suffisant. Aide à dénouer — synthèse, "
            "distinctions conceptuelles, validation constructive.\n\n"
        )

    system += "Réponds en français. Sois précis, sourcé, intellectuellement exigeant."
    return system


# ── Streaming handler ─────────────────────────────────────────────────────────

async def _stream(
    messages: list[dict],
    provider: str,
    model: str,
    provider_key: str,
) -> AsyncGenerator[str, None]:
    import litellm  # deferred — lighter cold start
    litellm.set_verbose = False

    kwargs: dict = {
        "model": f"{provider}/{model}",
        "messages": messages,
        "stream": True,
    }
    if provider_key:
        kwargs["api_key"] = provider_key

    if _wants_web_search(provider, model):
        if provider == "anthropic":
            kwargs["tools"] = [{"type": "web_search_20250305", "name": "web_search"}]
        elif provider == "gemini":
            kwargs["tools"] = [{"googleSearch": {}}]
        elif provider == "perplexity":
            kwargs["extra_body"] = {
                "search_domain_filter": ACADEMIC_DOMAINS,
                "return_images": False,
                "return_related_questions": False,
            }

    try:
        response = await litellm.acompletion(**kwargs)
        async for chunk in response:
            delta = chunk.choices[0].delta
            content = getattr(delta, "content", None)
            if isinstance(content, str) and content:
                yield content
    except Exception as exc:
        yield f"\n\n[Erreur {provider}/{model} : {type(exc).__name__} — {exc}]"


# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/chat")
@app.post("/api/chat")
async def chat(body: ChatRequest, raw: Request, uid: str = Depends(verify_token)):
    provider_key = raw.headers.get("X-Provider-Key", "")
    if not provider_key and body.provider == "openai" and OPENAI_API_KEY:
        provider_key = OPENAI_API_KEY

    context = body.source_text or ""
    history_list = [{"role": m.role, "content": m.content} for m in body.history]
    tension = calculate_dramatic_tension(history_list, body.message, context)

    system = _build_system(body.source_text, tension["tension_score"], tension["maieutic_posture"])
    model = body.model or "gpt-4o"

    messages: list[dict] = [{"role": "system", "content": system}]
    for msg in body.history:
        messages.append({
            "role": "assistant" if msg.role == "model" else msg.role,
            "content": msg.content,
        })
    messages.append({"role": "user", "content": body.message})

    return StreamingResponse(
        _stream(messages, body.provider, model, provider_key),
        media_type="text/plain",
    )


@app.get("/models")
@app.get("/api/models")
async def list_models(uid: str = Depends(verify_token)):
    return {"providers": STATIC_MODELS}
