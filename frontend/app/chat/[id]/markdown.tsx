import type { ComponentProps } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Raw HTML in the Answer is never rendered (react-markdown's default); styling comes from the design tokens.
// Paragraphs keep newlines (pre-wrap) so plain-text Answers look the same as before.
const components = {
  p: (p: ComponentProps<"p">) => <p {...p} className="whitespace-pre-wrap" />,
  ul: (p: ComponentProps<"ul">) => <ul {...p} className="list-disc pl-5" />,
  ol: (p: ComponentProps<"ol">) => <ol {...p} className="list-decimal pl-5" />,
  h1: (p: ComponentProps<"h1">) => <h1 {...p} className="text-base font-semibold" />,
  h2: (p: ComponentProps<"h2">) => <h2 {...p} className="text-base font-semibold" />,
  h3: (p: ComponentProps<"h3">) => <h3 {...p} className="font-semibold" />,
  h4: (p: ComponentProps<"h4">) => <h4 {...p} className="font-semibold" />,
  h5: (p: ComponentProps<"h5">) => <h5 {...p} className="font-semibold" />,
  h6: (p: ComponentProps<"h6">) => <h6 {...p} className="font-semibold" />,
  a: (p: ComponentProps<"a">) => <a {...p} target="_blank" rel="noopener noreferrer" className="text-brand underline" />,
  code: (p: ComponentProps<"code">) => <code {...p} className="rounded-control bg-background px-1 text-xs" />,
  pre: (p: ComponentProps<"pre">) => <pre {...p} className="overflow-x-auto rounded-control bg-background p-2 text-xs" />,
  blockquote: (p: ComponentProps<"blockquote">) => <blockquote {...p} className="border-l-2 border-border-strong pl-3 text-muted" />,
  table: (p: ComponentProps<"table">) => (
    <div className="overflow-x-auto">
      <table {...p} className="border-collapse text-left" />
    </div>
  ),
  th: (p: ComponentProps<"th">) => <th {...p} className="border border-border px-2 py-1 font-semibold" />,
  td: (p: ComponentProps<"td">) => <td {...p} className="border border-border px-2 py-1" />,
};

export function AnswerMarkdown({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  );
}
