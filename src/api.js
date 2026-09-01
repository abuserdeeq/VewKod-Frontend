// Backend URL is read from the environment so dev/staging/prod can point
// at different servers without a code change or rebuild-time edit.
// Copy .env.example to .env and set VITE_API_BASE_URL to override.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://vewkod.onrender.com";

// ============================================================
// Local Explanation Engine (fallback when backend is unavailable)
// ------------------------------------------------------------
// The actual engine now lives in ./localEngine — split into a
// core runner + symbol table, and one language-specific analyzer
// per supported language (Python, JavaScript, TypeScript, Java,
// C, C++, SQL, and more). See src/localEngine/ for details.
// ============================================================
import { generateLocalExplanation } from "./localEngine/core/engineRunner.js";

/**
 * Explain a code snippet.
 *
 * Tries the AI backend first (10s timeout), and transparently falls back
 * to the local rule-based engine if the backend is unreachable, slow, or
 * errors out.
 *
 * @param {string} code
 * @param {string} language
 * @param {AbortSignal} [externalSignal] - lets the caller cancel the
 *   request (e.g. a "Cancel" button). When the caller cancels, we skip
 *   the local fallback entirely and rethrow an AbortError instead of
 *   silently returning a local explanation the user didn't ask for.
 */
export async function explainCode(code, language = "auto", externalSignal) {
  if (externalSignal?.aborted) {
    throw new DOMException("Cancelled by user", "AbortError");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort);

  try {
    const response = await fetch(`${API_BASE_URL}/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, language }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    return { explanation: data.explanation, source: "ai" };
  } catch (err) {
    // If the user explicitly cancelled, respect that — don't fall back.
    if (externalSignal?.aborted) {
      throw new DOMException("Cancelled by user", "AbortError");
    }

    if (import.meta.env.DEV) {
      console.warn("Backend unavailable, using local explanation:", err.message);
    }
    // Fallback to local explanation (covers network errors, timeouts,
    // and non-OK server responses).
    const explanation = await generateLocalExplanation(code, language);
    return { explanation, source: "local" };
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}
