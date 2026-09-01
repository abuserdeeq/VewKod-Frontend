// Run: node src/localEngine/pilot/inspect-ast.mjs
//
// Reusable diagnostic: parses a sample with any language grammar and
// prints every distinct node type it finds, plus (for function-like
// and class-like nodes) their actual field names. Use this instead
// of guessing node type names for a new language — it's much faster
// than a debug-fix-rerun loop per guess.

import Parser from "web-tree-sitter";

async function inspectLanguage(label, wasmPath, sourceCode) {
  console.log(`\n\n########## ${label} — AST NODE TYPES ##########`);

  await Parser.init();
  const Lang = await Parser.Language.load(wasmPath);
  const parser = new Parser();
  parser.setLanguage(Lang);
  const tree = parser.parse(sourceCode);

  const allTypes = new Set();
  const fieldsByType = {};

  function walk(node) {
    allTypes.add(node.type);

    // For any node whose name suggests it's function/class/catch/
    // return-related, print its field names and children types so
    // the right field/child to read is obvious.
    if (/function|method|class|catch|return|jump|control_transfer/i.test(node.type)) {
      if (!fieldsByType[node.type]) {
        const childInfo = node.namedChildren.map((c) => c.type);
        fieldsByType[node.type] = childInfo;
      }
    }

    for (const child of node.namedChildren) walk(child);
  }

  walk(tree.rootNode);

  console.log("All distinct node types found:", [...allTypes].sort());
  console.log("\nRelevant node types with their named-children types:");
  for (const [type, children] of Object.entries(fieldsByType)) {
    console.log(`  ${type}: children = [${children.join(", ")}]`);
  }
}

const wasmDir = "./node_modules/tree-sitter-wasms/out";

await inspectLanguage(
  "KOTLIN",
  `${wasmDir}/tree-sitter-kotlin.wasm`,
  `fun calculateFee(amount: Double, count: Int): Double {
    if (count > 0) {
        return amount / count
        println("This will never run")
    }
    return amount / 0
}

fun processOrder(order: Order): Boolean {
    try {
        return chargeCard(order)
    } catch (e: Exception) {
    }
    return false
}
`
);

await inspectLanguage(
  "SWIFT",
  `${wasmDir}/tree-sitter-swift.wasm`,
  `func calculateFee(amount: Double, count: Int) -> Double {
    if count > 0 {
        return amount / Double(count)
        print("This will never run")
    }
    return amount / 0
}

func processOrder(order: Order) -> Bool {
    do {
        return try chargeCard(order)
    } catch {
    }
}
`
);
