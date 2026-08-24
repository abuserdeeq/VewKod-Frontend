import { useEffect } from "react";
import { Check, AlertCircle, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function Toast({ message, type = "success", onClose, duration = 3000 }) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  const icons = {
    success: <Check className="w-4 h-4 text-emerald-400" />,
    error: <AlertCircle className="w-4 h-4 text-red-400" />,
    info: <AlertCircle className="w-4 h-4 text-blue-400" />,
  };

  const borders = {
    success: "border-emerald-500/30",
    error: "border-red-500/30",
    info: "border-blue-500/30",
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 100, scale: 0.9 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, x: 100, scale: 0.9 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#1e293b] border ${borders[type]} shadow-lg backdrop-blur-sm`}
      >
        {icons[type]}
        <span className="text-sm text-slate-200">{message}</span>
        <button
          onClick={onClose}
          className="ml-2 text-slate-500 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
