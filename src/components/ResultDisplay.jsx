export default function ResultDisplay({ result }) {
  if (!result) return null;

  return (
    <div className="w-full max-w-2xl mx-auto mt-6 rounded-lg bg-[#151521] border border-purple-900/40 p-5">
      <h2 className="text-purple-400 font-semibold mb-2 text-sm uppercase tracking-wide">
        Explanation
      </h2>
      <p className="text-gray-200 whitespace-pre-wrap leading-relaxed">
        {result}
      </p>
    </div>
  );
}