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

const AUGMENTED_OPS = {
  "+=": { verb: "Increases", prep: "by" },
  "-=": { verb: "Decreases", prep: "by" },
  "*=": { verb: "Multiplies", prep: "by" },
  "/=": { verb: "Divides", prep: "by" },
  "//=": { verb: "Divides (rounding down)", prep: "by" },
  "%=": { verb: "Reduces", prep: "to its remainder when divided by" },
  "**=": { verb: "Raises", prep: "to the power of" },
};

/**
 * Explains an augmented-assignment line (`count += 1`, `total -= fee`, ...).
 * Without this, lines like `count += 1` don't match any language rule
 * (the plain `name = value` regex requires `=` directly after the name)
 * and silently fall through to the vague generic fallback text — even
 * though this is one of the most common lines in beginner code (loop
 * counters, running totals). Returns null if the line isn't one of these.
 */
export function explainAugmentedAssignment(trimmed, symbolTable, scope) {
  const match = trimmed.match(/^([A-Za-z_$][\w$]*)\s*(\*\*=|\/\/=|\+=|-=|\*=|\/=|%=)\s*(.+?);?$/);
  if (!match) return null;
  const [, name, op, rawValue] = match;
  const info = AUGMENTED_OPS[op];
  if (!info) return null;

  const value = rawValue.trim();
  const known = symbolTable ? symbolTable.knownIdentifiersIn(value, scope) : [];
  const valuePhrase = known.length === 1 && value === known[0]
    ? symbolTable.describe(known[0], scope)
    : mdCode(value);

  return `${info.verb} the variable \`${name}\` ${info.prep} ${valuePhrase}.`;
}

/**
 * Explains a standalone increment/decrement line (`count++`, `--i`).
 * Same rationale as explainAugmentedAssignment above — these are
 * extremely common in C-style `for` loops and were previously falling
 * through to the generic fallback text.
 */
export function explainIncrementDecrement(trimmed) {
  const postfix = trimmed.match(/^([A-Za-z_$][\w$]*)\s*(\+\+|--)\s*;?$/);
  const prefix = !postfix && trimmed.match(/^(\+\+|--)\s*([A-Za-z_$][\w$]*)\s*;?$/);
  if (!postfix && !prefix) return null;

  const name = postfix ? postfix[1] : prefix[2];
  const op = postfix ? postfix[2] : prefix[1];
  const verb = op === "++" ? "Increases" : "Decreases";
  return `${verb} the variable \`${name}\` by 1.`;
}

/**
 * Wrap raw source text as a Markdown inline code span, safely.
 *
 * A plain single backtick wrap (`` `${value}` ``) breaks as soon as the
 * value itself contains a backtick — which happens constantly with JS/TS
 * template literals (e.g. `` `/api/users/${id}` ``). The embedded backtick
 * prematurely closes the span, so the rest renders as stray, unformatted
 * backtick characters instead of a code block.
 *
 * Standard Markdown's fix is to use a longer run of backticks as the
 * fence than the longest run found inside the content, padded with a
 * space if the content starts or ends with a backtick itself.
 */
export function mdCode(value) {
  const text = String(value);
  const runs = text.match(/`+/g) || [];
  const longestRun = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longestRun + 1);
  const needsPadding = text.startsWith("`") || text.endsWith("`");
  const body = needsPadding ? ` ${text} ` : text;
  return `${fence}${body}${fence}`;
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
