// Replace with your deployed Render backend URL
const API_BASE_URL = "https://vewkod.onrender.com";

// ============================================================
// Local Explanation Engine (fallback when backend is unavailable)
// ------------------------------------------------------------
// The actual engine now lives in ./localEngine — split into a
// core runner + symbol table, and one language-specific analyzer
// per supported language (Python, JavaScript, TypeScript, Java,
// C, C++, HTML, CSS, SQL). See src/localEngine/ for details.
// ============================================================
import { generateLocalExplanation } from "./localEngine/core/engineRunner.js";

export async function explainCode(code, language = "auto") {
  // Try backend first
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(`${API_BASE_URL}/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, language }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    return { explanation: data.explanation, source: "ai" };
  } catch (err) {
    console.warn("Backend unavailable, using local explanation:", err.message);
    // Fallback to local explanation
    const explanation = generateLocalExplanation(code, language);
    return { explanation, source: "local" };
  }
}
