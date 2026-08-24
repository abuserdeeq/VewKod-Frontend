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
      <div className="rounded-2xl bg-[#151521] border border-purple-900/30 overflow-hidden shadow-[0_0_40px_-10px_rgba(168,85,247,0.15)]">
        {/* Result Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-purple-900/20 bg-[#12121f]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-fuchsia-500/20 flex items-center justify-center">
              {source === "ai" ? (
                <Bot className="w-4 h-4 text-purple-400" />
              ) : (
                <Cpu className="w-4 h-4 text-amber-400" />
              )}
            </div>
            <div>
              <h2 className="text-purple-300 font-semibold text-sm uppercase tracking-wide flex items-center gap-2">
                Explanation
                {source === "ai" && (
                  <span className="flex items-center gap-1 text-[10px] bg-purple-500/15 text-purple-400 px-1.5 py-0.5 rounded-full border border-purple-500/20">
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
                : "bg-[#1a1a2e] text-gray-400 hover:text-white border border-purple-900/30 hover:border-purple-500/30"
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
                  <h1 className="text-xl font-bold text-purple-300 mt-0 mb-4 pb-2 border-b border-purple-900/30">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-lg font-semibold text-purple-300 mt-6 mb-3">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-base font-semibold text-purple-300/90 mt-4 mb-2">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="text-gray-300 leading-relaxed mb-3">
                    {children}
                  </p>
                ),
                strong: ({ children }) => (
                  <strong className="text-white font-semibold">
                    {children}
                  </strong>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside space-y-1.5 text-gray-300 mb-4 ml-1">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside space-y-1.5 text-gray-300 mb-4 ml-1">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="text-gray-300 leading-relaxed">
                    {children}
                  </li>
                ),
                code({ inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || "");
                  const language = match ? match[1] : "text";
                  const codeString = String(children).replace(/\n$/, "");

                  if (!inline && codeString.includes("\n")) {
                    return (
                      <div className="my-4 rounded-xl overflow-hidden border border-purple-900/30">
                        <div className="flex items-center justify-between px-4 py-2 bg-[#0d0d15] border-b border-purple-900/20">
                          <span className="text-xs text-gray-500 font-mono capitalize">
                            {language}
                          </span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(codeString);
                            }}
                            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
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
                            background: "#0d0d15",
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
                      className="px-1.5 py-0.5 rounded-md bg-[#1e1e2e] text-purple-300 text-xs font-mono border border-purple-900/20"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => <>{children}</>,
                hr: () => (
                  <hr className="border-purple-900/20 my-6" />
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-purple-500/40 pl-4 py-1 my-4 text-gray-400 italic bg-purple-500/5 rounded-r-lg">
                    {children}
                  </blockquote>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline decoration-purple-500/30 hover:decoration-purple-400 transition-colors"
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
        <div className="px-5 py-3 border-t border-purple-900/20 bg-[#12121f]/50 flex items-center justify-between">
          <span className="text-xs text-gray-600">
            Generated by {source === "ai" ? "AI" : "Local Engine"}
          </span>
          <span className="text-xs text-gray-600">
            {result.length.toLocaleString()} chars
          </span>
        </div>
      </div>
    </motion.div>
  );
}
