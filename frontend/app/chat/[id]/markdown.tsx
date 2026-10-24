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
  code: (p: ComponentProps<"code">) => <code {...p} className="rounded-chip bg-surface px-1 font-mono text-sm" />,
  pre: (p: ComponentProps<"pre">) => <pre {...p} tabIndex={0} className="overflow-x-auto whitespace-pre rounded-control border border-border bg-surface p-3 font-mono text-sm" />,
  blockquote: (p: ComponentProps<"blockquote">) => <blockquote {...p} className="border-l-2 border-border-strong pl-3 text-muted" />,
  // Tables get the card treatment (the only Answer element that does, besides charts); wide ones scroll inside it.
  table: (p: ComponentProps<"table">) => (
    <div tabIndex={0} className="overflow-x-auto rounded-card border border-border bg-background shadow-sm">
      <table {...p} className="w-full border-collapse text-left text-sm" />
    </div>
  ),
  th: (p: ComponentProps<"th">) => <th {...p} className="whitespace-nowrap bg-surface px-4 py-2 font-semibold" />,
  td: (p: ComponentProps<"td">) => <td {...p} className="border-t border-border px-4 py-2" />,
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
