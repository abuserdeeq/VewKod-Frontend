import { useEffect, useState } from "react";
import { motion } from "framer-motion";

// After a few seconds we're likely past a fast AI response and closer to
// the 10s backend timeout, so let the user know a local fallback may kick
// in soon instead of leaving them guessing why it's taking a while.
const SLOW_HINT_DELAY_MS = 4000;

export default function Loader() {
  const [showSlowHint, setShowSlowHint] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowSlowHint(true), SLOW_HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center mt-10 gap-4"
    >
      <div className="flex items-center gap-2">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-3 h-3 rounded-full bg-blue-500"
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.5, 1, 0.5],
            }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              delay: i * 0.2,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
      <motion.p
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="text-sm text-blue-300/70 font-medium"
      >
        Analyzing your code...
      </motion.p>
      {showSlowHint && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xs text-slate-500 max-w-xs text-center"
        >
          Taking a bit longer — if the AI backend doesn't respond soon,
          we'll fall back to the local explanation engine automatically.
        </motion.p>
      )}
    </motion.div>
  );
}
