import { auth } from './firebase';

const API = '/api';

async function authHeaders(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) throw new Error("Non authentifié.");
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

interface HistoryEntry {
  role: string;
  content: string;
}

export async function* sendMessageStream(
  prompt: string,
  history: HistoryEntry[] = [],
  model?: string,
  provider = "openai",
  providerKey = "",
  sourceText?: string,
  signal?: AbortSignal,
) {
  const messages = history.map((m) => ({
    role: m.role === "model" ? "assistant" : m.role,
    content: m.content,
  }));

  const response = await fetch(`${API}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
      ...(providerKey ? { "X-Provider-Key": providerKey } : {}),
    },
    body: JSON.stringify({
      message: prompt,
      history: messages,
      model,
      provider,
      source_text: sourceText ?? null,
    }),
    signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail ?? `Erreur serveur : ${response.status}`);
  }
  if (!response.body) throw new Error("Pas de réponse du serveur.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) yield text;
  }
}

export interface ModelInfo {
  id: string;
  label: string;
  web_search: boolean;
}

export interface ProviderInfo {
  label: string;
  models: ModelInfo[];
}

export interface ModelsResponse {
  providers: Record<string, ProviderInfo>;
}

export async function listModels(providerKey?: string): Promise<ModelsResponse> {
  const response = await fetch(`${API}/models`, {
    headers: {
      ...(await authHeaders()),
      ...(providerKey ? { "X-Provider-Key": providerKey } : {}),
    },
  });
  if (!response.ok) throw new Error("Impossible de charger les modèles.");
  return response.json();
}
