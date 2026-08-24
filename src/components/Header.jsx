export default function Header() {
  return (
    <header className="w-full py-8 px-4 flex flex-col items-center justify-center gap-2 border-b border-purple-900/40">
      <div className="flex items-center gap-2">
        <span className="text-2xl font-mono text-purple-400">{"</>"}</span>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Vewkod
        </h1>
      </div>
      <p className="text-sm text-gray-400">
        Paste any code. Understand it instantly.
      </p>
    </header>
  );
}
