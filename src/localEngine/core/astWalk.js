// ============================================================
// Pure, environment-agnostic AST walking logic.
// ------------------------------------------------------------
// Takes a tree-sitter root node + an AST_CONFIGS entry (see
// astConfigs.js) and extracts functions/classes/issues. Has no
// knowledge of *how* the tree was obtained — astAugment.js feeds it
// a tree loaded in the browser (via treeSitterEngine.js), and
// scripts/verify-ast-configs.mjs feeds it a tree loaded directly
// from node_modules in a plain `node` process, so the exact same
// node-type mappings get exercised in CI (from a phone, no local
// terminal needed — see the "AST Config Verification" workflow)
// before ever running in the app.
// ============================================================

function nodeText(node) {
  return node ? node.text : "?";
}

// C/C++ (and grammars with a similar declarator style) don't expose
// the function name/params directly on the function_definition node
// — they sit one or more levels down inside a nested declarator
// (e.g. `int check(int x)` -> declarator: function_declarator ->
// declarator: identifier "check", parameters: parameter_list; a
// pointer return type like `int* check(...)` adds an extra
// pointer_declarator layer in between). Config opts into this via
// `declaratorField`: descend through that field, one level at a
// time, until landing on a node that actually has a `paramsField`
// child (i.e. the real function_declarator), or give up after a few
// hops and fall back to the outermost node.
function resolveDeclaratorNode(node, config) {
  if (!config.declaratorField) return node;
  let current = node.childForFieldName(config.declaratorField);
  let guard = 0;
  while (current && config.paramsField && !current.childForFieldName(config.paramsField) && guard < 4) {
    const next = current.childForFieldName(config.declaratorField);
    if (!next) break;
    current = next;
    guard++;
  }
  return current || node;
}

export function extractFunctionsAndClasses(root, config) {
  const functions = [];
  const classes = [];

  function walk(node) {
    if (config.functionTypes.includes(node.type)) {
      const target = resolveDeclaratorNode(node, config);
      const nameNode = config.nameField ? target.childForFieldName(config.nameField) : null;
      const paramsNode = config.paramsField ? target.childForFieldName(config.paramsField) : null;
      functions.push({
        name: nameNode ? nodeText(nameNode).replace(/^\*/, "") : "?",
        line: node.startPosition.row + 1,
        parameters: paramsNode ? nodeText(paramsNode).replace(/^\(|\)$/g, "") : "",
      });
    }
    if (config.classTypes.includes(node.type)) {
      const nameNode = node.childForFieldName("name") || node.childForFieldName("declarator");
      classes.push({
        name: nameNode ? nodeText(nameNode) : "?",
        line: node.startPosition.row + 1,
      });
    }
    for (const child of node.namedChildren) walk(child);
  }
  walk(root);
  return { functions, classes };
}

export function extractIssues(root, config) {
  const issues = [];

  function walk(node) {
    if (config.returnTypes.includes(node.type)) {
      const next = node.nextNamedSibling;
      if (next && next.type !== "comment" && next.type !== "line_comment" && next.type !== "block_comment") {
        issues.push({
          line: next.startPosition.row + 1,
          type: "warning",
          message: "This line comes right after a `return` in the same block, so it can never be reached.",
        });
      }
    }

    if (config.catchTypes.includes(node.type)) {
      const body = config.catchBodyField
        ? node.childForFieldName(config.catchBodyField)
        : node.namedChildren.find((c) => c.type === config.blockType);

      if (body) {
        const isEmpty =
          body.namedChildCount === 0 ||
          (body.namedChildCount === 1 && config.emptyBodyStatementTypes.includes(body.namedChild(0).type));
        if (isEmpty) {
          issues.push({
            line: node.startPosition.row + 1,
            type: "review",
            message: "This error handler is empty — the exception is silently swallowed. Consider at least logging it, even if no other action is needed.",
          });
        }
      }
    }

    for (const child of node.namedChildren) walk(child);
  }
  walk(root);
  return issues;
}
