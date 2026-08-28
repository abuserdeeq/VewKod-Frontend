import { useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Header from "./components/Header";
import CodeInput from "./components/CodeInput";
import ResultDisplay from "./components/ResultDisplay";
import Loader from "./components/Loader";
import Toast from "./components/Toast";
import HistoryPanel from "./components/HistoryPanel";
import { explainCode } from "./api";
import { useLocalStorage } from "./hooks/useLocalStorage";

const MAX_HISTORY_ITEMS = 10;

export default function App() {
  const [result, setResult] = useState("");
  const [resultSource, setResultSource] = useState("ai");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  // Saved past explanations, newest first, capped at MAX_HISTORY_ITEMS.
  const [history, setHistory] = useLocalStorage("vewkod_history", []);

  const codeInputRef = useRef(null);
  const abortControllerRef = useRef(null);

  const showToast = useCallback((message, type = "success") => {
    setToast({ message, type });
  }, []);

  const handleExplain = async (code, language) => {
    setLoading(true);
    setError("");
    setResult("");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const { explanation, source } = await explainCode(code, language, controller.signal);
      setResult(explanation);
      setResultSource(source);

      setHistory((prev) => {
        const entry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          code,
          language,
          explanation,
          source,
          timestamp: new Date().toISOString(),
        };
        return [entry, ...prev].slice(0, MAX_HISTORY_ITEMS);
      });

      if (source === "local") {
        showToast(
          "Backend unavailable. Using local explanation engine.",
          "info"
        );
      } else {
        showToast("Explanation generated successfully!", "success");
      }
    } catch (err) {
      if (err.name === "AbortError") {
        // User-initiated cancellation — no error state, just stop quietly.
        showToast("Explanation cancelled.", "info");
      } else {
        if (import.meta.env.DEV) console.error(err);
        setError("Something went wrong. Please check your connection and try again.");
        showToast("Failed to generate explanation. Please try again.", "error");
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
  };

  const handleClearResult = () => {
    setResult("");
    setError("");
  };

  const handleRestoreHistory = (entry) => {
    codeInputRef.current?.loadSnippet(entry.code, entry.language);
    setResult(entry.explanation);
    setResultSource(entry.source);
    setError("");
    setShowHistory(false);
  };

  const handleDeleteHistoryItem = (id) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col relative overflow-hidden">
      {/* Animated Background Blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl animate-float" />
        <div className="absolute top-1/2 -right-40 w-80 h-80 bg-cyan-600/10 rounded-full blur-3xl animate-float-delayed" />
        <div className="absolute -bottom-40 left-1/3 w-72 h-72 bg-blue-800/10 rounded-full blur-3xl animate-pulse-glow" />
      </div>

      <Header
        historyCount={history.length}
        onOpenHistory={() => setShowHistory(true)}
      />

      <main className="flex-1 px-4 py-8 sm:py-12 relative z-10">
        <div className="max-w-6xl mx-auto">
          {/* Hero Text */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-10"
          >
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">
              Understand Any{" "}
              <span className="gradient-text">Code</span> Instantly
            </h2>
            <p className="text-slate-400 text-sm sm:text-base max-w-lg mx-auto">
              Paste your code and get AI-powered explanations in seconds.
            </p>
          </motion.div>

          <CodeInput
            ref={codeInputRef}
            onExplain={handleExplain}
            onCancel={handleCancel}
            loading={loading}
          />

          <AnimatePresence>
            {loading && <Loader />}
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-3xl mx-auto mt-6"
              >
                <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                  <svg
                    className="w-5 h-5 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <span>{error}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {result && (
              <ResultDisplay
                result={result}
                source={resultSource}
                onClear={handleClearResult}
              />
            )}
          </AnimatePresence>

          {!result && !loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="max-w-3xl mx-auto mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4"
            >
              {[
                {
                  title: "Paste Code",
                  desc: "Paste any code snippet from your project",
                  icon: "📋",
                },
                {
                  title: "Pick a Language",
                  desc: "Auto-detected, or choose from 17 supported languages",
                  icon: "🎯",
                },
                {
                  title: "Get Explanation",
                  desc: "Receive detailed breakdown in seconds",
                  icon: "⚡",
                },
              ].map((feature, i) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + i * 0.1 }}
                  className="p-4 rounded-xl bg-[#1e293b]/50 border border-slate-700/30 text-center"
                >
                  <div className="text-2xl mb-2">{feature.icon}</div>
                  <h3 className="text-sm font-semibold text-slate-200 mb-1">
                    {feature.title}
                  </h3>
                  <p className="text-xs text-slate-500">{feature.desc}</p>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </main>

      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="w-full py-6 px-4 border-t border-slate-700/30 relative z-10"
      >
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600">
          <p> Vewkod. Built with React & Tailwind CSS.</p>
          <p className="flex items-center gap-1">
            Made with
            <span className="text-blue-500">♥</span>
            for developers
          </p>
        </div>
      </motion.footer>

      <AnimatePresence>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>

      <HistoryPanel
        open={showHistory}
        history={history}
        onClose={() => setShowHistory(false)}
        onRestore={handleRestoreHistory}
        onDelete={handleDeleteHistoryItem}
      />
    </div>
  );
}
