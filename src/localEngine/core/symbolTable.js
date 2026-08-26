// ============================================================
// Symbol Table
// ------------------------------------------------------------
// Shared "memory" that language analyzers write to while they
// scan a snippet, and that explainLine()/findIssues() read from
// afterwards. This is what lets the engine understand that
// `users` is a list, that `user` is the current item while
// looping over `users`, and so on — instead of treating every
// line as an isolated string.
// ============================================================

function article(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

export function createSymbolTable() {
  return {
    symbols: new Map(),

    /**
     * Register or enrich a symbol.
     * Later, more specific info (e.g. discovering `users` is a
     * list after first seeing it as a generic "variable") is
     * merged in rather than discarded.
     */
    add(name, role, meta = {}) {
      if (!name) return;

      const existing = this.symbols.get(name);

      if (!existing) {
        this.symbols.set(name, { name, role, ...meta });
        return;
      }

      // Prefer a more specific role over a generic "variable" one,
      // but never downgrade a specific role back to generic.
      const genericRoles = new Set(["variable", undefined]);
      const nextRole = genericRoles.has(role) && !genericRoles.has(existing.role)
        ? existing.role
        : role;

      this.symbols.set(name, { ...existing, ...meta, role: nextRole });
    },

    get(name) {
      return this.symbols.get(name) || null;
    },

    has(name) {
      return this.symbols.has(name);
    },

    /**
     * Turn a known symbol into a short, human-readable phrase.
     * Falls back to a plain backtick-quoted name if unknown.
     */
    describe(name) {
      const s = this.get(name);
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

    /** Every identifier referenced in `text` that we have info about. */
    knownIdentifiersIn(text) {
      const found = [];
      const ids = text.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) || [];
      const seen = new Set();

      ids.forEach((id) => {
        if (this.has(id) && !seen.has(id)) {
          seen.add(id);
          found.push(id);
        }
      });

      return found;
    },
  };
}
