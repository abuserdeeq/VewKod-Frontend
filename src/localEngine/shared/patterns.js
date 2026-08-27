// ============================================================
// Shared patterns / helpers
// ------------------------------------------------------------
// Small pieces of logic that many language analyzers need
// (comment detection, TODO markers, hard-coded secrets, etc.)
// live here once instead of being copy-pasted into every
// analyzer file.
// ============================================================

const COMMENT_PREFIXES = ["//", "#", "/*", "*", "<!--", "--"];

export function isCommentLine(trimmed) {
  return COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function commentExplanation() {
  return "This is a comment. It provides information for developers and is not normally executed.";
}

/**
 * Issues that are meaningful in almost every language.
 * Language-specific analyzers call this and then add their own
 * findings on top (bare except, ==, SELECT *, missing free(), ...).
 */
export function findCommonIssues(lines) {
  const issues = [];

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) return;

    if (/\b(TODO|FIXME|XXX)\b/i.test(line)) {
      issues.push({
        line: lineNumber,
        type: "review",
        message: "This line contains a TODO/FIXME marker and may represent unfinished work.",
      });
    }

    if (/\bdebugger\b/.test(line)) {
      issues.push({
        line: lineNumber,
        type: "review",
        message: "This is an explicit debugger statement. Consider removing it before production.",
      });
    }

    if (/(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']+["']/i.test(line)) {
      issues.push({
        line: lineNumber,
        type: "security",
        message: "This line may contain a hard-coded secret or credential. Sensitive values should normally be stored securely outside the source code.",
      });
    }

    // AWS-style access key literal (AKIA... 16 uppercase alphanumerics)
    if (/\bAKIA[0-9A-Z]{16}\b/.test(line)) {
      issues.push({
        line: lineNumber,
        type: "security",
        message: "This looks like a hard-coded AWS access key. Credentials like this should never be committed to source code.",
      });
    }

    // eval() / dynamic code execution — meaningful across JS/PHP/Python/Ruby/etc.
    if (/\beval\s*\(/.test(line)) {
      issues.push({
        line: lineNumber,
        type: "security",
        message: "`eval()` executes arbitrary code at runtime. If any part of its input can come from a user, this is a code-injection risk.",
      });
    }

    // String-concatenated SQL query built from a variable — a common
    // injection pattern across JS/PHP/Python/Java/etc. Heuristic: a
    // SELECT/INSERT/UPDATE/DELETE keyword followed by string
    // concatenation (`+`, `.`, or an f-string/template `{}`/`${}`)
    // rather than a parameterized placeholder.
    if (/\b(SELECT|INSERT|UPDATE|DELETE)\b.{0,80}(["']\s*\+|\.\s*\$|["']\s*\.\s*\$|\$\{|\{[\w.]+\})/i.test(line) && !/[?:]\s*\w+|@\w+|%s/.test(line)) {
      issues.push({
        line: lineNumber,
        type: "security",
        message: "This looks like a SQL query built by concatenating a variable directly into the string. Consider parameterized queries/prepared statements to avoid SQL injection.",
      });
    }

    // Hard-coded private IP / localhost bound with a wildcard host —
    // low-severity, but worth flagging as a portability/security note.
    if (/\b0\.0\.0\.0\b/.test(line) && /\b(bind|listen|host)\b/i.test(line)) {
      issues.push({
        line: lineNumber,
        type: "review",
        message: "Binding to `0.0.0.0` exposes the service on every network interface. Confirm that's intentional before deploying.",
      });
    }
  });

  return issues;
}

/** Count how many times a bare identifier appears across all lines. */
export function countUsages(lines, name) {
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  let count = 0;
  lines.forEach((line) => {
    const matches = line.match(re);
    if (matches) count += matches.length;
  });
  return count;
}

export function genericFallbackExplanation() {
  return "Executes a statement or operation that contributes to the program's overall logic.";
}

// ============================================================
// Function-scope computation
// ------------------------------------------------------------
// Assigns every line a "scope path" (e.g. "global" or
// "global>divide#4") so the symbol table can keep two different
// functions' variables of the same name separate. This tracks
// FUNCTION-level scope only (not every nested if/for block) —
// that's the level of isolation that actually matters for
// avoiding cross-function mix-ups, without needing a full parser.
//
// style:
//   "brace" — function body delimited by { }  (JS/TS/Java/C/C++/C#/Go/Rust/PHP/Swift/Kotlin)
//   "indent" — function body delimited by indentation (Python)
//   "end" — function body closed by a bare `end` keyword (Ruby)
//   "none" — no function scoping needed (HTML/CSS/SQL/Bash)
// ============================================================

export function computeLineScopes(lines, style, functionStartRegex) {
  const scopeOfLine = new Array(lines.length).fill("global");
  if (style === "none" || !functionStartRegex) return scopeOfLine;

  if (style === "brace") {
    const stack = [{ label: "global", enterDepth: -Infinity }];
    let depth = 0;

    lines.forEach((rawLine, i) => {
      const trimmed = rawLine.trim();
      const fnMatch = trimmed.match(functionStartRegex);

      if (fnMatch) {
        const label = `${stack[stack.length - 1].label}>${fnMatch[1] || "fn"}#${i}`;
        scopeOfLine[i] = stack[stack.length - 1].label; // the def line itself is still in the enclosing scope
        stack.push({ label, enterDepth: depth });
      } else {
        scopeOfLine[i] = stack[stack.length - 1].label;
      }

      const opens = (rawLine.match(/\{/g) || []).length;
      const closes = (rawLine.match(/\}/g) || []).length;
      depth += opens - closes;

      while (stack.length > 1 && depth <= stack[stack.length - 1].enterDepth) stack.pop();
    });

    return scopeOfLine;
  }

  if (style === "indent") {
    const stack = [{ label: "global", indent: -1 }];

    lines.forEach((rawLine, i) => {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        scopeOfLine[i] = stack[stack.length - 1].label;
        return;
      }

      const indent = rawLine.match(/^\s*/)[0].length;
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();

      scopeOfLine[i] = stack[stack.length - 1].label;
      const fnMatch = trimmed.match(functionStartRegex);
      if (fnMatch) {
        const label = `${stack[stack.length - 1].label}>${fnMatch[1] || "fn"}#${i}`;
        stack.push({ label, indent });
      }
    });

    return scopeOfLine;
  }

  if (style === "end") {
    const blockOpenerRe = /^(def|class|module|if|unless|while|until|for|case|do)\b/;
    const stack = [{ label: "global", enterDepth: -Infinity }];
    let depth = 0;

    lines.forEach((rawLine, i) => {
      const trimmed = rawLine.trim();
      const fnMatch = trimmed.match(functionStartRegex);

      if (fnMatch) {
        const label = `${stack[stack.length - 1].label}>${fnMatch[1] || "fn"}#${i}`;
        scopeOfLine[i] = stack[stack.length - 1].label;
        stack.push({ label, enterDepth: depth });
      } else {
        scopeOfLine[i] = stack[stack.length - 1].label;
      }

      if (blockOpenerRe.test(trimmed)) depth++;
      if (/^end\b/.test(trimmed)) {
        depth--;
        while (stack.length > 1 && depth <= stack[stack.length - 1].enterDepth) stack.pop();
      }
    });

    return scopeOfLine;
  }

  return scopeOfLine;
}
