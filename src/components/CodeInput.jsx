import { useState, useCallback, useEffect } from "react";
import Editor from "react-simple-code-editor";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Trash2,
  ChevronDown,
  Zap,
  BookOpen,
  Keyboard,
  Code2,
} from "lucide-react";

// PrismJS - Import in CORRECT dependency order
import Prism from "prismjs";
// Core dependencies FIRST
import "prismjs/components/prism-markup";      // HTML/XML - dependency for many
import "prismjs/components/prism-clike";       // C-like base - needed for JS, Java, C, C++, C#, etc.
import "prismjs/components/prism-css";         // CSS
// Then individual languages
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-php";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-bash";

import { LANGUAGES, EXAMPLE_SNIPPETS } from "../data/exampleSnippets";

const MAX_CHARS = 5000;

const prismLanguageMap = {
  python: "python",
  javascript: "javascript",
  typescript: "typescript",
  java: "java",
  cpp: "cpp",
  c: "c",
  csharp: "csharp",
  go: "go",
  rust: "rust",
  php: "php",
  ruby: "ruby",
  swift: "swift",
  kotlin: "kotlin",
  sql: "sql",
  bash: "bash",
  html: "markup",
  css: "css",
  auto: "javascript",
};

export default function CodeInput({ onExplain, loading }) {
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("python");
  const [difficulty, setDifficulty] = useState("beginner");
  const [showLangDropdown, setShowLangDropdown] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [lineCount, setLineCount] = useState(1);

  const highlightCode = useCallback(
    (codeText) => {
      try {
        const prismLang = prismLanguageMap[language] || "javascript";
        const grammar = Prism.languages[prismLang];
        if (grammar && codeText) {
          return Prism.highlight(codeText, grammar, prismLang);
        }
      } catch (err) {
        console.warn("Prism highlight error:", err);
      }
      // Fallback: return plain text with HTML escaping if highlighting fails
      return codeText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    },
    [language]
  );

  useEffect(() => {
    setLineCount(code.split("\n").length || 1);
  }, [code]);

  // Keyboard shortcut: Ctrl+Enter
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [code, difficulty, language]);

  const handleSubmit = () => {
    if (!code.trim() || loading) return;
    onExplain(code, difficulty, language);
  };

  const handleClear = () => {
    setCode("");
  };

  const handleExampleClick = (snippet) => {
    setCode(snippet.code);
    setLanguage(snippet.language);
    setShowExamples(false);
  };

  const charCount = code.length;
  const isNearLimit = charCount > MAX_CHARS * 0.9;

  const currentLang = LANGUAGES.find((l) => l.id === language);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="w-full max-w-3xl mx-auto flex flex-col gap-4"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Language Selector */}
        <div className="relative">
          <button
            onClick={() => setShowLangDropdown(!showLangDropdown)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1a2e] border border-purple-900/30 text-sm text-gray-300 hover:border-purple-500/50 transition-colors"
          >
            <span>{currentLang?.icon}</span>
            <span className="hidden sm:inline">{currentLang?.name}</span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
          </button>

          <AnimatePresence>
            {showLangDropdown && (
              <motion.div
                initial={{ opacity: 0, y: -5, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -5, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-0 mt-2 w-56 max-h-72 overflow-y-auto rounded-xl bg-[#1a1a2e] border border-purple-900/30 shadow-xl z-30"
              >
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.id}
                    onClick={() => {
                      setLanguage(lang.id);
                      setShowLangDropdown(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
                      language === lang.id
                        ? "bg-purple-500/20 text-purple-300"
                        : "text-gray-400 hover:bg-purple-500/10 hover:text-gray-200"
                    }`}
                  >
                    <span className="w-5 text-center">{lang.icon}</span>
                    {lang.name}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Difficulty Selector */}
        <div className="flex rounded-lg bg-[#1a1a2e] border border-purple-900/30 p-0.5">
          {["beginner", "intermediate", "advanced"].map((level) => (
            <button
              key={level}
              onClick={() => setDifficulty(level)}
              className={`px-3 py-1.5 rounded-md text-xs capitalize transition-all ${
                difficulty === level
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {level}
            </button>
          ))}
        </div>

        {/* Example Snippets Toggle */}
        <button
          onClick={() => setShowExamples(!showExamples)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1a1a2e] border border-purple-900/30 text-sm text-gray-400 hover:text-gray-200 hover:border-purple-500/30 transition-colors"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Examples</span>
        </button>

        <div className="flex-1" />

        {/* Character Counter */}
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`${
              isNearLimit ? "text-amber-400" : "text-gray-500"
            }`}
          >
            {charCount.toLocaleString()}
          </span>
          <span className="text-gray-600">/</span>
          <span className="text-gray-600">{MAX_CHARS.toLocaleString()}</span>
        </div>
      </div>

      {/* Example Snippets Panel */}
      <AnimatePresence>
        {showExamples && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl bg-[#1a1a2e] border border-purple-900/20">
              {EXAMPLE_SNIPPETS.map((snippet) => (
                <button
                  key={snippet.id}
                  onClick={() => handleExampleClick(snippet)}
                  className="flex items-center gap-3 p-3 rounded-lg bg-[#151521] border border-purple-900/10 hover:border-purple-500/30 hover:bg-[#1e1e2e] transition-all text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
                    <Code2 className="w-4 h-4 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-200 font-medium">
                      {snippet.name}
                    </p>
                    <p className="text-xs text-gray-500 capitalize">
                      {snippet.language}
                    </p>
                  </div>
                  <Zap className="w-3.5 h-3.5 text-gray-600 ml-auto group-hover:text-purple-400 transition-colors" />
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editor Container */}
      <div className="relative rounded-xl bg-[#151521] border border-purple-900/30 overflow-hidden focus-within:border-purple-500/50 focus-within:shadow-[0_0_30px_-5px_rgba(168,85,247,0.2)] transition-all">
        {/* Editor Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-purple-900/20 bg-[#12121f]">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
            </div>
            <span className="text-xs text-gray-600 ml-2 font-mono">
              {currentLang?.name.toLowerCase() || "code"}
              {lineCount > 1 ? ` \u2022 ${lineCount} lines` : ` \u2022 ${lineCount} line`}
            </span>
          </div>
          {code && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>

        {/* Code Editor */}
        <div className="relative">
          <Editor
            value={code}
            onValueChange={(newCode) => {
              if (newCode.length <= MAX_CHARS) {
                setCode(newCode);
              }
            }}
            highlight={highlightCode}
            padding={20}
            className="font-mono text-[13px] leading-relaxed"
            textareaClassName="code-editor"
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 13,
              backgroundColor: "transparent",
              color: "#e2e8f0",
              minHeight: 280,
            }}
            placeholder="// Paste your code here..."
            disabled={loading}
          />
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Keyboard className="w-3.5 h-3.5" />
          <span>
            Press <kbd className="px-1.5 py-0.5 rounded bg-[#1a1a2e] border border-purple-900/30 text-gray-400">Ctrl</kbd>{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-[#1a1a2e] border border-purple-900/30 text-gray-400">Enter</kbd> to explain
          </span>
        </div>

        <motion.button
          onClick={handleSubmit}
          disabled={loading || !code.trim()}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm transition-all shadow-lg shadow-purple-500/25 btn-shine"
        >
          <Play className="w-4 h-4" />
          {loading ? "Analyzing..." : "Explain This Code"}
        </motion.button>
      </div>
    </motion.div>
  );
}
