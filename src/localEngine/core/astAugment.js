// ============================================================
// AST augmentation — bolts tree-sitter-verified data onto the
// output of the existing (proven, fully tested) regex analyzers.
// ------------------------------------------------------------
// This is deliberately additive, never destructive:
//   - functions/classes: replaced with the AST-derived list ONLY
//     if the AST actually found at least one — a parse that finds
//     nothing (wrong node-type name, grammar mismatch, etc.) just
//     leaves the regex analyzer's own list untouched.
//   - issues: AST-derived issues are ADDED to the regex analyzer's
//     issues (deduped by line+type so the two can't double-report
//     the same problem), never removed.
//
// If the language has no AST config, or its grammar isn't warm yet,
// or parsing throws, this is a complete no-op and callers get
// exactly what the regex analyzer produced — identical to the
// engine's behavior before this file existed.
// ============================================================

import { getParsedTree } from "./treeSitterEngine.js";
import { AST_CONFIGS } from "./astConfigs.js";
import { extractFunctionsAndClasses, extractIssues } from "./astWalk.js";

function dedupeIssues(existing, incoming) {
  const seen = new Set(existing.map((i) => `${i.line}:${i.type}`));
  const merged = [...existing];
  for (const issue of incoming) {
    const key = `${issue.line}:${issue.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(issue);
    }
  }
  return merged.sort((a, b) => a.line - b.line);
}

/**
 * Augments `structure`/`issues` (already produced by a regex
 * analyzer) with tree-sitter-verified data for `languageId`, if that
 * language's grammar has finished loading. Always returns a valid
 * {structure, issues} pair — falls back to the inputs unchanged
 * whenever AST data isn't available for any reason.
 */
export function augmentWithAst(languageId, code, structure, issues) {
  const config = AST_CONFIGS[languageId];
  if (!config) return { structure, issues };

  const root = getParsedTree(languageId, code);
  if (!root) return { structure, issues };

  try {
    const { functions, classes } = extractFunctionsAndClasses(root, config);
    const astIssues = extractIssues(root, config);

    return {
      structure: {
        ...structure,
        functions: functions.length ? functions : structure.functions,
        classes: classes.length ? classes : structure.classes,
      },
      issues: dedupeIssues(issues, astIssues),
    };
  } catch (err) {
    console.warn(`[astAugment] failed for "${languageId}", using regex-only result:`, err?.message || err);
    return { structure, issues };
  }
}
