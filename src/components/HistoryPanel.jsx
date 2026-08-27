import { motion, AnimatePresence } from "framer-motion";
import { X, Clock, Trash2, Bot, Cpu } from "lucide-react";

function timeAgo(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function HistoryPanel({ open, history, onClose, onRestore, onDelete, onClearAll }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            role="dialog"
            aria-label="Explanation history"
            className="fixed top-0 right-0 h-full w-full max-w-sm bg-[#0f172a] border-l border-slate-700/40 z-50 flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/30">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-400" />
                <h2 className="text-sm font-semibold text-white">History</h2>
                <span className="text-xs text-slate-500">({history.length})</span>
              </div>
              <button
                onClick={onClose}
                aria-label="Close history panel"
                className="text-slate-500 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3">
              {history.length === 0 ? (
                <div className="text-center text-sm text-slate-500 mt-10 px-4">
                  No explanations yet. Run one and it'll show up here so you
                  can come back to it later.
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {history.map((item) => (
                    <li key={item.id}>
                      <div className="group rounded-xl bg-[#1e293b] border border-slate-700/30 hover:border-blue-500/30 transition-colors overflow-hidden">
                        <button
                          onClick={() => onRestore(item)}
                          className="w-full text-left p-3"
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-mono text-blue-300 capitalize">
                              {item.language}
                            </span>
                            <span className="flex items-center gap-2 text-[10px] text-slate-500">
                              {item.source === "ai" ? (
                                <Bot className="w-3 h-3" />
                              ) : (
                                <Cpu className="w-3 h-3" />
                              )}
                              {timeAgo(item.timestamp)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 font-mono truncate">
                            {item.code.split("\n")[0] || "(empty)"}
                          </p>
                        </button>
                        <div className="px-3 pb-2 flex justify-end">
                          <button
                            onClick={() => onDelete(item.id)}
                            aria-label="Delete this history item"
                            className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {history.length > 0 && (
              <div className="px-5 py-3 border-t border-slate-700/30">
                <button
                  onClick={onClearAll}
                  className="w-full text-xs text-slate-500 hover:text-red-400 transition-colors"
                >
                  Clear all history
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
