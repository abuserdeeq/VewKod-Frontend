import { genericFallbackExplanation, findCommonIssues } from "../shared/patterns.js";

export const id = "sql";
export const label = "SQL";

export function detect(code) {
  return /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE)\b/i.test(code);
}

export function buildSymbolTable(lines, symbolTable) {
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    const table = line.match(/\b(?:FROM|INTO|UPDATE|TABLE)\s+([`"]?\w+[`"]?)/i);
    if (table) symbolTable.add(table[1].replace(/[`"]/g, ""), "list", { kind: "table" });
  });
  return symbolTable;
}

export function analyzeStructure(lines) {
  const result = { functions: [], classes: [], imports: [], variables: [], loops: [], conditionals: [], returns: [], outputs: [], comments: [] };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) return;
    if (line.startsWith("--") || line.startsWith("/*")) result.comments.push(lineNumber);

    const table = line.match(/\b(?:FROM|INTO|UPDATE|TABLE)\s+([`"]?\w+[`"]?)/i);
    if (table) result.variables.push({ line: lineNumber, name: table[1] });

    if (/\bWHERE\b/i.test(line)) result.conditionals.push(lineNumber);
    if (/\bJOIN\b/i.test(line)) result.loops.push(lineNumber);
  });

  return result;
}

export function explainLine(rawLine, symbolTable) {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("--") || trimmed.startsWith("/*")) return "This is a SQL comment and is not executed.";

  if (/^WITH\b/i.test(trimmed)) {
    const cte = trimmed.match(/^WITH\s+([`"]?\w+[`"]?)\s+AS\s*\(?/i);
    return cte
      ? `Starts a CTE (a temporary, named result set) called \`${cte[1].replace(/[`"]/g, "")}\`, which the rest of this query can reference as if it were a table.`
      : "Starts a CTE (a temporary, named result set) that the rest of this query can reference as if it were a table.";
  }
  if (/^SELECT\b/i.test(trimmed)) {
    const cols = trimmed.match(/^SELECT\s+(.+?)\s+FROM\b/i);
    return cols
      ? `Selects the column(s) \`${cols[1].trim()}\` to retrieve from the database.`
      : "Starts a query that selects data from the database.";
  }
  if (/^FROM\b/i.test(trimmed)) {
    const table = trimmed.match(/^FROM\s+([`"]?\w+[`"]?)/i);
    return table ? `Specifies ${symbolTable.describe(table[1].replace(/[`"]/g, ""))} as the source table for this query.` : "Specifies the source table for this query.";
  }
  if (/^WHERE\b/i.test(trimmed)) {
    const cond = trimmed.replace(/^WHERE\s*/i, "");
    return `Filters rows so only those matching \`${cond}\` are included.`;
  }
  if (/\bJOIN\b/i.test(trimmed)) {
    const joinType = trimmed.match(/^(LEFT|RIGHT|FULL|INNER|CROSS)?\s*(?:OUTER\s+)?JOIN\b/i);
    const kind = (joinType && joinType[1] || "").toUpperCase();
    if (kind === "LEFT") return "Combines rows from another table where a related column matches, keeping every row from the left/first table even when there's no match (unmatched columns come back as `NULL`).";
    if (kind === "RIGHT") return "Combines rows from another table where a related column matches, keeping every row from the right/joined table even when there's no match (unmatched columns come back as `NULL`).";
    if (kind === "FULL") return "Combines rows from another table where a related column matches, keeping unmatched rows from BOTH tables (unmatched columns come back as `NULL`).";
    if (kind === "CROSS") return "Combines every row of one table with every row of another (a cross/cartesian join — no matching condition).";
    return "Combines rows from another table where a related column matches (rows with no match on either side are dropped).";
  }
  if (/^HAVING\b/i.test(trimmed)) {
    const cond = trimmed.replace(/^HAVING\s*/i, "").replace(/;$/, "");
    return `Filters the grouped results so only groups matching \`${cond}\` are kept (like \`WHERE\`, but applied after \`GROUP BY\`, so it can filter on aggregates like \`COUNT()\`).`;
  }
  if (/^ORDER BY\b/i.test(trimmed)) return `Sorts the results by \`${trimmed.replace(/^ORDER BY\s*/i, "").replace(/;$/, "")}\`.`;
  if (/^GROUP BY\b/i.test(trimmed)) return `Groups rows that share the same value(s) in \`${trimmed.replace(/^GROUP BY\s*/i, "").replace(/;$/, "")}\`.`;
  if (/^INSERT INTO\b/i.test(trimmed)) return "Adds new row(s) into a table.";
  if (/^UPDATE\b/i.test(trimmed)) {
    const table = trimmed.match(/^UPDATE\s+([`"]?\w+[`"]?)/i);
    return table ? `Modifies existing rows in ${symbolTable.describe(table[1].replace(/[`"]/g, ""))}.` : "Modifies existing rows in a table.";
  }
  if (/^DELETE FROM\b/i.test(trimmed)) return "Removes row(s) from a table.";
  if (trimmed === ")" || trimmed === ");") return "Closes the CTE definition or subquery started above.";
  if (/^CREATE TABLE\b/i.test(trimmed)) {
    const table = trimmed.match(/^CREATE TABLE\s+([`"]?\w+[`"]?)/i);
    return table ? `Creates a new table named \`${table[1].replace(/[`"]/g, "")}\`.` : "Creates a new table.";
  }

  return genericFallbackExplanation();
}

export function findIssues(lines) {
  // SQL previously kept its own standalone issue list and never ran
  // the cross-language checks every other analyzer applies (TODO/FIXME
  // markers, hard-coded secrets, etc.) — this brings it in line with
  // the rest so shared rules reach all 14 supported languages, not 13.
  const issues = findCommonIssues(lines);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();

    if (/^SELECT\s+\*/i.test(line)) {
      issues.push({ line: index + 1, type: "review", message: "`SELECT *` retrieves every column, which can be wasteful. Naming the columns you need is usually better." });
    }

    if (/^(UPDATE|DELETE FROM)\b/i.test(line)) {
      const hasWhereNearby = lines.slice(index, index + 4).some((l) => /\bWHERE\b/i.test(l));
      if (!hasWhereNearby) {
        issues.push({ line: index + 1, type: "security", message: "This statement has no visible `WHERE` clause — it may affect every row in the table." });
      }
    }
  });

  return issues;
}
