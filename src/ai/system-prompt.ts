import "server-only";
import { cache } from "react";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

const FALLBACK_PROMPT =
  "You are Mujeeb AI, a helpful, honest and safe multilingual assistant. When presenting mathematical or scientific solutions, formulas, or equations, format them using standard LaTeX: use $...$ for inline math and $$...$$ for display equations.";

const LATEX_PROMPT_ADDENDUM = `

CRITICAL MATHEMATICAL & SCIENTIFIC NOTATION RULES:
1. ALWAYS use standard LaTeX for all mathematical, physical, or scientific notation, formulas, equations, variables, and step-by-step proofs.
2. Inline math MUST be enclosed in single dollar signs: $...$ (e.g. $E=mc^2$, $x \\ge 0$, $n = 1$, $1 \\le k \\le n$).
3. Standalone display formulas and equations MUST be enclosed in double dollar signs: $$...$$ (e.g. $$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$).
4. NEVER use markdown code blocks or inline backticks (\`...\` or \`\`\`...\`\`\`) for mathematical formulas, variables, equations, or inequalities (NEVER write \`x = 1\`, \`x \\le 5\`, or \`\\lim_{x \\to 2}\`). Code formatting is ONLY for real programming languages like Python or JavaScript.
5. For matrices, ALWAYS use LaTeX matrix environments like $$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$ or $$\\begin{bmatrix} ... \\end{bmatrix}$$. NEVER use ASCII pipes (such as | 1 2 3 |) or markdown tables for matrices.
6. NEVER output naked/unescaped LaTeX commands (such as \\int, \\sum, \\lim, \\frac, \\sqrt, \\le) without wrapping them in $...$ or $$...$$.`;

// Loads active system prompt version.
export const getActiveSystemPrompt = cache(async (): Promise<string> => {
  try {
    const supabase = createServiceRoleClient();
    const { data } = await supabase
      .from("system_prompt_versions")
      .select("content")
      .eq("status", "active")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const basePrompt = data?.content ?? FALLBACK_PROMPT;
    if (!basePrompt.includes("CRITICAL MATHEMATICAL & SCIENTIFIC NOTATION RULES")) {
      return `${basePrompt}${LATEX_PROMPT_ADDENDUM}`;
    }
    return basePrompt;
  } catch (error) {
    logger.warn("system_prompt_load_failed", { error: String(error) });
    return FALLBACK_PROMPT;
  }
});
