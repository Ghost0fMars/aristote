/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, Download, History, Plus, Sun, Moon, LogOut, LogIn, X } from "lucide-react";
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
  messages: Message[];
  updatedAt: number;
}

const MODEL_LABELS: Record<string, string> = {
  "o4-mini": "OpenAI o4-mini",
  "o3-mini": "OpenAI o3-mini",
  "o3": "OpenAI o3",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o mini",
  "gpt-4.1": "GPT-4.1",
  "gpt-4.1-mini": "GPT-4.1 mini",
  "gpt-4.1-nano": "GPT-4.1 nano",
};

const getModelLabel = (name: string) => MODEL_LABELS[name] ?? name;

export default function App() {
  const { user, loading: authLoading, logOut } = useAuth();

  const [theme, setTheme] = useState("light");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const prefsLoadedRef = useRef(false);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);

  // ── Load preferences + conversations when user logs in ──────────────────────

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
      prefsLoadedRef.current = true;
    }).catch(console.error);

    fsLoadConversations(user.uid).then((convs) => {
      setConversations(convs as Conversation[]);
    }).catch(console.error);
  }, [user]);

  // ── Persist preferences on change (after initial load) ─────────────────────

  useEffect(() => {
    if (!user || !prefsLoadedRef.current) return;
    fsSavePreferences(user.uid, { theme }).catch(console.error);
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user || !prefsLoadedRef.current || !selectedModel) return;
    fsSavePreferences(user.uid, { model: selectedModel }).catch(console.error);
  }, [selectedModel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // ── Auto-save conversation to Firestore ─────────────────────────────────────

  useEffect(() => {
    if (messages.length === 0 || !user) return;
    const firstUserMsg = messages.find((m) => m.role === "user");
    const title = firstUserMsg
      ? firstUserMsg.content.slice(0, 60) + (firstUserMsg.content.length > 60 ? "…" : "")
      : "Conversation";

    const id = currentConvId ?? Date.now().toString();
    if (!currentConvId) setCurrentConvId(id);

    const conv: Conversation = { id, title, model: selectedModel, messages, updatedAt: Date.now() };

    setConversations((prev) => {
      const exists = prev.some((c) => c.id === id);
      return exists ? prev.map((c) => (c.id === id ? conv : c)) : [conv, ...prev];
    });

    fsSaveConversation(user.uid, conv as FSConversation).catch(console.error);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Models ──────────────────────────────────────────────────────────────────

  const loadModels = useCallback(async () => {
    try {
      const response = await listModels();
      setModels(response.models);
      setSelectedModel((current) => {
        if (current && response.models.some((model) => model.name === current)) {
          return current;
        }
        if (response.models.some((model) => model.name === response.default)) {
          return response.default;
        }
        return response.models[0]?.name ?? response.default;
      });
    } catch {
      // backend not yet reachable on first load
    }
  }, []);

  useEffect(() => {
    if (user) loadModels();
  }, [loadModels, user]);

  // ── Conversation actions ────────────────────────────────────────────────────

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
    setIsLoading(false);
    setShowHistory(false);
  };

  const handleDeleteConversation = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (currentConvId === id) {
      setMessages([]);
      setCurrentConvId(null);
    }
    if (user) fsDeleteConversation(user.uid, id).catch(console.error);
  };

  // ── Chat ────────────────────────────────────────────────────────────────────

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

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    const botMessageId = (Date.now() + 1).toString();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const history = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      let accumulated = "";
      const stream = sendMessageStream(
        inputValue,
        history,
        selectedModel,
        abortController.signal,
      );

      for await (const chunk of stream) {
        accumulated += chunk;
        setMessages((prev) => {
          const exists = prev.find((m) => m.id === botMessageId);
          if (exists) {
            return prev.map((m) =>
              m.id === botMessageId ? { ...m, content: accumulated } : m,
            );
          }
          return [
            ...prev,
            { id: botMessageId, role: "model", content: accumulated },
          ];
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Chat error:", msg);
      setMessages((prev) => [
        ...prev,
        {
          id: "error",
          role: "model",
          content: `Une erreur est survenue : ${msg}`,
        },
      ]);
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsLoading(false);
    }
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  };

  // ── Auth gate (always required) ─────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-[#FDFCFA] dark:bg-[#0D0D0C]">
        <Loader2 size={20} className="animate-spin text-[#8C8C8C]" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  // ── Main UI ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen w-full bg-[#FDFCFA] text-[#1A1A1A] overflow-hidden">
      {/* Mobile Header */}
      <header className="md:hidden h-14 border-b border-[#E5E2DD] bg-[#FDFCFA] dark:bg-[#0D0D0C] flex items-center justify-between px-4 shrink-0 z-20">
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="p-2 text-[#8C8C8C] hover:text-black dark:text-[#A6A196] dark:hover:text-white transition-colors"
          title="Historique"
        >
          <History size={18} />
        </button>

        <span className="text-xs tracking-[0.25em] font-semibold text-[#1A1A1A] dark:text-[#ECEAE4] select-none">
          AR1ST0T3
        </span>

        <button
          onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          className="p-2 text-[#8C8C8C] hover:text-black dark:text-[#A6A196] dark:hover:text-white transition-colors"
          title={theme === "light" ? "Mode Sombre" : "Mode Clair"}
        >
          {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
        </button>
      </header>

      {/* App Body Container */}
      <div className="flex flex-1 w-full overflow-hidden relative">
        {/* Left Navigation */}
        <nav className="hidden md:flex w-20 border-r border-[#E5E2DD] flex-col items-center justify-between py-10 shrink-0">
          <div className="flex flex-col items-center gap-8">
            <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center">
              <div className="w-3 h-3 bg-white rotate-45"></div>
            </div>
            <span className="text-[10px] tracking-[0.3em] font-semibold text-[#8C8C8C] uppercase [writing-mode:vertical-rl] rotate-180">
              AR1ST0T3
            </span>
          </div>

          <div className="flex flex-col items-center gap-6">
            <button
              onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
              title={theme === "light" ? "Mode Sombre" : "Mode Clair"}
              className="flex flex-col items-center gap-1 group transition-transform hover:scale-105 active:scale-95 cursor-pointer"
            >
              {theme === "light" ? (
                <Moon size={18} className="text-[#CBC7C0] group-hover:text-black transition-colors" />
              ) : (
                <Sun size={18} className="text-[#8C8C8C] group-hover:text-white transition-colors" />
              )}
            </button>

            <button
              onClick={handleNewConversation}
              title="Nouvelle conversation"
              className="flex flex-col items-center gap-1 group"
            >
              <Plus size={18} className="text-[#CBC7C0] group-hover:text-black transition-colors" />
            </button>

            <button
              onClick={() => setShowHistory((v) => !v)}
              title="Historique"
              className="relative flex flex-col items-center gap-1 group"
            >
              <History
                size={18}
                className={`transition-colors ${showHistory ? "text-black" : "text-[#CBC7C0] group-hover:text-black"}`}
              />
              {conversations.length > 0 && (
                <span className="text-[9px] font-bold tracking-widest text-[#8C8C8C]">
                  {conversations.length}
                </span>
              )}
            </button>

            <button
              onClick={logOut}
              title={`Déconnexion (${user.email})`}
              className="flex flex-col items-center gap-1 group"
            >
              <LogOut size={18} className="text-[#CBC7C0] group-hover:text-red-400 transition-colors" />
            </button>
          </div>
        </nav>

        {/* Backdrop overlay for mobile */}
        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
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
              className="border-r border-[#E5E2DD] flex flex-col overflow-hidden shrink-0 bg-[#FDFCFA] fixed md:static inset-y-0 left-0 z-40 w-[280px] md:w-[280px] shadow-2xl md:shadow-none h-full"
            >
              <div className="flex items-center justify-between px-6 py-6 border-b border-[#E5E2DD]">
                <span className="text-[10px] tracking-[0.3em] font-semibold text-[#8C8C8C] uppercase">
                  Historique
                </span>
                <button
                  onClick={() => setShowHistory(false)}
                  className="text-[#CBC7C0] hover:text-black transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 space-y-1">
                {conversations.length === 0 ? (
                  <p className="text-[11px] text-[#CBC7C0] italic mt-4 px-2">
                    Aucune conversation sauvegardée.
                  </p>
                ) : (
                  conversations
                    .slice()
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .map((conv) => (
                      <div
                        key={conv.id}
                        onClick={() => handleLoadConversation(conv)}
                        className={`flex items-start justify-between gap-2 px-3 py-3 rounded-sm cursor-pointer group transition-colors ${
                          currentConvId === conv.id
                            ? "bg-[#F0EDE9]"
                            : "hover:bg-[#F5F2EF]"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] text-[#1A1A1A] truncate leading-snug">
                            {conv.title}
                          </p>
                          <p className="text-[10px] text-[#CBC7C0] mt-1">
                            {getModelLabel(conv.model)} · {formatDate(conv.updatedAt)}
                          </p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                          className="text-[#E5E2DD] hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100 mt-0.5"
                          title="Supprimer"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))
                )}
              </div>

              <div className="px-6 py-4 border-t border-[#E5E2DD] flex items-center justify-between">
                <span className="text-[10px] text-[#8C8C8C] truncate max-w-[160px]">
                  {user.email}
                </span>
                <button
                  onClick={logOut}
                  className="text-[#CBC7C0] hover:text-red-400 transition-colors"
                  title="Déconnexion"
                >
                  <LogOut size={13} />
                </button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Chat */}
        <main className="flex-1 flex flex-col relative h-full min-w-0">
          <div className="flex-1 overflow-y-auto no-scrollbar px-6 md:px-32 py-8 md:py-16 space-y-12 md:space-y-24 scroll-smooth">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex w-full ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-2xl w-full group/msg ${message.role === "user" ? "text-right ml-auto" : "text-left mr-auto"}`}
                  >
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
                    <div
                      className={`markdown-body ${message.role === "user" ? "text-xl md:text-2xl font-light leading-snug" : "text-base md:text-lg leading-relaxed font-light"}`}
                    >
                      {message.role === "user" ? (
                        <span className="font-light">{message.content}</span>
                      ) : (
                        <Markdown
                          components={{
                            a: ({ href, children, ...props }) => (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline text-black dark:text-white font-medium hover:opacity-80"
                                {...props}
                              >
                                {children}
                              </a>
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

          <div className="h-auto min-h-20 py-4 md:py-0 md:h-28 px-6 md:px-24 flex items-center border-t border-[#E5E2DD] bg-[#FDFCFA]">
            <form
              onSubmit={handleSubmit}
              className="w-full flex flex-col md:flex-row md:items-center gap-3 md:gap-4 group"
            >
              <div className="flex items-center gap-3 md:gap-4 shrink-0">
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={models.length === 0 || isLoading}
                  title="Modèle"
                  className="h-8 max-w-40 shrink-0 border border-[#E5E2DD] px-2 text-[10px] tracking-widest uppercase text-[#8C8C8C] outline-none transition-colors hover:border-[#CBC7C0] disabled:opacity-30 appearance-none bg-white dark:bg-black"
                >
                  {models.length === 0 ? (
                    <option value="">Aucun modèle</option>
                  ) : (
                    models.map((model) => (
                      <option key={model.name} value={model.name}>
                        {getModelLabel(model.name)}
                      </option>
                    ))
                  )}
                </select>
              </div>

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
                    isLoading
                      ? "text-red-400 hover:text-red-500"
                      : "group-hover:text-black text-[#8C8C8C]"
                  }`}
                >
                  {isLoading ? "STOP" : "ENVOYER"}
                  <div className="w-6 md:w-12 h-[1px] bg-current"></div>
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
