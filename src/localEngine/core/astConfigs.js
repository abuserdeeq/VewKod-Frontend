// ============================================================
// Per-language AST node-type tables
// ------------------------------------------------------------
// Node type names for each grammar, used by astAugment.js to walk
// a tree-sitter tree generically instead of writing 13 separate
// hand-rolled walkers. Only languages listed in
// treeSitterEngine.js's WASM_FILENAMES can ever actually reach this
// (no grammar loaded => no tree => astAugment.js is a no-op), so an
// entry existing here for a language whose .wasm isn't bundled is
// harmless dead config, not a bug.
//
// These names come from each grammar's published node-types.json /
// grammar.js. They have NOT been runtime-verified the way Python's
// were in the pilot (this container has no network access to
// install and test them — see pilot/pythonTreeSitter.js's own
// setup notes for the same limitation). If a name is wrong for the
// installed grammar version, the practical effect is just that the
// specific construct it was meant to catch (e.g. Java's for-loops)
// silently isn't picked up for that language — the analyzer's
// existing regex-based structure/issues for that language are used
// as-is either way, since astAugment.js only ever *adds* to them.
// Please run the multi-language pilot workflow after this lands and
// report back anything that looks off, the same way the Python path
// itself got corrected in one round-trip.
// ============================================================

export const AST_CONFIGS = {
  python: {
    functionTypes: ["function_definition"],
    classTypes: ["class_definition"],
    blockType: "block",
    returnTypes: ["return_statement"],
    catchTypes: ["except_clause"],
    catchBodyField: null, // except_clause's block is a plain named child, not a field
    emptyBodyStatementTypes: ["pass_statement"],
    nameField: "name",
    paramsField: "parameters",
  },
  javascript: {
    functionTypes: ["function_declaration", "method_definition"],
    classTypes: ["class_declaration"],
    blockType: "statement_block",
    returnTypes: ["return_statement"],
    catchTypes: ["catch_clause"],
    catchBodyField: "body",
    emptyBodyStatementTypes: [],
    nameField: "name",
    paramsField: "parameters",
  },
  typescript: {
    functionTypes: ["function_declaration", "method_definition"],
    classTypes: ["class_declaration"],
    blockType: "statement_block",
    returnTypes: ["return_statement"],
    catchTypes: ["catch_clause"],
    catchBodyField: "body",
    emptyBodyStatementTypes: [],
    nameField: "name",
    paramsField: "parameters",
  },
  java: {
    functionTypes: ["method_declaration"],
    classTypes: ["class_declaration"],
    blockType: "block",
    returnTypes: ["return_statement"],
    catchTypes: ["catch_clause"],
    catchBodyField: "body",
    emptyBodyStatementTypes: [],
    nameField: "name",
    paramsField: "parameters",
  },
  c: {
    functionTypes: ["function_definition"],
    classTypes: [],
    blockType: "compound_statement",
    returnTypes: ["return_statement"],
    catchTypes: [],
    catchBodyField: null,
    emptyBodyStatementTypes: [],
    // The function name/params aren't directly on function_definition
    // — they're nested inside its `declarator` field (a
    // function_declarator, possibly wrapped in a pointer_declarator
    // for pointer return types). See astWalk.js's
    // resolveDeclaratorNode() for how this descends to find them.
    declaratorField: "declarator",
    nameField: "declarator",
    paramsField: "parameters",
  },
  cpp: {
    functionTypes: ["function_definition"],
    classTypes: ["class_specifier", "struct_specifier"],
    blockType: "compound_statement",
    returnTypes: ["return_statement"],
    catchTypes: ["catch_clause"],
    catchBodyField: null,
    emptyBodyStatementTypes: [],
    declaratorField: "declarator",
    nameField: "declarator",
    paramsField: "parameters",
  },
  csharp: {
    functionTypes: ["method_declaration"],
    classTypes: ["class_declaration"],
    blockType: "block",
    returnTypes: ["return_statement"],
    catchTypes: ["catch_clause"],
    catchBodyField: "body",
    emptyBodyStatementTypes: [],
    nameField: "name",
    paramsField: "parameters",
  },
  go: {
    functionTypes: ["function_declaration", "method_declaration"],
    classTypes: ["type_declaration"],
    blockType: "block",
    returnTypes: ["return_statement"],
    catchTypes: [], // Go has no try/catch
    catchBodyField: null,
    emptyBodyStatementTypes: [],
    nameField: "name",
    paramsField: "parameters",
  },
  rust: {
    functionTypes: ["function_item"],
    classTypes: ["struct_item", "impl_item"],
    blockType: "block",
    returnTypes: ["return_expression"],
    catchTypes: [], // Rust has no try/catch
    catchBodyField: null,
    emptyBodyStatementTypes: [],
    nameField: "name",
    paramsField: "parameters",
  },
  php: {
    functionTypes: ["function_definition", "method_declaration"],
    classTypes: ["class_declaration"],
    blockType: "compound_statement",
    returnTypes: ["return_statement"],
    catchTypes: ["catch_clause"],
    catchBodyField: null,
    emptyBodyStatementTypes: [],
    nameField: "name",
    paramsField: "parameters",
  },
  bash: {
    functionTypes: ["function_definition"],
    classTypes: [],
    blockType: "compound_statement",
    returnTypes: ["return_statement", "return_command"],
    catchTypes: [],
    catchBodyField: null,
    emptyBodyStatementTypes: [],
    nameField: "name",
    paramsField: null,
  },
};
