// Run: node src/localEngine/pilot/inspect-ast.mjs
//
// Reusable diagnostic: parses a sample with any language grammar and
// prints every distinct node type it finds, plus (for function-like,
// class-like, catch/return, loop, conditional, declaration, and call
// nodes) their actual field names and named-children types. Use this
// instead of guessing node type names for a new language — it's much
// faster than a debug-fix-rerun loop per guess.
//
// STATUS (Sept 2026): every language analyzer under analyzers/ has
// graduated onto Tree-sitter except SQL, which stays on the old
// regex/indentation analyzer permanently — tree-sitter-wasms@0.1.11
// doesn't ship a SQL grammar at all (confirmed: loading
// tree-sitter-sql.wasm fails with ENOENT), so there is nothing left
// to inspect there. See the header comment in analyzers/sql.js.
//
// What's still open: kotlin.js and swift.js each have inline
// "CONFIDENCE NOTES" flagging specific node shapes that were
// extrapolated from grammar docs rather than actually confirmed
// (Kotlin: property_declaration, when_expression, call_expression
// shape, import_header. Swift: struct/enum/protocol/extension
// declarations, guard/if-let, nil-coalescing, force-unwrap) — that
// migration was done without the ability to run this script (no
// network access in that session). Run this first and compare
// against those analyzers' `case "..."` labels and
// `.find((c) => c.type === "...")` checks before fully trusting them.

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

    if (/function|method|class|struct|enum|protocol|catch|return|jump|control_transfer|property|variable|declaration|for|while|if|guard|when|switch|call|import/i.test(node.type)) {
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
  `import kotlin.math.max

data class Order(val id: String, val amount: Double)

fun calculateFee(amount: Double, count: Int): Double {
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
    } finally {
        println("done")
    }
    return false
}

fun printAll(items: List<String>) {
    for (item in items) {
        println(item)
    }
    var total = 0
    total += 1
    val risky = total!!
    when (total) {
        0 -> println("zero")
        else -> println("nonzero")
    }
}
`
);

await inspectLanguage(
  "SWIFT",
  `${wasmDir}/tree-sitter-swift.wasm`,
  `import Foundation

struct Order {
    let id: String
}

func calculateFee(amount: Double, count: Int) -> Double {
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

func find(id: String) -> Order? { return nil }

func f() {
    guard let record = find(id: "1") else {
        return
    }
    if let name = record.id as String? {
        print(name)
    }
    let age = record.id.count ?? 0
    let forced = record.id as! String
    for item in [1, 2, 3] {
        print(item)
    }
    switch age {
    case 0: print("zero")
    default: print("nonzero")
    }
}
`
);
