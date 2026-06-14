from __future__ import annotations

import asyncio
import base64
import json
import os
import pathlib

from dotenv import load_dotenv

_env = pathlib.Path(__file__).parent.parent / ".env.local"
if _env.exists():
    load_dotenv(_env, override=False)

import firebase_admin
from firebase_admin import auth as fb_auth, credentials
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from openai import OpenAI
from pydantic import BaseModel, Field
from api.metrics.dramatic_integral import calculate_dramatic_tension

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

_RAW_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
_MODEL_FIXES = {
    "gpt-o4-mini": "o4-mini",
    "gpt-o3-mini": "o3-mini",
    "gpt-o3": "o3",
    "gpt-o1-mini": "o1-mini",
    "gpt-o1": "o1",
}
OPENAI_MODEL = _MODEL_FIXES.get(_RAW_MODEL, _RAW_MODEL)

_openai: OpenAI | None = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

# ── Firebase Admin init ──────────────────────────────────────────────────────

_firebase_ready = False


def _init_firebase() -> None:
    global _firebase_ready
    try:
        firebase_admin.get_app()
        _firebase_ready = True
        return
    except ValueError:
        pass  # not yet initialized

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


# ── Models ───────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    model: str | None = None


# ── Chat handler ─────────────────────────────────────────────────────────────

async def _chat_handler(request: ChatRequest) -> PlainTextResponse | JSONResponse:
    if not _openai:
        return JSONResponse(
            {"detail": "OPENAI_API_KEY non configuré."},
            status_code=503,
        )
    model = request.model or OPENAI_MODEL

    history_list = [{"role": m.role, "content": m.content} for m in request.history]
    tension = calculate_dramatic_tension(history_list, request.message, "")
    is_desis = tension["maieutic_posture"]
    score = tension["tension_score"]

    system = (
        "Tu es Aristote — un interlocuteur dialectique rigoureux. "
        "Tu éprouves les thèses par l'argument, jamais par la flatterie.\n\n"
        f"[DIALECTICAL METRICS: S(t)={score}, "
        f"Posture={'Desis — mise en crise' if is_desis else 'Lusis — dénouement'}]\n\n"
    )

    if is_desis:
        system += (
            "POSTURE DESIS (S(t) faible) :\n"
            "Intensifie la friction dialectique. Soulève les contradictions internes, "
            "les présupposés non examinés, les glissements conceptuels. "
            "Pose des objections précises, ne valide pas.\n\n"
        )
    else:
        system += (
            "POSTURE LUSIS (S(t) critique atteint) :\n"
            "L'effort de l'interlocuteur est suffisant. Aide à dénouer : "
            "synthèse, distinctions conceptuelles, clarification des tensions. "
            "Tu peux valider et structurer.\n\n"
        )

    system += "Réponds en français. Sois précis et intellectuellement exigeant."

    messages: list[dict] = [{"role": "system", "content": system}]
    for msg in request.history:
        role = "assistant" if msg.role == "model" else msg.role
        messages.append({"role": role, "content": msg.content})
    messages.append({"role": "user", "content": request.message})

    try:
        response = await asyncio.to_thread(
            _openai.chat.completions.create, model=model, messages=messages
        )
        return PlainTextResponse(response.choices[0].message.content or "")
    except Exception as exc:
        return JSONResponse({"detail": f"{type(exc).__name__}: {exc}"}, status_code=500)


# ── Routes ───────────────────────────────────────────────────────────────────

@app.post("/chat")
@app.post("/api/chat")
async def chat(request: ChatRequest, uid: str = Depends(verify_token)):
    return await _chat_handler(request)


@app.get("/models")
@app.get("/api/models")
async def list_models(uid: str = Depends(verify_token)):
    if not _openai:
        return {"default": "", "models": []}
    return {
        "default": OPENAI_MODEL,
        "models": [{"name": OPENAI_MODEL, "size": 0, "modified_at": ""}],
    }
