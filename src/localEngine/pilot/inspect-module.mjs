// Run locally with: node src/localEngine/pilot/inspect-module.mjs
//
// Three guesses at web-tree-sitter@0.22.6's export shape have all
// failed. Rather than guess a fourth time, this just prints exactly
// what the module actually looks like, so the real fix is obvious
// instead of assumed.

import pkg from "web-tree-sitter";

console.log("typeof default import:", typeof pkg);
console.log("default import itself:", pkg);
console.log("Object.keys(pkg):", Object.keys(pkg || {}));

try {
  const ns = await import("web-tree-sitter");
  console.log("\nFull namespace object keys:", Object.keys(ns));
  console.log("ns.default === pkg ?", ns.default === pkg);
  for (const key of Object.keys(ns)) {
    console.log(`  typeof ns.${key}:`, typeof ns[key]);
  }
} catch (err) {
  console.error("Namespace import failed:", err.message);
}
