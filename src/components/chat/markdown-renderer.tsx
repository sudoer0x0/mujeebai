import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { CodeBlock } from "@/components/chat/code-block";
import { GeneratedImage } from "@/components/chat/generated-image";
import { preprocessLaTeX } from "@/lib/latex";
import { cn } from "@/lib/utils";

// Sanitized Markdown renderer for assistant messages, preserving math structures.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className"]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className"]],
    div: [...(defaultSchema.attributes?.div ?? []), ["className"]],
  },
};

/**
 * Custom renderers for the elements a reply actually uses.
 *
 * Every one destructures `node` out of its props. react-markdown passes
 * the AST node to each component, and spreading it onto a DOM element
 * emitted `node="[object Object]"` as a real attribute on every paragraph,
 * table cell and list — invalid HTML that React warns about and that
 * shipped in the markup of every message.
 */
const components: Components = {
  /**
   * Images inside a reply — in practice, generated ones, which arrive as
   * `![prompt](/api/assets/<id>)`.
   *
   * Delegated to GeneratedImage, which bounds the size and adds the
   * viewer, copy and download actions. Before that, the renderer emitted a
   * bare `<img>` at natural size with nothing to do but open a new tab.
   */
  img: ({ src, alt }) => {
    if (typeof src !== "string") return null;
    return <GeneratedImage src={src} alt={alt ?? ""} />;
  },

  a: ({ href, children, node, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-accent underline underline-offset-2 hover:opacity-80"
      {...props}
    >
      {children}
    </a>
  ),
  table: ({ children, node, ...props }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, node, ...props }) => (
    <th className="border border-line bg-surface-raised px-3 py-1.5 text-left font-medium" {...props}>
      {children}
    </th>
  ),
  td: ({ children, node, ...props }) => (
    <td className="border border-line px-3 py-1.5" {...props}>
      {children}
    </td>
  ),
  blockquote: ({ children, node, ...props }) => (
    <blockquote className="my-3 border-l-2 border-line pl-4 text-muted" {...props}>
      {children}
    </blockquote>
  ),
  ul: ({ children, node, ...props }) => (
    <ul className="my-2 list-disc space-y-1 pl-6" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, node, ...props }) => (
    <ol className="my-2 list-decimal space-y-1 pl-6" {...props}>
      {children}
    </ol>
  ),
  h1: ({ children, node, ...props }) => (
    <h1 className="mb-2 mt-4 text-xl font-semibold" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, node, ...props }) => (
    <h2 className="mb-2 mt-4 text-lg font-semibold" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, node, ...props }) => (
    <h3 className="mb-1.5 mt-3 text-base font-semibold" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, node, ...props }) => (
    <p className="[&:not(:first-child)]:mt-3" {...props}>
      {children}
    </p>
  ),
  code(props) {
    const { className, children, ...rest } = props;
    const isInline = !className;
    const match = /language-(\w+)/.exec(className ?? "");

    if (isInline) {
      return (
        <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[0.85em]" {...rest}>
          {children}
        </code>
      );
    }

    return <CodeBlock language={match?.[1] ?? ""} code={String(children).replace(/\n$/, "")} />;
  },
};

export function MarkdownRenderer({ content, className }: { content: string; className?: string }) {
  const processedContent = preprocessLaTeX(content);

  return (
    <div className={cn("text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeSanitize, sanitizeSchema],
          [rehypeKatex, { throwOnError: false, strict: false }],
        ]}
        components={components}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
