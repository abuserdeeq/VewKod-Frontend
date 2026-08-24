import { useState } from "react";

export default function CodeInput({ onExplain, loading }) {
  const [code, setCode] = useState("");
  const [difficulty, setDifficulty] = useState("beginner");

  const handleSubmit = () => {
    if (!code.trim()) return;
    onExplain(code, difficulty);
  };

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-4">
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Paste your code here..."
        rows={10}
        className="w-full rounded-lg bg-[#151521] border border-purple-900/40 text-gray-100 font-mono text-sm p-4 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-shadow focus:shadow-[0_0_25px_-5px_rgba(168,85,247,0.4)]"
      />

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {["beginner", "intermediate"].map((level) => (
            <button
              key={level}
              onClick={() => setDifficulty(level)}
              className={`px-3 py-1 rounded-full text-sm capitalize transition ${
                difficulty === level
                  ? "bg-purple-600 text-white"
                  : "bg-[#1e1e2e] text-gray-400 hover:text-white"
              }`}
            >
              {level}
            </button>
          ))}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="px-5 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 disabled:opacity-50 text-white font-medium transition shadow-[0_0_20px_-5px_rgba(168,85,247,0.6)]"
        >
          {loading ? "Explaining..." : "Explain This Code"}
        </button>
      </div>
    </div>
  );
}
