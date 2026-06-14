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
  signal?: AbortSignal,
) {
  const messages = history.map((m) => ({
    role: m.role === "model" ? "assistant" : m.role,
    content: m.content,
  }));

  const response = await fetch(`${API}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({
      message: prompt,
      history: messages,
      model,
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
  name: string;
  size: number;
  modified_at: string;
}

export interface ModelsResponse {
  default: string;
  models: ModelInfo[];
}

export async function listModels(): Promise<ModelsResponse> {
  const response = await fetch(`${API}/models`, { headers: await authHeaders() });
  if (!response.ok) throw new Error("Impossible de charger les modeles.");
  return response.json();
}
