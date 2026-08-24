import ReactMarkdown from "react-markdown";

export default function ResultDisplay({ result }) {
  if (!result) return null;

  return (
    <div className="w-full max-w-2xl mx-auto mt-6 rounded-lg bg-[#151521] border border-purple-900/40 p-5 shadow-[0_0_25px_-5px_rgba(168,85,247,0.25)]">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-purple-400 font-semibold text-sm uppercase tracking-wide">
          Explanation
        </h2>
        <button
          onClick={() => navigator.clipboard.writeText(result)}
          className="text-xs text-gray-400 hover:text-white transition"
        >
          Copy
        </button>
      </div>

      <div className="prose prose-invert prose-sm max-w-none prose-headings:text-purple-300 prose-strong:text-white prose-code:text-purple-300 prose-code:bg-[#1e1e2e] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-[#0d0d15] prose-pre:border prose-pre:border-purple-900/40 prose-a:text-purple-400">
        <ReactMarkdown>{result}</ReactMarkdown>
      </div>
    </div>
  );
}
