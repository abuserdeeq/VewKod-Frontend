// ============================================================
// TypeScript analyzer — Tree-sitter (AST) based
// ============================================================
// tree-sitter-typescript's grammar is built on top of the JavaScript
// grammar (confirmed during pilot testing: identical samples produced
// identical results for both), so this reuses javascript.js's node
// visitors wholesale via its exports, adding only TS-specific
// handling on top: interface/type-alias declarations, typed variable
// declarations (`const x: number = 5`), and flagging `any` usage.

import Parser from "web-tree-sitter";
import { findCommonIssues } from "../shared/patterns.js";
import { explainNode as jsExplainNode, checkIssues as jsCheckIssues, updateStructure as jsUpdateStructure, buildSymbols, SUPERSEDED_MESSAGES, mdCode, lineOf } from "./javascript.js";

export const id = "typescript";
export const label = "TypeScript";

const isNode = typeof process !== "undefined" && !!process.versions?.node;

const WASM_CORE_PATH = isNode
  ? "./node_modules/web-tree-sitter/tree-sitter.wasm"
  : "/wasm/tree-sitter.wasm";
const WASM_TS_PATH = isNode
  ? "./node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm"
  : "/wasm/tree-sitter-typescript.wasm";

export function detect(code) {
  return (
    /\b(interface|type)\s+\w+/.test(code) ||
    /:\s*(string|number|boolean|any|void|unknown)\b/.test(code)
  );
}

let TSLang = null;
let ready = false;

async function ensureReady() {
  if (ready) return;
  await Parser.init(isNode ? undefined : { locateFile: () => WASM_CORE_PATH });
  TSLang = await Parser.Language.load(WASM_TS_PATH);
  ready = true;
}

// TS-specific node types on top of whatever javascript.js's
// explainNode already handles for the shared JS subset.
function explainTsNode(node) {
  if (node.type === "interface_declaration") {
    const nameNode = node.childForFieldName("name");
    return `Defines the ${mdCode(nameNode ? nameNode.text : "?")} interface, describing the shape an object of this type must have.`;
  }
  if (node.type === "type_alias_declaration") {
    const nameNode = node.childForFieldName("name");
    const value = node.childForFieldName("value");
    return `Defines a type alias ${mdCode(nameNode ? nameNode.text : "?")} equal to ${mdCode(value ? value.text : "?")}.`;
  }
  return null;
}

function checkTsIssues(node, issues) {
  // `: any` anywhere a type annotation appears.
  if (node.type === "type_annotation" && node.text.includes(": any")) {
    issues.push({
      line: lineOf(node),
      type: "review",
      message: "Uses the `any` type, which turns off type checking for this value. A more specific type is usually safer.",
    });
  }
}

export async function analyzeAst(code) {
  await ensureReady();

  const parser = new Parser();
  parser.setLanguage(TSLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;

  const structure = {
    functions: [], classes: [], imports: [], variables: [],
    loops: [], conditionals: [], returns: [], outputs: [], comments: [],
  };
  const issues = findCommonIssues(code.split("\n")).filter(
    (issue) => !SUPERSEDED_MESSAGES.has(issue.message)
  );
  const lineExplanations = [];

  function walk(node, symbols) {
    jsUpdateStructure(node, structure);
    if (node.type === "interface_declaration" || node.type === "type_alias_declaration") {
      const nameNode = node.childForFieldName("name");
      structure.classes.push({ line: lineOf(node), name: nameNode ? nameNode.text : "?" });
    }

    jsCheckIssues(node, issues);
    checkTsIssues(node, issues);

    if (node.type === "function_declaration") {
      const explanation = jsExplainNode(node, symbols) || explainTsNode(node);
      if (explanation) lineExplanations.push({ line: lineOf(node), text: explanation });
      const body = node.childForFieldName("body");
      const localSymbols = buildSymbols(body);
      for (const child of node.namedChildren) walk(child, localSymbols);
      return;
    }

    const explanation = explainTsNode(node) || jsExplainNode(node, symbols);
    if (explanation) {
      lineExplanations.push({ line: lineOf(node), text: explanation });
    }

    for (const child of node.namedChildren) walk(child, symbols);
  }

  walk(root, buildSymbols(root));

  lineExplanations.sort((a, b) => a.line - b.line);

  return { structure, issues, lineExplanations };
}
