import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mail, Lock, User, Github, Loader2 } from "lucide-react";

// Lucide has no official Google mark, so this is a small inline SVG of
// the standard four-color "G" logo, sized to match the lucide icons
// it sits next to (w-4 h-4 / w-5 h-5 via className).
function GoogleIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M23.49 12.27c0-.82-.07-1.42-.22-2.05H12v3.72h6.44c-.13 1.03-.83 2.6-2.39 3.65l-.02.14 3.47 2.62.24.02c2.21-2 3.75-4.94 3.75-8.1z" fill="#4285F4" />
      <path d="M12 24c3.24 0 5.95-1.05 7.93-2.85l-3.78-2.9c-1.01.68-2.36 1.15-4.15 1.15-3.18 0-5.86-2.06-6.82-4.9l-.14.01-3.6 2.72-.05.13C3.36 21.3 7.36 24 12 24z" fill="#34A853" />
      <path d="M5.18 14.5c-.25-.73-.39-1.5-.39-2.5s.14-1.77.38-2.5l-.01-.16-3.65-2.76-.12.06C.65 8.24 0 10.06 0 12s.65 3.76 1.76 5.36l3.42-2.86z" fill="#FBBC05" />
      <path d="M12 4.75c2.25 0 3.77.94 4.64 1.73l3.38-3.25C17.94 1.19 15.24 0 12 0 7.36 0 3.36 2.7 1.76 6.64l3.41 2.86c.97-2.84 3.65-4.75 6.83-4.75z" fill="#EA4335" />
    </svg>
  );
}

export default function AuthModal({ open, onClose }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isLogin = mode === "login";

  const resetAndClose = () => {
    setForm({ name: "", email: "", password: "", confirmPassword: "" });
    setError("");
    setSubmitting(false);
    onClose();
  };

  const handleChange = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!isLogin && form.password !== form.confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    // No auth backend is wired up yet — this is a UI-only placeholder
    // so the flow can be reviewed/demoed. Swap this block for a real
    // API call (e.g. to /auth/login or /auth/register) when ready.
    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    setSubmitting(false);
    resetAndClose();
  };

  const handleSocial = (provider) => {
    // Same placeholder note as above — wire this up to real OAuth
    // (e.g. redirect to /auth/google or /auth/github) when the
    // backend supports it.
    if (import.meta.env.DEV) console.log(`Sign in with ${provider} — not yet wired to a backend.`);
    resetAndClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={resetAndClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              role="dialog"
              aria-modal="true"
              aria-label={isLogin ? "Log in" : "Create an account"}
              className="w-full max-w-sm bg-[#0f172a] border border-slate-700/40 rounded-2xl shadow-xl shadow-black/40 overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/30">
                <h2 className="text-sm font-semibold text-white">
                  {isLogin ? "Log in to Vewkod" : "Create your account"}
                </h2>
                <button
                  onClick={resetAndClose}
                  aria-label="Close"
                  className="text-slate-500 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Login / Register tabs */}
              <div className="flex mx-5 mt-4 rounded-lg bg-[#1e293b] border border-slate-700/40 p-1">
                {["login", "register"].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => {
                      setMode(tab);
                      setError("");
                    }}
                    className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                      mode === tab
                        ? "bg-blue-600 text-white shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {tab === "login" ? "Login" : "Register"}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="px-5 pt-4 pb-5 flex flex-col gap-3">
                {!isLogin && (
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={handleChange("name")}
                      placeholder="Full name"
                      className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#1e293b] border border-slate-700/40 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50"
                    />
                  </div>
                )}

                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={handleChange("email")}
                    placeholder="Email address"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#1e293b] border border-slate-700/40 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50"
                  />
                </div>

                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={form.password}
                    onChange={handleChange("password")}
                    placeholder="Password"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#1e293b] border border-slate-700/40 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50"
                  />
                </div>

                {!isLogin && (
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={form.confirmPassword}
                      onChange={handleChange("confirmPassword")}
                      placeholder="Confirm password"
                      className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#1e293b] border border-slate-700/40 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50"
                    />
                  </div>
                )}

                {error && <p className="text-xs text-red-400">{error}</p>}

                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-1 w-full py-2 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 text-white text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isLogin ? "Log in" : "Create account"}
                </button>

                <div className="flex items-center gap-3 my-1">
                  <div className="h-px flex-1 bg-slate-700/40" />
                  <span className="text-[11px] text-slate-500">or continue with</span>
                  <div className="h-px flex-1 bg-slate-700/40" />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleSocial("Google")}
                    className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-[#1e293b] border border-slate-700/40 text-sm text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
                  >
                    <GoogleIcon className="w-4 h-4" />
                    Google
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSocial("GitHub")}
                    className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-[#1e293b] border border-slate-700/40 text-sm text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
                  >
                    <Github className="w-4 h-4" />
                    GitHub
                  </button>
                </div>

                <p className="text-center text-[11px] text-slate-500 mt-1">
                  {isLogin ? "Don't have an account? " : "Already have an account? "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode(isLogin ? "register" : "login");
                      setError("");
                    }}
                    className="text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    {isLogin ? "Sign up" : "Log in"}
                  </button>
                </p>
              </form>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
