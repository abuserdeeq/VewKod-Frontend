// Run locally with: node src/localEngine/pilot/inspect-module.mjs
//
// Three guesses at web-tree-sitter@0.22.6's export shape have all
// failed. Rather than guess a fourth time, this just prints exactly
// what the module actually looks like, so the real fix is obvious
// instead of assumed.

import pkg from "web-tree-sitter";

console.log("typeof default import:", typeof pkg);
console.log("default import itself:", pkg);

// Object.keys() only shows ENUMERABLE own properties — static class
// methods (like `init`, which we already know works) are NOT
// enumerable, so Object.keys() misses them. getOwnPropertyNames()
// shows everything, enumerable or not — this is the real list.
console.log("Object.getOwnPropertyNames(pkg):", Object.getOwnPropertyNames(pkg));

// Directly probe the specific names we care about instead of relying
// on a listing that might hide them.
console.log("typeof pkg.init:", typeof pkg.init);
console.log("typeof pkg.Language:", typeof pkg.Language);
console.log("pkg.Language itself:", pkg.Language);
console.log("typeof pkg.load:", typeof pkg.load);

if (pkg.prototype) {
  console.log("Instance methods (pkg.prototype):", Object.getOwnPropertyNames(pkg.prototype));
}

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
