import test from "node:test";
import assert from "node:assert/strict";
import { preprocessLaTeX } from "@/lib/latex";

test("preprocessLaTeX: normalizes inline TeX delimiters \\( ... \\) to $...$", () => {
  const input = "The energy-mass equivalence is given by \\( E = mc^2 \\).";
  const output = preprocessLaTeX(input);
  assert.equal(output, "The energy-mass equivalence is given by $E = mc^2$.");
});

test("preprocessLaTeX: normalizes display TeX delimiters \\[ ... \\] to $$...$$", () => {
  const input = "Here is the integral:\n\\[ \\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2} \\]";
  const output = preprocessLaTeX(input);
  assert.ok(output.includes("$$\n\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$"));
});

test("preprocessLaTeX: preserves standard $ and $$ math expressions untouched", () => {
  const input = "Inline $x + y = z$ and display:\n$$\n\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\n$$";
  const output = preprocessLaTeX(input);
  assert.equal(output, input);
});

test("preprocessLaTeX: shields fenced code blocks from transformation", () => {
  const input = `Here is some Python code:
\`\`\`python
# This should not be converted: \\(not_math\\) and \\[also_not_math\\]
def test():
    regex = r"\\[(.*?)\\]"
    return regex
\`\`\`
And here is actual math: \\( a^2 + b^2 = c^2 \\).`;

  const output = preprocessLaTeX(input);
  assert.ok(output.includes('\\(not_math\\) and \\[also_not_math\\]'));
  assert.ok(output.includes('regex = r"\\[(.*?)\\]"'));
  assert.ok(output.includes("$a^2 + b^2 = c^2$"));
});

test("preprocessLaTeX: shields inline code spans from transformation", () => {
  const input = "Use `\\[pattern\\]` to match brackets, and math is \\( x = 1 \\).";
  const output = preprocessLaTeX(input);
  assert.ok(output.includes("`\\[pattern\\]`"));
  assert.ok(output.includes("$x = 1$"));
});

test("preprocessLaTeX: wraps standalone naked environments like pmatrix", () => {
  const input = "Matrix:\n\\begin{pmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{pmatrix}";
  const output = preprocessLaTeX(input);
  assert.ok(output.includes("$$\n\\begin{pmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{pmatrix}\n$$"));
});

test("preprocessLaTeX: does not double wrap environments already inside $$", () => {
  const input = "$$\n\\begin{pmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{pmatrix}\n$$";
  const output = preprocessLaTeX(input);
  assert.equal(output, input);
});

test("preprocessLaTeX: handles empty, undefined, or text without math gracefully", () => {
  assert.equal(preprocessLaTeX(""), "");
  assert.equal(preprocessLaTeX("Just plain text with nothing special."), "Just plain text with nothing special.");
});

test("preprocessLaTeX: rescues backticked mathematical induction expressions into $...$", () => {
  const input =
    "Prove that `1 \\le 1^2`. Assume `1 \\le k \\le n`, then `1 + 2 + ... + (n + 1) \\le (n + 1)^2`.";
  const output = preprocessLaTeX(input);
  assert.ok(output.includes("$1 \\le 1^2$"));
  assert.ok(output.includes("$1 \\le k \\le n$"));
  assert.ok(output.includes("$1 + 2 + ... + (n + 1) \\le (n + 1)^2$"));
});

test("preprocessLaTeX: rescues backticked limits and square roots", () => {
  const input =
    "The domain is `x \\ge 0` and `lim (x->2) f(x) = \\sqrt((5x + x) / (3x + 4))`.";
  const output = preprocessLaTeX(input);
  assert.ok(output.includes("$x \\ge 0$"));
  assert.ok(output.includes("$\\lim_{x \\to 2}"));
  assert.ok(output.includes("\\sqrt{(5x + x) / (3x + 4)}"));
});

test("preprocessLaTeX: converts multi-row ASCII pipe matrices into LaTeX pmatrix", () => {
  const input = `Given two matrices, A and B:
A = | 1  2  3 |
    | 4  5  6 |
    | 7  8  9 |

B = | 9  8  7 |
    | 6  5  4 |
    | 3  2  1 |`;

  const output = preprocessLaTeX(input);
  assert.ok(output.includes("$$\nA = \\begin{pmatrix}\n1 & 2 & 3 \\\\\n4 & 5 & 6 \\\\\n7 & 8 & 9\n\\end{pmatrix}\n$$"));
  assert.ok(output.includes("$$\nB = \\begin{pmatrix}\n9 & 8 & 7 \\\\\n6 & 5 & 4 \\\\\n3 & 2 & 1\n\\end{pmatrix}\n$$"));
});

test("preprocessLaTeX: rescues naked prose integrals into $...$", () => {
  const input = "The definite integral is: \\int(2x^2 + 3x - 1) dx = (2/3)x^3 + (3/2)x^2 - x + C.";
  const output = preprocessLaTeX(input);
  assert.ok(output.includes("$\\int(2x^2 + 3x - 1) dx = (2/3)x^3 + (3/2)x^2 - x + C$"));
});

test("preprocessLaTeX: converts ```latex fenced blocks to display math", () => {
  const input = "```latex\n\\int_0^1 x^2 dx = \\frac{1}{3}\n```";
  const output = preprocessLaTeX(input);
  assert.ok(output.includes("$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$"));
});

test("preprocessLaTeX: preserves genuine programming code backticks untouched", () => {
  const input = "Run `npm install` or `git status`, and check `console.log(x)`.";
  const output = preprocessLaTeX(input);
  assert.ok(output.includes("`npm install`"));
  assert.ok(output.includes("`git status`"));
  assert.ok(output.includes("`console.log(x)`"));
});

