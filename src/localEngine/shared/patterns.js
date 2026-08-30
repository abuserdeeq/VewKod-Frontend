// ============================================================
// Shared patterns / helpers
// ------------------------------------------------------------
// Small pieces of logic that many language analyzers need
// (comment detection, TODO markers, hard-coded secrets, etc.)
// live here once instead of being copy-pasted into every
// analyzer file.
// ============================================================

/**
 * Builds the "Starts a counted loop: ..." explanation from an
 * already-split init/condition/increment triple. Shared by both
 * matcher variants below (parenthesized C-style vs. Go's paren-less
 * form), so the clause-describing logic only lives in one place.
 */
function describeForLoopClauses(init, condition, increment) {
  const initMatch = init.match(/^(?:let|var|const|int|long|double|float)?\s*([A-Za-z_$][\w$]*)\s*(?::=|=)\s*(.+)$/);
  const initPhrase = initMatch ? `\`${initMatch[1]}\` starts at \`${initMatch[2].trim()}\`` : (init ? `\`${init}\`` : "no initializer");

  let incPhrase;
  const incDecPost = increment.match(/^([A-Za-z_$][\w$]*)\s*(\+\+|--)$/);
  const incDecPre = increment.match(/^(\+\+|--)\s*([A-Za-z_$][\w$]*)$/);
  const incAug = increment.match(/^([A-Za-z_$][\w$]*)\s*(\+=|-=|\*=|\/=)\s*(.+)$/);
  if (incDecPost || incDecPre) {
    const name = incDecPost ? incDecPost[1] : incDecPre[2];
    const op = incDecPost ? incDecPost[2] : incDecPre[1];
    incPhrase = `${op === "++" ? "increasing" : "decreasing"} \`${name}\` by 1`;
  } else if (incAug) {
    const verb = { "+=": "increasing", "-=": "decreasing", "*=": "multiplying", "/=": "dividing" }[incAug[2]] || "updating";
    incPhrase = `${verb} \`${incAug[1]}\` by \`${incAug[3].trim()}\` each pass`;
  } else {
    incPhrase = increment ? `running \`${increment}\` each pass` : "no update step";
  }

  return `Starts a counted loop: ${initPhrase}, continues while \`${condition}\` is true, ${incPhrase}.`;
}

/**
 * Explains a classic C-style `for (init; condition; increment)` loop
 * header (JS/Java/C/C++/C#/PHP). Returns null if `trimmed` isn't this
 * shape (e.g. a for-of/for-each/for-in loop, which each language
 * analyzer already handles separately and more precisely).
 */
export function explainClassicForLoop(trimmed) {
  const header = trimmed.match(/^for\s*\(\s*(.*?)\s*;\s*(.*?)\s*;\s*(.*?)\s*\)\s*\{?$/);
  if (!header) return null;
  return describeForLoopClauses(header[1], header[2], header[3]);
}

/**
 * Same idea as explainClassicForLoop, but for Go's paren-less
 * `for init; condition; increment {` form (and its `:=` short
 * variable declarations).
 */
export function explainGoForLoop(trimmed) {
  const header = trimmed.match(/^for\s+(.*?)\s*;\s*(.*?)\s*;\s*(.*?)\s*\{?$/);
  if (!header) return null;
  return describeForLoopClauses(header[1], header[2], header[3]);
}

const COMMENT_PREFIXES = ["//", "#", "/*", "*", "<!--", "--"];

export function isCommentLine(trimmed) {
  return COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

// C, C++, and Rust all use a leading `#` for something that is NOT a
// comment: C/C++ preprocessor directives (`#include`, `#define`,
// `#ifdef`, `#pragma`, ...) and Rust attributes (`#[derive(...)]`,
// `#![allow(...)]`). Those lines have real effects on compilation, so
// treating them as inert comments (which the shared isCommentLine()
// above does, since plenty of *other* languages — Python, Bash, Ruby —
// really do use `#` for comments) produced actively wrong explanations
// and also silently skipped them during symbol-table/structure
// building. Those three analyzers import this instead.
const COMMENT_PREFIXES_NO_HASH = COMMENT_PREFIXES.filter((p) => p !== "#");

export function isCommentLineExcludingHash(trimmed) {
  return COMMENT_PREFIXES_NO_HASH.some((prefix) => trimmed.startsWith(prefix));
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

    // Keyword list intentionally mixes two anchoring styles:
    // - longer/distinctive words (password, secret, api_key, token,
    //   credential, access_key, private_key, client_secret) match as a
    //   substring, same as before, so `userPassword = "..."` still hits.
    // - short, collision-prone words (pass, pwd, passwd) are wrapped in
    //   `\b...\b` so `$pass = "..."` is flagged without also matching
    //   the tail of an unrelated identifier like `compass = "north"`.
    if (/(api[_-]?key|secret|password|token|credential|access[_-]?key|private[_-]?key|client[_-]?secret|\bpass\b|\bpwd\b|\bpasswd\b)\s*[:=]\s*["'][^"']+["']/i.test(line)) {
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

// Control-flow / declaration keywords that can be immediately followed
// by `(...)` but are NOT a function call — e.g. `if (x > 0)`,
// `catch (e: Exception)`, `while (true)`. These are always matched by
// a more specific rule earlier in each analyzer's explainLine, but are
// excluded here too as a safety net so explainBareFunctionCall() never
// double-explains (or misexplains) a control-flow header if it's ever
// reordered to run first.
const CALL_STATEMENT_STOPWORDS = new Set([
  "if", "for", "foreach", "while", "switch", "when", "catch", "try",
  "finally", "function", "fun", "def", "class", "struct", "enum",
  "return", "else", "elif", "using", "namespace", "package", "import",
  "export", "new", "delete", "do", "case", "throw", "raise", "yield",
  "unsafe", "match", "impl", "trait", "fn",
]);

/**
 * Explains a standalone function/method call statement (`greetAll(users);`,
 * `logger.info(message)`, `foo()`). Every analyzer previously left this
 * extremely common line shape unexplained — it doesn't match a
 * declaration, a loop, a conditional, or any of the other specific
 * shapes each analyzer looks for, so it fell straight through to the
 * generic "Executes a statement..." fallback regardless of language.
 *
 * Deliberately conservative: only matches a single, unnested call with
 * no operators around it (`x = foo()` and `if (foo())` are handled by
 * their own, more specific rules, which all run before this one).
 * Returns null — not a guess — for anything that doesn't fit that
 * exact shape, so it never overrides a more precise explanation.
 */
export function explainBareFunctionCall(trimmed, symbolTable, scope) {
  const match = trimmed.match(/^([A-Za-z_$][\w$]*(?:[.:]{1,2}[A-Za-z_$][\w$]*)*)\s*\(([^()]*)\)\s*[;.]?$/);
  if (!match) return null;

  const [, rawName, rawArgs] = match;
  const shortName = rawName.split(/[.:]+/).pop();
  if (CALL_STATEMENT_STOPWORDS.has(shortName) || CALL_STATEMENT_STOPWORDS.has(rawName)) return null;

  const info = symbolTable ? (symbolTable.get(rawName, scope) || symbolTable.get(shortName, scope)) : null;
  const isKnownFn = info && info.role === "function";
  const nameLabel = isKnownFn ? `the \`${rawName}()\` function` : `\`${rawName}()\``;

  const args = rawArgs.trim();
  if (!args) return `Calls ${nameLabel} without passing any arguments.`;

  const known = symbolTable ? symbolTable.knownIdentifiersIn(args, scope) : [];
  const argPhrase = known.length === 1 && args === known[0]
    ? symbolTable.describe(known[0], scope)
    : mdCode(args);

  return `Calls ${nameLabel}, passing ${argPhrase}.`;
}

/**
 * Explains a brace-delimited `try { } catch (...) { } finally { }`
 * block header — shared by the languages that use this exact shape
 * (Java, C#, PHP, Kotlin, C++). JavaScript and Python already have
 * their own version tailored to their slightly different syntax
 * (JS is brace-based like this one; Python's is colon/indent-based),
 * so they don't call this helper.
 */
export function explainBraceTryCatch(trimmed) {
  if (/^try\s*\{?$/.test(trimmed)) {
    return "Starts a `try` block; if an error/exception occurs anywhere inside it, execution jumps to the matching `catch` block below.";
  }

  const catchMatch = trimmed.match(/^\}?\s*catch\s*\(([^)]*)\)\s*\{?$/);
  if (catchMatch) {
    const inner = catchMatch[1].trim();
    if (!inner || inner === "...") {
      return "Catches any exception/error thrown in the `try` block above (a catch-all handler).";
    }
    return `Catches an exception/error here (\`${inner}\`) if one was thrown in the \`try\` block above.`;
  }
  if (/^\}?\s*catch\s*\{?$/.test(trimmed)) {
    return "Catches any exception/error thrown in the `try` block above.";
  }

  if (/^\}?\s*finally\s*\{?$/.test(trimmed)) {
    return "Starts a `finally` block, which always runs after the `try`/`catch`, whether or not an exception occurred.";
  }

  return null;
}

/**
 * A lone `{` on its own line (Allman/BSD brace style — common in C#,
 * and a frequent formatting choice in C/C++/Java/Kotlin/Swift too).
 * It carries real meaning ("a new block starts here") but matched
 * nothing in any analyzer, so every Allman-style snippet had one
 * generic-fallback line per block opener. K&R style, where `{` sits
 * at the end of a function/if/loop header line, is unaffected — this
 * only fires when the brace is completely alone on its line.
 */
export function explainLoneOpenBrace(trimmed) {
  return trimmed === "{" ? "Opens a new block of code (the matching `}` closes it)." : null;
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
