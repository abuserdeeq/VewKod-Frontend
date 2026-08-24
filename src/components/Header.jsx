import { motion } from "framer-motion";
import { Code2, Github, Sparkles } from "lucide-react";

export default function Header() {
  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full py-6 px-4 border-b border-slate-700/20 relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-blue-900/5 via-transparent to-cyan-900/5 pointer-events-none" />

      <div className="max-w-6xl mx-auto flex items-center justify-between relative z-10">
        <div className="flex items-center gap-3">
          <motion.div
            whileHover={{ rotate: 5, scale: 1.05 }}
            className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-blue-500/20"
          >
            <Code2 className="w-5 h-5 text-white" />
          </motion.div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              Vewkod
              <Sparkles className="w-4 h-4 text-blue-400" />
            </h1>
            <p className="text-xs text-slate-500 -mt-0.5">AI Code Explainer</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <a
            href="https://github.com/abuserdeeq/VewKod"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors group"
          >
            <Github className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </div>
    </motion.header>
  );
}
