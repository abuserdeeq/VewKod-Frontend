// ============================================================
// Symbol Table
// ------------------------------------------------------------
// Shared "memory" that language analyzers write to while they
// scan a snippet, and that explainLine()/findIssues() read from
// afterwards. This is what lets the engine understand that
// `users` is a list, that `user` is the current item while
// looping over `users`, and so on — instead of treating every
// line as an isolated string.
//
// Scoping: every method takes an optional `scope` string (default
// "global"). Scopes are dot-path-like, e.g. "global>divide#4" for
// a function named `divide` starting at line 4, nested inside the
// global scope. This lets two different functions each declare a
// variable named `x` without one clobbering the other — `get()`
// searches the given scope first, then walks up to its parent
// scopes, ending at "global". Analyzers that don't pass a scope
// behave exactly as before (everything shares "global").
// ============================================================

function article(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

const GLOBAL_SCOPE = "global";

/** "global>outer#2>inner#5" -> ["global>outer#2>inner#5", "global>outer#2", "global"] */
function scopeChain(scope) {
  const chain = [];
  let s = scope || GLOBAL_SCOPE;
  chain.push(s);
  while (s.includes(">")) {
    s = s.slice(0, s.lastIndexOf(">"));
    chain.push(s);
  }
  if (chain[chain.length - 1] !== GLOBAL_SCOPE) chain.push(GLOBAL_SCOPE);
  return chain;
}

export function createSymbolTable() {
  return {
    symbols: new Map(),

    /**
     * Register or enrich a symbol within a given scope.
     * Later, more specific info (e.g. discovering `users` is a
     * list after first seeing it as a generic "variable") is
     * merged in rather than discarded.
     */
    add(name, role, meta = {}, scope = GLOBAL_SCOPE) {
      if (!name) return;

      const key = `${scope}::${name}`;
      const existing = this.symbols.get(key);

      if (!existing) {
        this.symbols.set(key, { name, role, scope, ...meta });
        return;
      }

      // Prefer a more specific role over a generic "variable" one,
      // but never downgrade a specific role back to generic.
      const genericRoles = new Set(["variable", undefined]);
      const nextRole = genericRoles.has(role) && !genericRoles.has(existing.role)
        ? existing.role
        : role;

      this.symbols.set(key, { ...existing, ...meta, role: nextRole });
    },

    /** Looks in `scope` first, then walks up through its parent scopes. */
    get(name, scope = GLOBAL_SCOPE) {
      for (const s of scopeChain(scope)) {
        const found = this.symbols.get(`${s}::${name}`);
        if (found) return found;
      }
      return null;
    },

    has(name, scope = GLOBAL_SCOPE) {
      return this.get(name, scope) !== null;
    },

    /**
     * Turn a known symbol into a short, human-readable phrase.
     * Falls back to a plain backtick-quoted name if unknown.
     */
    describe(name, scope = GLOBAL_SCOPE) {
      const s = this.get(name, scope);
      if (!s) return `\`${name}\``;

      switch (s.role) {
        case "list":
          return `the \`${name}\` list`;
        case "dict":
          return `the \`${name}\` dictionary/object`;
        case "set":
          return `the \`${name}\` set`;
        case "loop-item":
          return `the current item (\`${name}\`) from ${s.of ? `\`${s.of}\`` : "the collection being looped over"}${s.ofType ? ` (${article(s.ofType)} ${s.ofType})` : ""}`;
        case "function":
          return `the \`${name}\` function`;
        case "class":
          return `the \`${name}\` class`;
        case "number":
          return `the number stored in \`${name}\``;
        case "string":
          return `the text stored in \`${name}\``;
        case "boolean":
          return `the true/false flag \`${name}\``;
        case "pointer":
          return `the pointer \`${name}\``;
        case "parameter":
          return `the parameter \`${name}\``;
        default:
          return `\`${name}\``;
      }
    },

    /** Every identifier referenced in `text` that we have info about, in `scope`. */
    knownIdentifiersIn(text, scope = GLOBAL_SCOPE) {
      const found = [];
      const ids = text.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) || [];
      const seen = new Set();

      ids.forEach((id) => {
        if (this.has(id, scope) && !seen.has(id)) {
          seen.add(id);
          found.push(id);
        }
      });

      return found;
    },
  };
}
