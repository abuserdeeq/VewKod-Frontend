// Run: node src/localEngine/pilot/pilot-test.mjs
//
// Tests every language pilot currently under development. Not part
// of the app or the test suite — paste whatever this prints back
// into the chat.

import fs from "node:fs";
import { analyzePythonAst } from "./pythonTreeSitter.js";
import { analyzeJavaScriptAst } from "./jsTreeSitter.js";
import { analyzeTypeScriptAst } from "./tsTreeSitter.js";
import { analyzeGoAst } from "./goTreeSitter.js";
import { analyzeRustAst } from "./rustTreeSitter.js";
import { analyzePHPAst } from "./phpTreeSitter.js";
import { analyzeJavaAst } from "./javaTreeSitter.js";
import { analyzeCSharpAst } from "./csharpTreeSitter.js";
import { analyzeKotlinAst } from "./kotlinTreeSitter.js";
import { analyzeSwiftAst } from "./swiftTreeSitter.js";
import { analyzeCAst } from "./cTreeSitter.js";
import { analyzeCppAst } from "./cppTreeSitter.js";
import { analyzeBashAst } from "./bashTreeSitter.js";

const wasmPaths = {
  python: "./node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm",
  javascript: "./node_modules/tree-sitter-wasms/out/tree-sitter-javascript.wasm",
  typescript: "./node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm",
  go: "./node_modules/tree-sitter-wasms/out/tree-sitter-go.wasm",
  rust: "./node_modules/tree-sitter-wasms/out/tree-sitter-rust.wasm",
  php: "./node_modules/tree-sitter-wasms/out/tree-sitter-php.wasm",
  java: "./node_modules/tree-sitter-wasms/out/tree-sitter-java.wasm",
  csharp: "./node_modules/tree-sitter-wasms/out/tree-sitter-c_sharp.wasm",
  kotlin: "./node_modules/tree-sitter-wasms/out/tree-sitter-kotlin.wasm",
  swift: "./node_modules/tree-sitter-wasms/out/tree-sitter-swift.wasm",
  c: "./node_modules/tree-sitter-wasms/out/tree-sitter-c.wasm",
  cpp: "./node_modules/tree-sitter-wasms/out/tree-sitter-cpp.wasm",
  bash: "./node_modules/tree-sitter-wasms/out/tree-sitter-bash.wasm",
};

const wasmDir = "./node_modules/tree-sitter-wasms/out";
if (fs.existsSync(wasmDir)) {
  console.log(`Contents of ${wasmDir}:`, fs.readdirSync(wasmDir));
} else {
  console.log(`${wasmDir} does not exist.`);
}

async function runSamples(label, analyzeFn, samples, wasmPaths) {
  console.log(`\n\n########## ${label} ##########`);
  for (const [caseLabel, code] of Object.entries(samples)) {
    console.log(`\n===== ${caseLabel} =====`);
    try {
      const result = await analyzeFn(code, wasmPaths);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("ERROR — message:", err && err.message);
      console.error("ERROR — stack:", err && err.stack);
    }
  }
}

// ---------------- Python ----------------
await runSamples("PYTHON", analyzePythonAst, {
  "unreachable + empty except": `def divide_scores(total, count):
    if count > 0:
        return total / count
        print("This will never run")

    return total / 0

def process(data):
    try:
        result = risky_operation(data)
    except Exception:
        pass

    return result
`,
}, wasmPaths);

// ---------------- JavaScript ----------------
await runSamples("JAVASCRIPT", analyzeJavaScriptAst, {
  "unreachable + empty catch": `function calculateFee(amount, count) {
  if (count > 0) {
    return amount / count;
    console.log("This will never run");
  }
  return amount / 0;
}
function processOrder(order) {
  try {
    return chargeCard(order);
  } catch (e) {
  }
}
`,
}, wasmPaths);

// ---------------- TypeScript ----------------
await runSamples("TYPESCRIPT", analyzeTypeScriptAst, {
  "unreachable + empty catch": `function calculateFee(amount: number, count: number): number {
  if (count > 0) {
    return amount / count;
    console.log("This will never run");
  }
  return amount / 0;
}
function processOrder(order: Order): boolean {
  try {
    return chargeCard(order);
  } catch (e) {
  }
}
`,
}, wasmPaths);

// ---------------- Go ----------------
await runSamples("GO", analyzeGoAst, {
  "unreachable (no catch equivalent)": `func calculateFee(amount float64, count int) float64 {
	if count > 0 {
		return amount / float64(count)
		fmt.Println("This will never run")
	}
	return amount / 0
}
`,
}, wasmPaths);

// ---------------- Rust ----------------
await runSamples("RUST", analyzeRustAst, {
  "unreachable (no catch equivalent)": `fn calculate_fee(amount: i32, count: i32) -> i32 {
    if count > 0 {
        return amount / count;
        println!("This will never run");
    }
    return amount / 0;
}
`,
}, wasmPaths);

// ---------------- PHP ----------------
await runSamples("PHP", analyzePHPAst, {
  "unreachable + empty catch": `<?php
function calculateFee($amount, $count) {
    if ($count > 0) {
        return $amount / $count;
        echo "This will never run";
    }
    return $amount / 0;
}
function processOrder($order) {
    try {
        return chargeCard($order);
    } catch (Exception $e) {
    }
}
`,
}, wasmPaths);

// ---------------- Java ----------------
await runSamples("JAVA", analyzeJavaAst, {
  "unreachable + empty catch": `public class PaymentProcessor {
    public double calculateFee(double amount, int count) {
        if (count > 0) {
            return amount / count;
            System.out.println("This will never run");
        }
        return amount / 0;
    }
    public double processOrder(Order order) {
        try {
            return chargeCard(order);
        } catch (Exception e) {
        }
        return 0;
    }
}
`,
}, wasmPaths);

// ---------------- C# ----------------
await runSamples("C#", analyzeCSharpAst, {
  "unreachable + empty catch (Allman style)": `public class PaymentProcessor
{
    public double CalculateFee(double amount, int count)
    {
        if (count > 0)
        {
            return amount / count;
            Console.WriteLine("This will never run");
        }
        return amount / 0;
    }
    public double ProcessOrder(Order order)
    {
        try
        {
            return ChargeCard(order);
        }
        catch (Exception e)
        {
        }
        return 0;
    }
}
`,
}, wasmPaths);

// ---------------- Kotlin ----------------
await runSamples("KOTLIN", analyzeKotlinAst, {
  "unreachable + empty catch": `fun calculateFee(amount: Double, count: Int): Double {
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
`,
}, wasmPaths);

// ---------------- Swift ----------------
await runSamples("SWIFT", analyzeSwiftAst, {
  "unreachable + empty catch": `func calculateFee(amount: Double, count: Int) -> Double {
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
`,
}, wasmPaths);

// ---------------- C ----------------
await runSamples("C", analyzeCAst, {
  "unreachable (no catch/classes in C)": `double calculate_fee(double amount, int count) {
    if (count > 0) {
        return amount / count;
        printf("This will never run\\n");
    }
    return amount / 0;
}
`,
}, wasmPaths);

// ---------------- C++ ----------------
await runSamples("C++", analyzeCppAst, {
  "unreachable + empty catch + class": `class PaymentProcessor {
public:
    double calculateFee(double amount, int count) {
        if (count > 0) {
            return amount / count;
            std::cout << "This will never run";
        }
        return amount / 0;
    }

    double processOrder(Order order) {
        try {
            return chargeCard(order);
        } catch (const std::exception& e) {
        }
        return 0;
    }
};
`,
}, wasmPaths);

// ---------------- Bash ----------------
await runSamples("BASH", analyzeBashAst, {
  "unreachable (no catch/classes in Bash)": `calculate_fee() {
  local amount=$1
  local count=$2
  if [ "$count" -gt 0 ]; then
    echo $((amount / count))
    return
    echo "This will never run"
  fi
  echo $((amount / 0))
}
`,
}, wasmPaths);
