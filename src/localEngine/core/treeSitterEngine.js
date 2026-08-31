// ============================================================
// Tree-sitter engine core — production version
// ------------------------------------------------------------
// Grew out of src/localEngine/pilot/pythonTreeSitter.js, which
// proved (see that file's history + the "Tree-sitter Pilot Test"
// GitHub Action) that a real AST lets unreachable-code-after-return
// and empty-except/catch checks be done structurally instead of by
// guessing from indentation/braces in raw text.
//
// Design goal: NEVER make the app depend on tree-sitter being
// available. WASM loading is asynchronous and can fail (offline,
// blocked CDN, wrong file, unsupported language). So:
//
//   - Loading happens in the background (warmTreeSitterEngine()),
//     started once when the app mounts.
//   - Everything else in the local engine keeps working exactly as
//     before, synchronously, whether or not loading has finished.
//   - Once a language's grammar is loaded, parsing that language's
//     code is synchronous (web-tree-sitter only needs the WASM
//     instantiation step to be async; Parser#parse() itself is
//     not), so astAugment.js can call getParsedTree() synchronously
//     from inside the existing synchronous generateLocalExplanation
//     pipeline — no API changes, no test breakage.
//
// If a given language's .wasm can't be found/loaded, that language
// simply never becomes "warm" and the local engine silently keeps
// using its existing regex-based analyzer, forever. Nothing crashes.
// ============================================================

// Maps our internal language ids (see analyzers/*.js `id` exports)
// to the grammar file tree-sitter-wasms@0.1.11 ships under
// node_modules/tree-sitter-wasms/out/. Confirmed present for
// "python" via the pilot CI run. The rest are the package's
// documented standard naming convention (tree-sitter-<name>.wasm)
// but have NOT been confirmed to exist in this exact package
// version — if one is missing/misnamed, that language just never
// goes warm (see module comment above), and the console warning
// below will name exactly which file was tried so the entry here
// can be corrected in one round-trip, the same way the Python path
// itself was pinned down.
export const WASM_FILENAMES = {
  python: "tree-sitter-python.wasm",
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
  java: "tree-sitter-java.wasm",
  c: "tree-sitter-c.wasm",
  cpp: "tree-sitter-cpp.wasm",
  csharp: "tree-sitter-c_sharp.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  php: "tree-sitter-php.wasm",
  bash: "tree-sitter-bash.wasm",
  // No known prebuilt grammar bundled in tree-sitter-wasms@0.1.11 for
  // these — left out on purpose so they cleanly fall back to the
  // existing regex analyzer instead of throwing 404s on every request.
  // swift: not bundled
  // kotlin: not bundled
  // sql: no widely-used stable grammar
};

// Where the .wasm files are actually served from at runtime. The
// build copies them here (see scripts/copy-wasm.mjs, wired up via
// the "postinstall" npm script) so they're plain static assets —
// no bundler-specific WASM import plugin required.
const WASM_BASE_URL = "/wasm/";

const languageCache = new Map(); // id -> Language (or "failed")
const pendingLoads = new Map(); // id -> Promise
let parserModule = null; // the web-tree-sitter module/class, once resolved
let parserInitPromise = null;
let sharedParser = null; // a single Parser instance we re-`setLanguage` on

function isBrowser() {
  return typeof window !== "undefined" && typeof fetch !== "undefined";
}

async function ensureParserModule() {
  if (parserModule) return parserModule;
  if (!parserInitPromise) {
    parserInitPromise = (async () => {
      const mod = await import("web-tree-sitter");
      const Parser = mod.default || mod;
      await Parser.init({
        locateFile: () => `${WASM_BASE_URL}tree-sitter.wasm`,
      });
      parserModule = Parser;
      return Parser;
    })();
  }
  return parserInitPromise;
}

// web-tree-sitter's exact export shape has moved around between
// versions (see pilot/inspect-module.mjs). Check every shape it
// could plausibly be under rather than assume one.
function findLanguageLoader(Parser) {
  return (
    Parser.Language ||
    Parser.prototype?.Language ||
    (typeof Parser.getLanguage === "function" ? Parser : null)
  );
}

async function loadLanguage(languageId) {
  const filename = WASM_FILENAMES[languageId];
  if (!filename) return null; // no grammar configured for this language

  if (languageCache.has(languageId)) {
    const cached = languageCache.get(languageId);
    return cached === "failed" ? null : cached;
  }
  if (pendingLoads.has(languageId)) return pendingLoads.get(languageId);

  const promise = (async () => {
    try {
      if (!isBrowser()) return null; // e.g. plain `node --test` runs — stay on regex path
      const Parser = await ensureParserModule();
      const LanguageLoader = findLanguageLoader(Parser);
      if (!LanguageLoader || typeof LanguageLoader.load !== "function") {
        console.warn("[treeSitterEngine] no working Language.load() on this web-tree-sitter build");
        languageCache.set(languageId, "failed");
        return null;
      }
      const lang = await LanguageLoader.load(`${WASM_BASE_URL}${filename}`);
      languageCache.set(languageId, lang);
      return lang;
    } catch (err) {
      console.warn(`[treeSitterEngine] could not load grammar for "${languageId}" (${filename}):`, err?.message || err);
      languageCache.set(languageId, "failed");
      return null;
    } finally {
      pendingLoads.delete(languageId);
    }
  })();

  pendingLoads.set(languageId, promise);
  return promise;
}

/**
 * Kicks off background loading for the given languages (default:
 * every language with a configured grammar). Fire-and-forget — call
 * this once when the app starts. Never throws.
 */
export function warmTreeSitterEngine(languageIds = Object.keys(WASM_FILENAMES)) {
  languageIds.forEach((id) => {
    loadLanguage(id).catch(() => {});
  });
}

/** True once a language's grammar has finished loading successfully. */
export function isLanguageWarm(languageId) {
  const cached = languageCache.get(languageId);
  return !!cached && cached !== "failed";
}

/**
 * Synchronously parses `code` as `languageId` IF that language's
 * grammar has already finished loading (see warmTreeSitterEngine).
 * Returns the tree's root node, or null if not warm / unsupported —
 * callers should treat null exactly like "no AST available" and
 * fall back to the regex analyzer, not as an error.
 */
export function getParsedTree(languageId, code) {
  const lang = languageCache.get(languageId);
  if (!lang || lang === "failed" || !parserModule) return null;

  try {
    if (!sharedParser) sharedParser = new parserModule();
    sharedParser.setLanguage(lang);
    const tree = sharedParser.parse(code);
    return tree.rootNode;
  } catch (err) {
    console.warn(`[treeSitterEngine] parse failed for "${languageId}":`, err?.message || err);
    return null;
  }
}
