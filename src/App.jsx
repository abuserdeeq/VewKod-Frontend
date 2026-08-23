import { useState } from "react";
import Header from "./components/Header";
import CodeInput from "./components/CodeInput";
import ResultDisplay from "./components/ResultDisplay";
import Loader from "./components/Loader";
import { explainCode } from "./api";

export default function App() {
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleExplain = async (code, difficulty) => {
    setLoading(true);
    setError("");
    setResult("");
    try {
      const explanation = await explainCode(code, difficulty);
      setResult(explanation);
    } catch (err) {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f1a] flex flex-col">
      <Header />
      <main className="flex-1 px-4 py-10">
        <CodeInput onExplain={handleExplain} loading={loading} />
        {loading && <Loader />}
        {error && (
          <p className="text-red-400 text-center mt-4 text-sm">{error}</p>
        )}
        <ResultDisplay result={result} />
      </main>
    </div>
  );
}