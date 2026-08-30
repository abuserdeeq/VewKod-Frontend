import test from "node:test";
import assert from "node:assert/strict";
import { generateLocalExplanation } from "../../src/localEngine/core/engineRunner.js";

function issuesSection(explanation) {
  return explanation.split("## Potential Issues")[1] || "";
}

test("Flags eval() usage as a security issue", () => {
  const code = 'const result = eval(userInput);\nconsole.log(result);';
  const out = generateLocalExplanation(code, "javascript");
  assert.match(issuesSection(out), /`eval\(\)` executes arbitrary code/);
});

test("Flags string-concatenated SQL queries as a possible injection risk", () => {
  const jsOut = generateLocalExplanation(
    'const query = "SELECT * FROM users WHERE id = " + userId;\nconsole.log(query);',
    "javascript"
  );
  assert.match(issuesSection(jsOut), /SQL injection/);

  const phpOut = generateLocalExplanation(
    '<?php\n$query = "SELECT * FROM users WHERE id = " . $id;\necho $query;',
    "php"
  );
  assert.match(issuesSection(phpOut), /SQL injection/);
});

test("Does not flag parameterized queries as SQL injection risks", () => {
  const out = generateLocalExplanation(
    'cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))',
    "python"
  );
  assert.doesNotMatch(issuesSection(out), /SQL injection/);
});

test("Flags hard-coded AWS access keys", () => {
  const out = generateLocalExplanation(
    'const key = "AKIAABCDEFGHIJKLMNOP";\nconsole.log(key);',
    "javascript"
  );
  assert.match(issuesSection(out), /AWS access key/);
});

test("Flags non-literal innerHTML/outerHTML assignment as a DOM XSS risk", () => {
  const out = generateLocalExplanation(
    'function render(name) {\n  document.getElementById("out").innerHTML = name;\n}',
    "javascript"
  );
  assert.match(issuesSection(out), /DOM-based XSS/);
});

test("Does not flag innerHTML assigned a fixed string literal", () => {
  const out = generateLocalExplanation(
    'function render() {\n  document.getElementById("out").innerHTML = "<b>Hi</b>";\n}',
    "javascript"
  );
  assert.doesNotMatch(issuesSection(out), /DOM-based XSS/);
});

test("Flags document.write() as an XSS vector", () => {
  const out = generateLocalExplanation(
    'function render(name) {\n  document.write(name);\n}',
    "javascript"
  );
  assert.match(issuesSection(out), /document\.write\(\)/);
});

test("Python: flags os.system()/subprocess(shell=True) with a non-literal command", () => {
  const out = generateLocalExplanation(
    'import os\ndef run(cmd):\n    os.system(cmd)\n    subprocess.run(cmd, shell=True)',
    "python"
  );
  const section = issuesSection(out);
  assert.match(section, /os\.system\(\)/);
  assert.match(section, /shell=True/);
});

test("Python: does not flag os.system()/subprocess with a literal command", () => {
  const out = generateLocalExplanation(
    'import os\ndef run():\n    os.system("ls -la")\n    subprocess.run(["ls", "-la"])',
    "python"
  );
  assert.doesNotMatch(issuesSection(out), /command-injection/);
});

test("Python: flags pickle.loads() and unsafe yaml.load()", () => {
  const out = generateLocalExplanation(
    'def run(raw):\n    data = pickle.loads(raw)\n    conf = yaml.load(raw)',
    "python"
  );
  const section = issuesSection(out);
  assert.match(section, /pickle\.load/);
  assert.match(section, /yaml\.load/);
});

test("PHP: flags unescaped superglobal echo, variable include, system(), and unserialize()", () => {
  const out = generateLocalExplanation(
    '<?php\necho $_GET["name"];\ninclude $_GET["page"];\nsystem($_GET["cmd"]);\n$obj = unserialize($_POST["data"]);',
    "php"
  );
  const section = issuesSection(out);
  assert.match(section, /reflected XSS/);
  assert.match(section, /file inclusion/);
  assert.match(section, /command-injection/);
  assert.match(section, /object injection/);
});

test("PHP: flags echo of a variable tainted by a superglobal on an earlier line", () => {
  const out = generateLocalExplanation(
    '<?php\n$name = $_GET["name"];\necho $name;',
    "php"
  );
  assert.match(issuesSection(out), /reflected XSS/);
});

test("PHP: does not flag a variable sanitized before echo", () => {
  const out = generateLocalExplanation(
    '<?php\n$name = htmlspecialchars($_GET["name"]);\necho $name;',
    "php"
  );
  assert.doesNotMatch(issuesSection(out), /reflected XSS/);
});

test("PHP: does not flag ordinary variables unrelated to superglobals", () => {
  const out = generateLocalExplanation(
    '<?php\n$greeting = "hello";\necho $greeting;',
    "php"
  );
  assert.match(issuesSection(out), /No obvious issues were detected/);
});

test("PHP: does not flag escaped output", () => {
  const out = generateLocalExplanation(
    '<?php\necho htmlspecialchars($_GET["name"]);',
    "php"
  );
  assert.doesNotMatch(issuesSection(out), /reflected XSS/);
});

test("Java: flags Runtime.exec()/ProcessBuilder concatenation and ObjectInputStream", () => {
  const out = generateLocalExplanation(
    'class A {\n  void run(String cmd) {\n    Runtime.getRuntime().exec("ls " + cmd);\n    ObjectInputStream ois = new ObjectInputStream(in);\n    Object data = ois.readObject();\n  }\n}',
    "java"
  );
  const section = issuesSection(out);
  assert.match(section, /Runtime\.exec\(\)/);
  assert.match(section, /ObjectInputStream/);
});

test("Java: does not double-flag a single ObjectInputStream/readObject() pair", () => {
  const out = generateLocalExplanation(
    'class A {\n  void run() {\n    ObjectInputStream ois = new ObjectInputStream(in);\n    Object data = ois.readObject();\n  }\n}',
    "java"
  );
  const matches = issuesSection(out).match(/ObjectInputStream/g) || [];
  assert.equal(matches.length, 1);
});

test("Go: flags exec.Command with a shell and a built command string", () => {
  const out = generateLocalExplanation(
    'func run(cmd string) {\n\texec.Command("sh", "-c", fmt.Sprintf("echo %s", cmd))\n}',
    "go"
  );
  assert.match(issuesSection(out), /command-injection/);
});

test("C/C++: flags sprintf() and system() with a non-literal argument", () => {
  const cOut = generateLocalExplanation(
    'void run(char *s) {\n\tchar buf[10];\n\tsprintf(buf, "%s", s);\n\tsystem(s);\n}',
    "c"
  );
  assert.match(issuesSection(cOut), /snprintf/);
  assert.match(issuesSection(cOut), /command-injection/);
});

test("C#: flags Process.Start() concatenation and BinaryFormatter deserialization", () => {
  const out = generateLocalExplanation(
    'class A {\n  void Run(string cmd) {\n    Process.Start("cmd.exe /c " + cmd);\n    var bf = new BinaryFormatter();\n  }\n}',
    "csharp"
  );
  const section = issuesSection(out);
  assert.match(section, /Process\.Start\(\)/);
  assert.match(section, /BinaryFormatter/);
});

test("Bash: flags eval with a variable and curl-piped-to-shell", () => {
  const out = generateLocalExplanation(
    '#!/bin/bash\neval "$USER_INPUT"\ncurl https://example.com/install.sh | bash',
    "bash"
  );
  const section = issuesSection(out);
  assert.match(section, /eval/);
  assert.match(section, /Piping a download/);
});

test("Rust: flags Command::new(\"sh\") shelling out and bare unsafe blocks", () => {
  const out = generateLocalExplanation(
    'fn run(cmd: &str) {\n    Command::new("sh").arg("-c").arg(cmd);\n    unsafe {\n        let x = 1;\n    }\n}',
    "rust"
  );
  const section = issuesSection(out);
  assert.match(section, /command-injection/);
  assert.match(section, /memory-safety/);
});

test("Does not flag ordinary, safe code with new false positives", () => {
  const out = generateLocalExplanation(
    "def add(a, b):\n    return a + b\n\nresult = add(1, 2)\nprint(result)",
    "python"
  );
  assert.match(issuesSection(out), /No obvious issues were detected/);
});

test("Flags a hard-coded $pass/pwd credential, not just *password*", () => {
  const phpOut = generateLocalExplanation(
    '<?php\n$pass = "hardcoded123";\necho $pass;',
    "php"
  );
  assert.match(issuesSection(phpOut), /hard-coded secret or credential/);

  const pwdOut = generateLocalExplanation(
    'pwd = "hardcoded123"\nprint(pwd)',
    "python"
  );
  assert.match(issuesSection(pwdOut), /hard-coded secret or credential/);
});

test("Does not flag an unrelated identifier that merely ends in 'pass'", () => {
  const out = generateLocalExplanation(
    'compass = "north"\nprint(compass)',
    "python"
  );
  assert.doesNotMatch(issuesSection(out), /hard-coded secret or credential/);
});

test("Flags hard-coded private keys and client secrets", () => {
  const out = generateLocalExplanation(
    'private_key = "-----BEGIN RSA PRIVATE KEY-----"\nclient_secret = "abc123"',
    "python"
  );
  const section = issuesSection(out);
  const matches = section.match(/hard-coded secret or credential/g) || [];
  assert.equal(matches.length, 2);
});
