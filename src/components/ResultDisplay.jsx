import { useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check, Bot, Cpu, Sparkles } from "lucide-react";

export default function ResultDisplay({ result, source = "ai" }) {
  const [copied, setCopied] = useState(false);

  if (!result) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, type: "spring", stiffness: 100 }}
      className="w-full max-w-3xl mx-auto mt-8"
    >
      <div className="rounded-2xl bg-[#1e293b] border border-slate-700/40 overflow-hidden shadow-[0_0_40px_-10px_rgba(59,130,246,0.15)]">
        {/* Result Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700/30 bg-[#0f172a]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
              {source === "ai" ? (
                <Bot className="w-4 h-4 text-blue-400" />
              ) : (
                <Cpu className="w-4 h-4 text-amber-400" />
              )}
            </div>
            <div>
              <h2 className="text-blue-300 font-semibold text-sm uppercase tracking-wide flex items-center gap-2">
                Explanation
                {source === "ai" && (
                  <span className="flex items-center gap-1 text-[10px] bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded-full border border-blue-500/20">
                    <Sparkles className="w-3 h-3" />
                    AI
                  </span>
                )}
                {source === "local" && (
                  <span className="flex items-center gap-1 text-[10px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-500/20">
                    <Cpu className="w-3 h-3" />
                    Local
                  </span>
                )}
              </h2>
            </div>
          </div>

          <motion.button
            onClick={handleCopy}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              copied
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-[#1e293b] text-slate-400 hover:text-white border border-slate-700/40 hover:border-blue-500/30"
            }`}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy
              </>
            )}
          </motion.button>
        </div>

        {/* Result Content */}
        <div className="p-5">
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              components={{
                h1: ({ children }) => (
                  <h1 className="text-xl font-bold text-blue-300 mt-0 mb-4 pb-2 border-b border-slate-700/30">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-lg font-semibold text-blue-300 mt-6 mb-3">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-base font-semibold text-blue-300/90 mt-4 mb-2">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="text-slate-300 leading-relaxed mb-3">
                    {children}
                  </p>
                ),
                strong: ({ children }) => (
                  <strong className="text-white font-semibold">
                    {children}
                  </strong>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside space-y-1.5 text-slate-300 mb-4 ml-1">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-300 mb-4 ml-1">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="text-slate-300 leading-relaxed">
                    {children}
                  </li>
                ),
                code({ inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || "");
                  const language = match ? match[1] : "text";
                  const codeString = String(children).replace(/\n$/, "");

                  if (!inline && codeString.includes("\n")) {
                    return (
                      <div className="my-4 rounded-xl overflow-hidden border border-slate-700/40">
                        <div className="flex items-center justify-between px-4 py-2 bg-[#0f172a] border-b border-slate-700/30">
                          <span className="text-xs text-slate-500 font-mono capitalize">
                            {language}
                          </span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(codeString);
                            }}
                            className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                        <SyntaxHighlighter
                          language={language}
                          style={vscDarkPlus}
                          customStyle={{
                            margin: 0,
                            padding: "1rem",
                            background: "#0f172a",
                            fontSize: "13px",
                            lineHeight: "1.6",
                          }}
                          showLineNumbers={codeString.split("\n").length > 3}
                          lineNumberStyle={{
                            color: "#475569",
                            fontSize: "12px",
                            paddingRight: "1rem",
                            minWidth: "2.5rem",
                          }}
                        >
                          {codeString}
                        </SyntaxHighlighter>
                      </div>
                    );
                  }

                  return (
                    <code
                      className="px-1.5 py-0.5 rounded-md bg-[#1e293b] text-blue-300 text-xs font-mono border border-slate-700/30"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => <>{children}</>,
                hr: () => (
                  <hr className="border-slate-700/30 my-6" />
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-blue-500/40 pl-4 py-1 my-4 text-slate-400 italic bg-blue-500/5 rounded-r-lg">
                    {children}
                  </blockquote>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline decoration-blue-500/30 hover:decoration-blue-400 transition-colors"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {result}
            </ReactMarkdown>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-700/30 bg-[#0f172a]/50 flex items-center justify-between">
          <span className="text-xs text-slate-600">
            Generated by {source === "ai" ? "AI" : "Local Engine"}
          </span>
          <span className="text-xs text-slate-600">
            {result.length.toLocaleString()} chars
          </span>
        </div>
      </div>
    </motion.div>
  );
}
