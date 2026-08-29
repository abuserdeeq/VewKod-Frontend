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

    // eval() / dynamic code execution — meaningful across JS/PHP/Python/etc.
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
 * Splits `text` on commas that sit at bracket-depth 0 — i.e. commas
 * that aren't inside `(...)`, `[...]`, or `{...}`. Used for parallel
 * assignment (`a, b = b, a`) and comprehension targets, where a naive
 * `text.split(",")` would incorrectly break apart a function call's
 * argument list or a literal.
 */
export function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Explains parallel/multiple assignment (`a, b = b, a`, `x, y = 1, 2`,
 * `a, b = divmod(x, y)`). Without this, a line with more than one
 * target on the left falls straight through to the generic fallback,
 * since the single-name assignment regex requires exactly one
 * identifier before `=`. Returns null if `trimmed` isn't this shape.
 */
export function explainMultipleAssignment(trimmed) {
  const match = trimmed.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*=\s*(?!=)(.+?);?$/);
  if (!match) return null;

  const targets = match[1].split(",").map((t) => t.trim());
  const valuesRaw = match[2].trim();
  const values = splitTopLevel(valuesRaw);

  if (values.length === targets.length) {
    // Classic swap idiom: `a, b = b, a`
    if (targets.length === 2 && values[0] === targets[1] && values[1] === targets[0]) {
      return `Swaps the values of \`${targets[0]}\` and \`${targets[1]}\` using parallel assignment (both sides are evaluated before either variable is updated).`;
    }
    const pairs = targets.map((t, i) => `\`${t}\` becomes ${mdCode(values[i])}`).join(", ");
    return `Assigns several variables at once (parallel assignment): ${pairs}.`;
  }

  return `Unpacks ${mdCode(valuesRaw)} into ${targets.map((t) => `\`${t}\``).join(", ")} in a single line.`;
}

/**
 * Explains a C-style ternary/conditional expression used as an assigned
 * value (`status = age >= 18 ? "adult" : "minor"`). Without this, the
 * whole right-hand side just gets wrapped in a single code span with no
 * indication that it branches. Returns null if `value` isn't this shape.
 * (Uses first-`?` / last-`:` splitting rather than a full parser, so it
 * can be fooled by nested ternaries or stray `?`/`:` inside strings —
 * acceptable for a lightweight, regex-based local engine.)
 */
export function explainTernary(name, value) {
  const v = value.trim();
  const qIndex = v.indexOf("?");
  if (qIndex === -1) return null;

  const condition = v.slice(0, qIndex).trim();
  const rest = v.slice(qIndex + 1);
  const colonIndex = rest.lastIndexOf(":");
  if (colonIndex === -1) return null;

  const whenTrue = rest.slice(0, colonIndex).trim();
  const whenFalse = rest.slice(colonIndex + 1).trim();
  if (!condition || !whenTrue || !whenFalse) return null;

  return `Assigns \`${name}\` to ${mdCode(whenTrue)} if ${mdCode(condition)} is true, otherwise ${mdCode(whenFalse)} — a conditional (ternary) expression.`;
}

/**
 * Explains a Python list/set/dict comprehension used as an assigned
 * value (`squares = [x*2 for x in nums]`). Without this, comprehensions
 * just get the generic "Creates the list `squares` containing ..."
 * treatment, which doesn't call out the for/if structure driving them.
 * Returns null if `value` isn't a comprehension.
 */
export function explainComprehension(name, value) {
  const v = value.trim();

  // Dict comprehension: {key: value for target in iterable [if cond]}
  // Checked first so a colon in the head doesn't get misread as a set.
  const dict = v.match(/^\{(.+?):(.+?)\s+for\s+(.+?)\s+in\s+(.+?)(?:\s+if\s+(.+))?\}$/s);
  if (dict) {
    const [, key, val, target, iterable, cond] = dict;
    const condPart = cond ? ` (only when \`${cond.trim()}\` is true)` : "";
    return `Creates the dictionary \`${name}\` by mapping \`${key.trim()}\` to \`${val.trim()}\` for each \`${target.trim()}\` in \`${iterable.trim()}\`${condPart} — a dict comprehension.`;
  }

  // List or set comprehension: [expr for target in iterable if cond] / {expr for ...}
  const listOrSet = v.match(/^([[{])(.+?)\s+for\s+(.+?)\s+in\s+(.+?)(?:\s+if\s+(.+))?([\]}])$/s);
  if (listOrSet) {
    const [, open, expr, target, iterable, cond, close] = listOrSet;
    const isList = open === "[" && close === "]";
    const isSet = open === "{" && close === "}";
    if (isList || isSet) {
      const kind = isList ? "list" : "set";
      const condPart = cond ? ` (only when \`${cond.trim()}\` is true)` : "";
      return `Creates the ${kind} \`${name}\` by evaluating \`${expr.trim()}\` for each \`${target.trim()}\` in \`${iterable.trim()}\`${condPart} — a ${kind} comprehension.`;
    }
  }

  return null;
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
//   "none" — no function scoping needed (SQL/Bash)
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

  return scopeOfLine;
}
