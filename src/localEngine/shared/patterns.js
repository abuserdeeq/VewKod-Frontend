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
