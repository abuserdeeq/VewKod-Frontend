// Run: node src/localEngine/pilot/inspect-ast.mjs
//
// Reusable diagnostic: parses a sample with any language grammar and
// prints every distinct node type it finds, plus (for function-like,
// class-like, catch/return, loop, conditional, declaration, and call
// nodes) their actual field names and named-children types. Use this
// instead of guessing node type names for a new language — it's much
// faster than a debug-fix-rerun loop per guess.
//
// Kotlin and Swift samples below were extended when kotlin.js/swift.js
// graduated from pilot/ to analyzers/ (Sept 2026) — that migration was
// done WITHOUT the ability to run this script (no network access to
// npm-install web-tree-sitter/tree-sitter-wasms in that session), so
// several node-type names in the new analyzers are unverified guesses,
// flagged inline there. Run this first and compare against those
// analyzers' `case "..."` labels and `.find((c) => c.type === "...")`
// checks before trusting them in production.

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

// ------------------------------------------------------------
// SQL — the last remaining regex-based analyzer (src/localEngine/
// analyzers/sql.js). Unlike Kotlin/Swift/Bash, there is NO prior pilot
// work for SQL at all: it's unconfirmed whether tree-sitter-wasms even
// bundles a SQL grammar, so this is wrapped in a try/catch rather than
// assumed to exist. If it fails, that answers the "can we even do
// this" question before any production code gets written against
// node types that were never verified to exist.
try {
  await inspectLanguage(
    "SQL",
    `${wasmDir}/tree-sitter-sql.wasm`,
    `-- fetch each customer's order total
WITH order_totals AS (
    SELECT customer_id, SUM(amount) AS total
    FROM orders
    GROUP BY customer_id
    HAVING SUM(amount) > 0
)
SELECT c.name, o.total
FROM customers c
LEFT JOIN order_totals o ON c.id = o.customer_id
WHERE c.active = 1
ORDER BY o.total DESC;

INSERT INTO logs (message) VALUES ('done');

UPDATE customers SET active = 0 WHERE id = 5;
`
  );
} catch (err) {
  console.log("\n\n########## SQL — FAILED TO LOAD ##########");
  console.log("No tree-sitter-sql.wasm found (or it failed to parse) — message:", err && err.message);
  console.log("This means SQL either needs a different package/grammar name, or can't be migrated the same way as the other languages.");
}
