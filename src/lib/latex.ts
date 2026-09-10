/**
 * Preprocesses Markdown content before handing it to remark-math.
 *
 * LLMs frequently output mathematical notation using:
 * 1. TeX bracket delimiters: `\(...\)` (inline) and `\[...\]` (display).
 * 2. Markdown backticks: `x \le 5`, `1 + 2 + ... + k \le k^2`, `\sqrt{(5x+x)/(3x+4)}`, `\lim (x->2)`.
 * 3. Naked calculus expressions in prose: `\int(2x^2 + 3x - 1) dx = (2/3)x^3 + ...`.
 * 4. Multi-row ASCII pipe matrices: `A = | 1 2 3 |\n    | 4 5 6 |`.
 * 5. Naked top-level environments: `\begin{pmatrix}...\end{pmatrix}` or `\begin{align}...\end{align}`.
 *
 * `remark-math` strictly expects standard `$...$` and `$$...$$`.
 *
 * This normalizer:
 * - Shields genuine code blocks (Python, JS, Bash, etc.) and non-math inline code from alteration.
 * - Rescues math accidentally wrapped in backticks.
 * - Rescues multi-line ASCII pipe matrices into standard LaTeX `\begin{pmatrix}` blocks.
 * - Normalizes TeX brackets `\[...\]` -> `$$...$$` and `\(...\)` -> `$...$`.
 * - Normalizes common math shorthand like `\sqrt(...)` -> `\sqrt{...}` and `lim (x->a)` -> `\lim_{x \to a}`.
 * - Wraps standalone LaTeX math environments in `$$...$$`.
 * - Restores all shielded programming code blocks untouched.
 */

const MATH_COMMANDS = [
  "\\le", "\\ge", "\\leq", "\\geq", "\\sqrt", "\\frac", "\\int", "\\times",
  "\\div", "\\pm", "\\mp", "\\lim", "\\sum", "\\prod", "\\alpha", "\\beta",
  "\\gamma", "\\delta", "\\theta", "\\pi", "\\sigma", "\\lambda", "\\omega",
  "\\in", "\\notin", "\\subset", "\\cup", "\\cap", "\\neq", "\\approx",
  "\\equiv", "\\infty", "\\cdot", "\\partial", "\\nabla", "\\to", "\\rightarrow",
  "\\leftarrow", "\\Rightarrow", "\\forall", "\\exists", "\\log", "\\ln",
  "\\sin", "\\cos", "\\tan", "\\cot", "\\sec", "\\csc", "\\vec", "\\left", "\\right",
];

const ASCII_MATRIX_REGEX =
  /^[ \t]*(?:([A-Za-z](?:\[[^\]\n]+\])?)\s*=\s*)?(\|.+?\|)[ \t]*\n((?:[ \t]*\|.+?\|[ \t]*(?:\n|$))+)/gm;

const LATEX_ENV_REGEX =
  /\\begin\{(matrix|pmatrix|bmatrix|vmatrix|Vmatrix|align\*?|aligned|gather\*?|gathered|cases|split)\}([\s\S]*?)\\end\{\1\}/g;

export function preprocessLaTeX(content: string): string {
  if (!content || typeof content !== "string") return "";

  // Quick check: if no math-like tokens exist, return content immediately.
  if (
    !content.includes("\\") &&
    !content.includes("$$") &&
    !content.includes("$") &&
    !content.includes("`") &&
    !content.includes("|")
  ) {
    return content;
  }

  let result = content;

  // 1. Convert explicit ```latex or ```math fenced code blocks to display math
  result = result.replace(/```(?:latex|math|tex)\n([\s\S]*?)```/g, (_match, inner) => {
    return `\n\n$$\n${inner.trim()}\n$$\n\n`;
  });

  // 2. Shield all other fenced code blocks (```lang ... ```)
  const codeBlocks: string[] = [];
  const placeholderPrefix = "\uE000MUJEEB_CODE_";
  const placeholderSuffix = "\uE000";

  result = result.replace(/```[\s\S]*?```/g, (match) => {
    const idx = codeBlocks.length;
    codeBlocks.push(match);
    return `${placeholderPrefix}${idx}${placeholderSuffix}`;
  });

  // 3. Rescue multi-row ASCII pipe matrices into LaTeX pmatrix display math
  result = result.replace(ASCII_MATRIX_REGEX, (match, label, firstRow, restRows) => {
    const rawRows = [firstRow, ...restRows.split("\n")]
      .map((r: string) => r.trim())
      .filter((r: string) => r.startsWith("|") && r.endsWith("|"));

    if (rawRows.length < 2) return match;

    const matrixRows = rawRows.map((row: string) => {
      const inner = row.slice(1, -1).trim();
      const cols = inner.split(/\s+/).filter(Boolean);
      return cols.join(" & ");
    });

    const prefix = label ? `${label} = ` : "";
    return `\n\n$$\n${prefix}\\begin{pmatrix}\n${matrixRows.join(" \\\\\n")}\n\\end{pmatrix}\n$$\n\n`;
  });

  // 4. Smart inline backtick rescue:
  // Detect if an inline code span `...` actually contains LaTeX math or equations.
  result = result.replace(/`([^`\n]+)`/g, (match, inner) => {
    const trimmed = inner.trim();

    // Check for LaTeX math commands (e.g. \le, \sqrt, \frac, \times)
    const hasMathCmd = MATH_COMMANDS.some((cmd) => trimmed.includes(cmd));
    // Check for limit notation (e.g. lim (x->2) or \lim)
    const hasLim = /lim\s*\([a-zA-Z]\s*->\s*[0-9a-zA-Z]+\)/i.test(trimmed);
    // Check for inequalities or relations with exponents/subscripts (e.g. 1 <= 1^2, (n + 1)^2)
    const hasExponentRelation =
      /[\le\ge<>=]\s*.*?\^[0-9]+/.test(trimmed) || /\^[0-9]+.*?[\le\ge<>=]/.test(trimmed);
    // Check for algebraic equations with operations and exponents or digits
    const hasAlgebraicEquals =
      /^[0-9a-zA-Z_()\s+\-*/^.,\\]+=[0-9a-zA-Z_()\s+\-*/^.,\\]+$/.test(trimmed) &&
      (trimmed.includes("^") || /[0-9]/.test(trimmed)) &&
      !trimmed.includes("const ") &&
      !trimmed.includes("let ") &&
      !trimmed.includes("var ");

    if (hasMathCmd || hasLim || hasExponentRelation || hasAlgebraicEquals) {
      // Normalize common pseudo-latex like \sqrt(...) to \sqrt{...} with 1 level of nested paren support
      let math = trimmed.replace(/\\sqrt\(((?:[^()]+|\([^()]*\))*)\)/g, "\\sqrt{$1}");
      // Normalize limit notation: lim (x->2) -> \lim_{x \to 2}
      math = math.replace(/lim\s*\(([a-zA-Z])\s*->\s*([0-9a-zA-Z]+)\)/gi, "\\lim_{$1 \\to $2}");
      return `$${math}$`;
    }

    // Preserve as genuine inline code
    const idx = codeBlocks.length;
    codeBlocks.push(match);
    return `${placeholderPrefix}${idx}${placeholderSuffix}`;
  });

  // 5. Normalize display math blocks: \[ ... \] -> $$ ... $$
  result = result.replace(/\\\[([\s\S]*?)\\\]/g, (_match, math) => {
    const trimmed = math.trim();
    if (!trimmed) return "";
    return `\n\n$$\n${trimmed}\n$$\n\n`;
  });

  // 6. Normalize inline math: \( ... \) -> $...$
  result = result.replace(/\\\(([\s\S]*?)\\\)/g, (_match, math) => {
    const trimmed = math.trim();
    if (!trimmed) return "";
    return `$${trimmed}$`;
  });

  // 7. Rescue naked unescaped TeX commands in prose outside of existing math blocks
  const parts = result.split(/(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$)/g);
  result = parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(
        /(?:^|(?<=[:\n\s]))(\\int(?:_[^\s$]+|\^[^\s$]+|\([^)]+\)|[^\n$])+?)(?=$|[\n.])/gm,
        (_match, expr) => `$${expr.trim()}$`,
      );
    })
    .join("");

  // 8. Wrap raw standalone LaTeX math environments if not already inside $$ or $
  result = result.replace(LATEX_ENV_REGEX, (match, envName, inner, offset, fullStr) => {
    const before = fullStr.slice(0, offset).trimEnd();
    const after = fullStr.slice(offset + match.length).trimStart();
    if (before.endsWith("$$") || after.startsWith("$$")) return match;
    if (before.endsWith("$") || after.startsWith("$")) return match;

    // In KaTeX, align* is supported natively, while align should be aligned
    let targetEnv = envName;
    if (targetEnv === "align") {
      targetEnv = "aligned";
    }

    return `\n\n$$\n\\begin{${targetEnv}}${inner}\\end{${targetEnv}}\n$$\n\n`;
  });

  // 9. Restore shielded programming code blocks
  const placeholderRegex = new RegExp(`${placeholderPrefix}(\\d+)${placeholderSuffix}`, "g");
  return result.replace(placeholderRegex, (_match, indexStr) => {
    const index = parseInt(indexStr, 10);
    return codeBlocks[index] ?? "";
  });
}
