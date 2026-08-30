import { isCommentLine, commentExplanation, findCommonIssues, genericFallbackExplanation, explainAugmentedAssignment, explainIncrementDecrement, explainTernary, explainClassicForLoop } from "../shared/patterns.js";

export const id = "php";
export const label = "PHP";

// Function-level scoping (see shared/patterns.js computeLineScopes):
// PHP function bodies are brace-delimited.
export const scopeStyle = "brace";
export const functionStartRegex = /^function\s+([A-Za-z_]\w*)/;

function article(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

// PHP identifiers are stored in the shared symbol table without their
// `$` sigil (so lookups work like every other language), but PHP code
// should always be *displayed* with `$` — this rebuilds that phrasing.
function phpDescribe(name, symbolTable, scope = "global") {
  const info = symbolTable.get(name, scope);
  if (!info) return `\`$${name}\``;

  switch (info.role) {
    case "loop-item": {
      const ofType = info.ofType;
      return `the current item (\`$${name}\`) from ${info.of ? `\`$${info.of}\`` : "the array being looped over"}${ofType ? ` (${article(ofType)} ${ofType})` : ""}`;
    }
    case "list":
      return `the \`$${name}\` array`;
    case "dict":
      return `the \`$${name}\` associative array`;
    default:
      return `\`$${name}\``;
  }
}

export function detect(code) {
  // Require the PHP tag, or a PHP-style function signature with a
  // $-prefixed parameter — this avoids colliding with Bash, which
  // also uses `$var` + `echo` but never `function foo($x)`.
  return /<\?php/.test(code) || /function\s+\w+\s*\(\s*\$/.test(code);
}

function literalRole(value) {
  const v = value.trim().replace(/;$/, "");
  if (/^\[.*\]$/s.test(v) || /^array\s*\(/.test(v)) return "list";
  if (/^["'].*["']$/.test(v)) return "string";
  if (/^(true|false)$/i.test(v)) return "boolean";
  if (/^-?\d+(\.\d+)?$/.test(v)) return "number";
  return "variable";
}

export function buildSymbolTable(lines, symbolTable, lineScopes = []) {
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || isCommentLine(line)) return;

    const scope = lineScopes[index] || "global";

    const fn = line.match(/^function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) {
      symbolTable.add(fn[1], "function", { parameters: fn[2].trim() }, scope);
      const fnScope = `${scope}>${fn[1]}#${index}`;
      (fn[2].match(/\$[A-Za-z_]\w*/g) || []).forEach((p) => symbolTable.add(p.slice(1), "parameter", {}, fnScope));
    }

    const cls = line.match(/\bclass\s+([A-Za-z_]\w*)/);
    if (cls) symbolTable.add(cls[1], "class", {}, scope);

    const decl = line.match(/^\$([A-Za-z_]\w*)\s*=\s*(.+);/);
    if (decl) symbolTable.add(decl[1], literalRole(decl[2]), {}, scope);

    // foreach ($items as $item)
    const forEach = line.match(/^foreach\s*\(\s*\$([A-Za-z_]\w*)\s+as\s+\$([A-Za-z_]\w*)\s*\)/);
    if (forEach) {
      const info = symbolTable.get(forEach[1], scope);
      symbolTable.add(forEach[2], "loop-item", { of: forEach[1], ofType: info ? info.role : "array" }, scope);
    }
  });

  return symbolTable;
}

export function analyzeStructure(lines) {
  const result = { functions: [], classes: [], imports: [], variables: [], loops: [], conditionals: [], returns: [], outputs: [], comments: [] };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) return;
    if (isCommentLine(line)) result.comments.push(lineNumber);
    if (/^(require|include)(_once)?\b/.test(line)) result.imports.push(lineNumber);

    const fn = line.match(/^function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) result.functions.push({ line: lineNumber, name: fn[1], parameters: fn[2] });

    const cls = line.match(/\bclass\s+([A-Za-z_]\w*)/);
    if (cls) result.classes.push({ line: lineNumber, name: cls[1] });

    const decl = line.match(/^\$([A-Za-z_]\w*)\s*=/);
    if (decl) result.variables.push({ line: lineNumber, name: `$${decl[1]}` });

    if (/^(for|while|foreach)\s*\(/.test(line)) result.loops.push(lineNumber);
    if (/^if\s*\(/.test(line) || /^else\b/.test(line)) result.conditionals.push(lineNumber);
    if (/^return\b/.test(line)) result.returns.push(lineNumber);
    if (/\becho\b/.test(line) || /\bprint\s*\(/.test(line)) result.outputs.push(lineNumber);
  });

  return result;
}

export function explainLine(rawLine, symbolTable, scope = "global") {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();
  if (trimmed === "<?php" || trimmed === "?>") return "Marks the boundary of a PHP code block.";

  if (/^(require|include)(_once)?\b/.test(trimmed)) return "Includes another PHP file so its code/definitions become available here.";

  const cls = trimmed.match(/\bclass\s+([A-Za-z_]\w*)/);
  if (cls) return `Defines the class \`${cls[1]}\`, which can serve as a blueprint for creating objects.`;

  const fn = trimmed.match(/^function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
  if (fn) {
    return fn[2].trim()
      ? `Defines the function \`${fn[1]}\`, which accepts \`${fn[2].trim()}\` as parameter(s).`
      : `Defines the function \`${fn[1]}\` without parameters.`;
  }

  const forEach = trimmed.match(/^foreach\s*\(\s*\$([A-Za-z_]\w*)\s+as\s+\$([A-Za-z_]\w*)\s*\)/);
  if (forEach) {
    const info = symbolTable.get(forEach[1], scope);
    const phrase = info && info.role === "list" ? `the \`$${forEach[1]}\` array` : `\`$${forEach[1]}\``;
    return `Iterates over ${phrase}; on each pass, \`$${forEach[2]}\` represents the current item.`;
  }
  if (/^for\s*\(/.test(trimmed)) return explainClassicForLoop(trimmed) || "Starts a counted loop that repeats a block of code a set number of times.";
  if (/^while\s*\(/.test(trimmed)) return "Starts a while loop that keeps running while its condition stays true.";

  const ifMatch = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
  if (ifMatch) {
    const condition = ifMatch[1].trim();
    const known = symbolTable.knownIdentifiersIn(condition.replace(/\$/g, ""), scope);
    if (known.length === 1 && condition.replace(/\$/g, "") === known[0]) return `Checks whether ${phpDescribe(known[0], symbolTable, scope)} is truthy before running the code that follows.`;
    return `Checks whether \`${condition}\` is true before running the code that follows.`;
  }
  if (/^\}?\s*else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";

  const ret = trimmed.match(/^return\b\s*(.*?);?$/);
  if (ret) return ret[1].trim() ? `Returns \`${ret[1].trim()}\` from the current function.` : "Returns control from the current function.";

  const echo = trimmed.match(/^echo\s+(.+?);?$/);
  if (echo) return `Outputs \`${echo[1].trim()}\` to the page/console.`;

  const decl = trimmed.match(/^\$([A-Za-z_]\w*)\s*=\s*(.+);/);
  if (decl) {
    const info = symbolTable.get(decl[1], scope);
    const ternary = explainTernary(`$${decl[1]}`, decl[2]);
    if (ternary) return ternary;
    if (info && info.role === "list") return `Creates the array \`$${decl[1]}\` containing \`${decl[2]}\`.`;
    return `Assigns \`${decl[2]}\` to the variable \`$${decl[1]}\`.`;
  }

  const call = trimmed.match(/^([A-Za-z_]\w*)\s*\((.*)\)\s*;?$/);
  if (call) {
    const info = symbolTable.get(call[1], scope);
    const label = info && info.role === "function" ? `the \`${call[1]}()\` function defined above` : `\`${call[1]}()\``;
    return call[2].trim() ? `Calls ${label} with the provided argument(s).` : `Calls ${label} without arguments.`;
  }

  if (["}"].includes(trimmed)) return "Closes the current code block.";

  const incDec = explainIncrementDecrement(trimmed);
  if (incDec) return incDec;

  const augmented = explainAugmentedAssignment(trimmed, symbolTable, scope);
  if (augmented) return augmented;

  return genericFallbackExplanation();
}

export function findIssues(lines) {
  const issues = findCommonIssues(lines);

  // Lightweight one-hop taint tracking: a variable assigned directly
  // from a superglobal (and not sanitized on that same line) is
  // "tainted" until further notice — this catches the very common
  // `$name = $_GET['x']; ... echo $name;` split-across-lines pattern
  // that a same-line-only regex would miss.
  const taintedVars = new Set();
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    const taintedAssign = line.match(/^\$(\w+)\s*=\s*\$_(?:GET|POST|REQUEST|COOKIE)\s*\[/);
    if (taintedAssign && !/\b(htmlspecialchars|intval|\(int\)|filter_var)\s*\(/.test(line)) {
      taintedVars.add(taintedAssign[1]);
    }
  });

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (/[^=!]==[^=]/.test(line)) {
      issues.push({ line: index + 1, type: "review", message: "Uses `==` for comparison. `===` avoids PHP's loose type coercion and is usually safer." });
    }
    if (/\bmysql_query\s*\(/.test(line)) {
      issues.push({ line: index + 1, type: "security", message: "The `mysql_*` extension is removed from modern PHP and was prone to SQL injection. Use PDO or mysqli with prepared statements." });
    }

    // echo/print of a superglobal directly, straight into the
    // response body without escaping — reflected XSS.
    if (/^(echo|print)\b/.test(line) && /\$_(GET|POST|REQUEST|COOKIE)\b/.test(line) && !/\bhtmlspecialchars\s*\(/.test(line)) {
      issues.push({ line: index + 1, type: "security", message: "Echoes a superglobal (`$_GET`/`$_POST`/etc.) directly without escaping — a reflected XSS risk. Wrap it in `htmlspecialchars()` before output." });
    } else {
      // echo/print of a variable that was tainted by a superglobal
      // assignment earlier in the snippet (and never sanitized).
      const echoVar = line.match(/^(?:echo|print)\b\s*\$(\w+)\s*;?\s*$/);
      if (echoVar && taintedVars.has(echoVar[1])) {
        issues.push({ line: index + 1, type: "security", message: `\`$${echoVar[1]}\` was assigned from a superglobal (\`$_GET\`/\`$_POST\`/etc.) earlier and is echoed here without escaping — a reflected XSS risk. Wrap it in \`htmlspecialchars()\` before output.` });
      }
    }

    // include/require with a variable path — local/remote file inclusion.
    if (/\b(include|include_once|require|require_once)\s+\$/.test(line) || /\b(include|include_once|require|require_once)\s*\(\s*\$/.test(line)) {
      issues.push({ line: index + 1, type: "security", message: "Includes a file using a variable path. If that value can be influenced by user input, this is a local/remote file inclusion risk." });
    }

    // system()/exec()/shell_exec()/passthru() with a non-literal argument.
    const shellCall = line.match(/\b(system|exec|shell_exec|passthru)\s*\((.+)\)\s*;?$/);
    if (shellCall && !/^["'].*["']$/.test(shellCall[2].trim())) {
      issues.push({ line: index + 1, type: "security", message: `\`${shellCall[1]}()\` runs its argument as a shell command. If any part of it comes from user input, this is a command-injection risk — validate/escape with \`escapeshellarg()\` at minimum.` });
    }

    if (/\bunserialize\s*\(/.test(line)) {
      issues.push({ line: index + 1, type: "security", message: "`unserialize()` on untrusted input can be used to construct arbitrary objects (PHP object injection). Prefer `json_decode()` for data from users." });
    }
  });

  return issues;
}
