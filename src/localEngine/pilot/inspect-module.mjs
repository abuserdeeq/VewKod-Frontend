// Run locally with: node src/localEngine/pilot/inspect-module.mjs
//
// Three guesses at web-tree-sitter@0.22.6's export shape have all
// failed. Rather than guess a fourth time, this just prints exactly
// what the module actually looks like, so the real fix is obvious
// instead of assumed.

import pkg from "web-tree-sitter";

console.log("typeof default import:", typeof pkg);
console.log("default import itself:", pkg);

// --- BEFORE Parser.init() ---
console.log("\n--- BEFORE init() ---");
console.log("Object.getOwnPropertyNames(pkg):", Object.getOwnPropertyNames(pkg));
console.log("typeof pkg.Language:", typeof pkg.Language);
if (pkg.prototype) {
  console.log("Instance methods (pkg.prototype):", Object.getOwnPropertyNames(pkg.prototype));
}

// --- Call init(), then check again ---
// Hypothesis: the WASM/Emscripten runtime patches in more of the API
// (Language, parse, setLanguage, etc.) only after init() finishes —
// so inspecting before init() may simply be too early to see them.
console.log("\nCalling pkg.init()...");
await pkg.init();
console.log("pkg.init() resolved.");

console.log("\n--- AFTER init() ---");
console.log("Object.getOwnPropertyNames(pkg):", Object.getOwnPropertyNames(pkg));
console.log("typeof pkg.Language:", typeof pkg.Language);
console.log("pkg.Language itself:", pkg.Language);
if (pkg.Language) {
  console.log("Object.getOwnPropertyNames(pkg.Language):", Object.getOwnPropertyNames(pkg.Language));
}
if (pkg.prototype) {
  console.log("Instance methods (pkg.prototype):", Object.getOwnPropertyNames(pkg.prototype));
}

// Also check a live instance, in case the loading method lives there
// instead of on the class.
const instance = new pkg();
console.log("\nInstance own properties:", Object.getOwnPropertyNames(instance));
console.log("typeof instance.setLanguage:", typeof instance.setLanguage);
console.log("typeof instance.parse:", typeof instance.parse);
