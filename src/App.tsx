/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Loader2, Download, History, Plus, Sun, Moon, LogOut, X,
  AlignLeft, Key, Globe, Check,
} from "lucide-react";
import Markdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";
import {
  sendMessageStream,
  listModels,
  type ModelInfo,
} from "./lib/api";
import { useAuth } from "./lib/auth";
import {
  fsLoadConversations,
  fsSaveConversation,
  fsDeleteConversation,
  fsLoadPreferences,
  fsSavePreferences,
  type FSConversation,
} from "./lib/firestore";
import AuthScreen from "./components/AuthScreen";

interface Message {
  id: string;
  role: "user" | "model";
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  model: string;
  provider?: string;
  messages: Message[];
  updatedAt: number;
}

const PROVIDERS = [
  { id: "openai", label: "OpenAI", keyPlaceholder: "sk-proj-..." },
  { id: "anthropic", label: "Anthropic", keyPlaceholder: "sk-ant-..." },
  { id: "gemini", label: "Google", keyPlaceholder: "AIza..." },
  { id: "perplexity", label: "Perplexity", keyPlaceholder: "pplx-..." },
] as const;

type ProviderId = typeof PROVIDERS[number]["id"];

function loadProviderKeys(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem("aristote_keys") ?? "{}"); }
  catch { return {}; }
}

export default function App() {
  const { user, loading: authLoading, logOut } = useAuth();

  const [theme, setTheme] = useState("light");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const prefsLoadedRef = useRef(false);

  // ── Provider + BYOK ─────────────────────────────────────────────────────────
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(
    () => (localStorage.getItem("aristote_provider") as ProviderId) ?? "openai"
  );
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>(loadProviderKeys);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyInputValue, setKeyInputValue] = useState("");

  // ── Source text (Socrate) ────────────────────────────────────────────────────
  const [sourceText, setSourceText] = useState("");
  const [showSourceText, setShowSourceText] = useState(false);

  // ── Models ───────────────────────────────────────────────────────────────────
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");

  const currentModelInfo = models.find((m) => m.id === selectedModel);
  const modelHasWebSearch = currentModelInfo?.web_search ?? false;

  // ── Misc UI ──────────────────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);

  // ── Theme ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // ── Provider persistence ─────────────────────────────────────────────────────

  useEffect(() => {
    localStorage.setItem("aristote_provider", selectedProvider);
  }, [selectedProvider]);

  const saveProviderKey = (provider: string, key: string) => {
    const updated = { ...providerKeys, [provider]: key };
    setProviderKeys(updated);
    localStorage.setItem("aristote_keys", JSON.stringify(updated));
  };

  const handleSaveKey = (e: React.FormEvent) => {
    e.preventDefault();
    saveProviderKey(selectedProvider, keyInputValue.trim());
    setShowKeyInput(false);
  };

  const openKeyInput = () => {
    setKeyInputValue(providerKeys[selectedProvider] ?? "");
    setShowKeyInput(true);
  };

  // ── Load preferences + conversations ─────────────────────────────────────────

  useEffect(() => {
    if (!user) {
      prefsLoadedRef.current = false;
      setConversations([]);
      setCurrentConvId(null);
      setMessages([]);
      return;
    }
    fsLoadPreferences(user.uid).then((prefs) => {
      if (prefs.theme) setTheme(prefs.theme);
      if (prefs.model) setSelectedModel(prefs.model);
      if (prefs.provider) setSelectedProvider(prefs.provider as ProviderId);
      prefsLoadedRef.current = true;
    }).catch(console.error);

    fsLoadConversations(user.uid).then((convs) => {
      setConversations(convs as Conversation[]);
    }).catch(console.error);
  }, [user]);

  // ── Persist preferences ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!user || !prefsLoadedRef.current) return;
    fsSavePreferences(user.uid, { theme }).catch(console.error);
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user || !prefsLoadedRef.current || !selectedModel) return;
    fsSavePreferences(user.uid, { model: selectedModel }).catch(console.error);
  }, [selectedModel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user || !prefsLoadedRef.current) return;
    fsSavePreferences(user.uid, { provider: selectedProvider }).catch(console.error);
  }, [selectedProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => { abortControllerRef.current?.abort(); }, []);

  // ── Auto-save conversation ────────────────────────────────────────────────────

  useEffect(() => {
    if (messages.length === 0 || !user) return;
    const firstUser = messages.find((m) => m.role === "user");
    const title = firstUser
      ? firstUser.content.slice(0, 60) + (firstUser.content.length > 60 ? "…" : "")
      : "Conversation";

    const id = currentConvId ?? Date.now().toString();
    if (!currentConvId) setCurrentConvId(id);

    const conv: Conversation = {
      id, title, model: selectedModel, provider: selectedProvider, messages, updatedAt: Date.now(),
    };
    setConversations((prev) => {
      const exists = prev.some((c) => c.id === id);
      return exists ? prev.map((c) => (c.id === id ? conv : c)) : [conv, ...prev];
    });
    fsSaveConversation(user.uid, conv as FSConversation).catch(console.error);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Models ───────────────────────────────────────────────────────────────────

  const loadModels = useCallback(async () => {
    if (!user) return;
    try {
      const resp = await listModels(providerKeys[selectedProvider]);
      const providerModels = resp.providers[selectedProvider]?.models ?? [];
      setModels(providerModels);
      setSelectedModel((cur) => {
        if (cur && providerModels.some((m) => m.id === cur)) return cur;
        return providerModels[0]?.id ?? "";
      });
    } catch {
      setModels([]);
    }
  }, [user, selectedProvider, providerKeys]);

  useEffect(() => { loadModels(); }, [loadModels]);

  // ── Conversation actions ──────────────────────────────────────────────────────

  const handleNewConversation = () => {
    abortControllerRef.current?.abort();
    setMessages([]);
    setCurrentConvId(null);
    setInputValue("");
    setIsLoading(false);
  };

  const handleLoadConversation = (conv: Conversation) => {
    abortControllerRef.current?.abort();
    setMessages(conv.messages);
    setCurrentConvId(conv.id);
    setSelectedModel(conv.model || selectedModel);
    if (conv.provider) setSelectedProvider(conv.provider as ProviderId);
    setIsLoading(false);
    setShowHistory(false);
  };

  const handleDeleteConversation = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (currentConvId === id) { setMessages([]); setCurrentConvId(null); }
    if (user) fsDeleteConversation(user.uid, id).catch(console.error);
  };

  // ── Chat ──────────────────────────────────────────────────────────────────────

  const handleExport = (content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aristote_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
  };

  const handleSubmit = async (e?: React.SyntheticEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = { id: Date.now().toString(), role: "user", content: inputValue };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    const botId = (Date.now() + 1).toString();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      let accumulated = "";
      const effectiveModel = models.some((m) => m.id === selectedModel)
        ? selectedModel
        : models[0]?.id ?? selectedModel;

      const stream = sendMessageStream(
        inputValue, history,
        effectiveModel, selectedProvider,
        providerKeys[selectedProvider] ?? "",
        sourceText || undefined,
        abortController.signal,
      );
      for await (const chunk of stream) {
        accumulated += chunk;
        setMessages((prev) => {
          const exists = prev.find((m) => m.id === botId);
          if (exists) return prev.map((m) => m.id === botId ? { ...m, content: accumulated } : m);
          return [...prev, { id: botId, role: "model", content: accumulated }];
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const msg = error instanceof Error ? error.message : String(error);
      setMessages((prev) => [...prev, { id: "error", role: "model", content: `Erreur : ${msg}` }]);
    } finally {
      if (abortControllerRef.current === abortController) abortControllerRef.current = null;
      setIsLoading(false);
    }
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const isToday = d.toDateString() === new Date().toDateString();
    if (isToday) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  };

  // ── Auth gate ─────────────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-[#FDFCFA] dark:bg-[#0D0D0C]">
        <Loader2 size={20} className="animate-spin text-[#8C8C8C]" />
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  const currentProviderLabel = PROVIDERS.find((p) => p.id === selectedProvider)?.label ?? selectedProvider;
  const currentKeyPlaceholder = PROVIDERS.find((p) => p.id === selectedProvider)?.keyPlaceholder ?? "API key";
  const hasKey = !!(providerKeys[selectedProvider]);

  // ── Main UI ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen w-full bg-[#FDFCFA] text-[#1A1A1A] overflow-hidden">
      {/* Mobile Header */}
      <header className="md:hidden h-14 border-b border-[#E5E2DD] bg-[#FDFCFA] dark:bg-[#0D0D0C] flex items-center justify-between px-4 shrink-0 z-20">
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="p-2 text-[#8C8C8C] hover:text-black dark:text-[#A6A196] dark:hover:text-white transition-colors"
        >
          <History size={18} />
        </button>
        <span className="text-xs tracking-[0.25em] font-semibold text-[#1A1A1A] dark:text-[#ECEAE4] select-none">
          AR1ST0T3
        </span>
        <button
          onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          className="p-2 text-[#8C8C8C] hover:text-black dark:text-[#A6A196] dark:hover:text-white transition-colors"
        >
          {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
        </button>
      </header>

      <div className="flex flex-1 w-full overflow-hidden relative">
        {/* Left Navigation */}
        <nav className="hidden md:flex w-20 border-r border-[#E5E2DD] flex-col items-center justify-between py-10 shrink-0">
          <div className="flex flex-col items-center gap-8">
            <div className="w-8 h-8 bg-black rotate-45 rounded-sm flex items-center justify-center">
              <div className="w-5 h-5 bg-white rounded-full -rotate-45" />
            </div>
            <span className="text-[10px] tracking-[0.3em] font-semibold text-[#8C8C8C] uppercase [writing-mode:vertical-rl] rotate-180">
              AR1ST0T3
            </span>
          </div>

          <div className="flex flex-col items-center gap-6">
            <button
              onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
              title={theme === "light" ? "Mode Sombre" : "Mode Clair"}
              className="group transition-transform hover:scale-105 active:scale-95"
            >
              {theme === "light"
                ? <Moon size={18} className="text-[#CBC7C0] group-hover:text-black transition-colors" />
                : <Sun size={18} className="text-[#8C8C8C] group-hover:text-white transition-colors" />}
            </button>

            <button onClick={handleNewConversation} title="Nouvelle conversation" className="group">
              <Plus size={18} className="text-[#CBC7C0] group-hover:text-black transition-colors" />
            </button>

            <button
              onClick={() => setShowHistory((v) => !v)}
              title="Historique"
              className="relative group"
            >
              <History
                size={18}
                className={`transition-colors ${showHistory ? "text-black dark:text-white" : "text-[#CBC7C0] group-hover:text-black"}`}
              />
              {conversations.length > 0 && (
                <span className="block text-[9px] font-bold tracking-widest text-[#8C8C8C] text-center mt-0.5">
                  {conversations.length}
                </span>
              )}
            </button>

            {/* Source text toggle */}
            <button
              onClick={() => setShowSourceText((v) => !v)}
              title="Texte source (Socrate)"
              className="relative group"
            >
              <AlignLeft
                size={18}
                className={`transition-colors ${showSourceText || sourceText ? "text-black dark:text-white" : "text-[#CBC7C0] group-hover:text-black"}`}
              />
              {sourceText && !showSourceText && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-black dark:bg-white" />
              )}
            </button>

            <button
              onClick={logOut}
              title={`Déconnexion (${user.email})`}
              className="group"
            >
              <LogOut size={18} className="text-[#CBC7C0] group-hover:text-red-400 transition-colors" />
            </button>
          </div>
        </nav>

        {/* Backdrop (mobile) */}
        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="md:hidden fixed inset-0 z-30 bg-black/40 backdrop-blur-xs"
            />
          )}
        </AnimatePresence>

        {/* History Panel */}
        <AnimatePresence>
          {showHistory && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ ease: "easeInOut", duration: 0.3 }}
              className="border-r border-[#E5E2DD] flex flex-col overflow-hidden shrink-0 bg-[#FDFCFA] fixed md:static inset-y-0 left-0 z-40 w-[280px] shadow-2xl md:shadow-none h-full"
            >
              <div className="flex items-center justify-between px-6 py-6 border-b border-[#E5E2DD]">
                <span className="text-[10px] tracking-[0.3em] font-semibold text-[#8C8C8C] uppercase">Historique</span>
                <button onClick={() => setShowHistory(false)} className="text-[#CBC7C0] hover:text-black transition-colors">
                  <X size={14} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 space-y-1">
                {conversations.length === 0 ? (
                  <p className="text-[11px] text-[#CBC7C0] italic mt-4 px-2">Aucune conversation sauvegardée.</p>
                ) : (
                  conversations
                    .slice().sort((a, b) => b.updatedAt - a.updatedAt)
                    .map((conv) => (
                      <div
                        key={conv.id}
                        onClick={() => handleLoadConversation(conv)}
                        className={`flex items-start justify-between gap-2 px-3 py-3 rounded-sm cursor-pointer group transition-colors ${
                          currentConvId === conv.id ? "bg-[#F0EDE9]" : "hover:bg-[#F5F2EF]"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] text-[#1A1A1A] truncate leading-snug">{conv.title}</p>
                          <p className="text-[10px] text-[#CBC7C0] mt-1">
                            {conv.provider ? `${conv.provider}/` : ""}{conv.model} · {formatDate(conv.updatedAt)}
                          </p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                          className="text-[#E5E2DD] hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100 mt-0.5"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))
                )}
              </div>

              <div className="px-6 py-4 border-t border-[#E5E2DD] flex items-center justify-between">
                <span className="text-[10px] text-[#8C8C8C] truncate max-w-[160px]">{user.email}</span>
                <button onClick={logOut} className="text-[#CBC7C0] hover:text-red-400 transition-colors">
                  <LogOut size={13} />
                </button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Chat */}
        <main className="flex-1 flex flex-col relative h-full min-w-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto no-scrollbar px-6 md:px-32 py-8 md:py-16 space-y-12 md:space-y-24 scroll-smooth">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex w-full ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`max-w-2xl w-full group/msg ${message.role === "user" ? "text-right ml-auto" : "text-left mr-auto"}`}>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-[10px] tracking-widest text-[#8C8C8C] uppercase font-semibold">
                        {message.role === "user" ? "Vous" : "Aristote"}
                      </p>
                      {message.role === "model" && (
                        <button
                          onClick={() => handleExport(message.content)}
                          title="Exporter en .txt"
                          className="opacity-0 group-hover/msg:opacity-100 transition-opacity text-[#CBC7C0] hover:text-black"
                        >
                          <Download size={13} />
                        </button>
                      )}
                    </div>
                    <div className={`markdown-body ${message.role === "user" ? "text-xl md:text-2xl font-light leading-snug" : "text-base md:text-lg leading-relaxed font-light"}`}>
                      {message.role === "user" ? (
                        <span className="font-light">{message.content}</span>
                      ) : (
                        <Markdown
                          components={{
                            a: ({ href, children, ...props }) => (
                              <a href={href} target="_blank" rel="noopener noreferrer"
                                className="underline text-black dark:text-white font-medium hover:opacity-80"
                                {...props}>{children}</a>
                            ),
                          }}
                        >
                          {message.content}
                        </Markdown>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={scrollRef} />
          </div>

          {/* Bottom area */}
          <div className="shrink-0 border-t border-[#E5E2DD] bg-[#FDFCFA] dark:bg-[#0D0D0C]">

            {/* Source text panel */}
            <AnimatePresence>
              {showSourceText && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ ease: "easeInOut", duration: 0.2 }}
                  className="overflow-hidden border-b border-[#E5E2DD]"
                >
                  <div className="px-6 md:px-24 py-4">
                    <p className="text-[9px] tracking-[0.3em] font-semibold text-[#8C8C8C] uppercase mb-2">
                      Texte source — Socrate
                    </p>
                    <textarea
                      value={sourceText}
                      onChange={(e) => setSourceText(e.target.value)}
                      placeholder="Collez ici le texte produit avec Socrate (thèse, chapitre, position)..."
                      rows={5}
                      className="w-full bg-transparent text-[12px] font-light leading-relaxed text-[#1A1A1A] dark:text-[#ECEAE4] placeholder:italic placeholder:text-[#CBC7C0] outline-none resize-none"
                    />
                    {sourceText && (
                      <p className="text-[9px] text-[#8C8C8C] mt-1">
                        {sourceText.length.toLocaleString("fr-FR")} caractères — transmis à chaque requête
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Key input row (when editing) */}
            <AnimatePresence>
              {showKeyInput && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ ease: "easeInOut", duration: 0.15 }}
                  className="overflow-hidden border-b border-[#E5E2DD]"
                >
                  <form
                    onSubmit={handleSaveKey}
                    className="px-6 md:px-24 py-3 flex items-center gap-3"
                  >
                    <span className="text-[9px] tracking-[0.25em] text-[#8C8C8C] uppercase shrink-0">
                      {currentProviderLabel}
                    </span>
                    <input
                      type="password"
                      value={keyInputValue}
                      onChange={(e) => setKeyInputValue(e.target.value)}
                      placeholder={currentKeyPlaceholder}
                      autoFocus
                      className="flex-1 bg-transparent text-[11px] font-mono text-[#1A1A1A] dark:text-[#ECEAE4] placeholder:text-[#CBC7C0] outline-none"
                    />
                    <button
                      type="submit"
                      className="text-[#8C8C8C] hover:text-black transition-colors"
                      title="Enregistrer"
                    >
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowKeyInput(false)}
                      className="text-[#CBC7C0] hover:text-black transition-colors"
                    >
                      <X size={13} />
                    </button>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input toolbar */}
            <div className="h-auto min-h-20 py-4 md:py-0 md:h-28 px-6 md:px-24 flex items-center">
              <form
                onSubmit={handleSubmit}
                className="w-full flex flex-col md:flex-row md:items-center gap-3 md:gap-4 group"
              >
                {/* Left controls */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Provider select */}
                  <select
                    value={selectedProvider}
                    onChange={(e) => setSelectedProvider(e.target.value as ProviderId)}
                    disabled={isLoading}
                    className="h-8 border border-[#E5E2DD] px-2 text-[10px] tracking-widest uppercase text-[#8C8C8C] outline-none hover:border-[#CBC7C0] disabled:opacity-30 appearance-none bg-white dark:bg-black"
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>

                  {/* Key toggle */}
                  {!showKeyInput && (
                    <button
                      type="button"
                      onClick={openKeyInput}
                      title={hasKey ? "Modifier la clé API" : "Entrer votre clé API"}
                      className={`h-8 w-8 border flex items-center justify-center transition-colors ${
                        hasKey
                          ? "border-[#E5E2DD] text-[#8C8C8C] hover:text-black hover:border-[#CBC7C0]"
                          : "border-red-300 text-red-400 hover:border-red-400"
                      }`}
                    >
                      <Key size={12} />
                    </button>
                  )}

                  {/* Model select + web search indicator */}
                  {!showKeyInput && (
                    <div className="flex items-center gap-1.5 h-8">
                      <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        disabled={models.length === 0 || isLoading}
                        className="h-8 max-w-44 border border-[#E5E2DD] px-2 text-[10px] tracking-widest uppercase text-[#8C8C8C] outline-none hover:border-[#CBC7C0] disabled:opacity-30 appearance-none bg-white dark:bg-black"
                      >
                        {models.length === 0 ? (
                          <option value="">Aucun modèle</option>
                        ) : (
                          models.map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))
                        )}
                      </select>
                      {modelHasWebSearch && (
                        <span title="Recherche web académique active">
                          <Globe size={12} className="text-[#8C8C8C] shrink-0" />
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Input + send */}
                <div className="flex-1 flex items-center gap-3 md:gap-4 min-w-0">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Écrivez votre message..."
                    disabled={isLoading}
                    className="bg-transparent min-w-0 flex-1 text-base md:text-[11px] font-light placeholder:italic placeholder:text-[#CBC7C0] outline-none disabled:opacity-30"
                  />
                  <button
                    type={isLoading ? "button" : "submit"}
                    onClick={isLoading ? handleStop : undefined}
                    disabled={!isLoading && !inputValue.trim()}
                    className={`ml-auto flex items-center gap-3 text-[10px] tracking-[0.18em] font-bold transition-colors disabled:opacity-20 uppercase whitespace-nowrap ${
                      isLoading ? "text-red-400 hover:text-red-500" : "group-hover:text-black text-[#8C8C8C]"
                    }`}
                  >
                    {isLoading ? "STOP" : "ENVOYER"}
                    <div className="w-6 md:w-12 h-[1px] bg-current" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
