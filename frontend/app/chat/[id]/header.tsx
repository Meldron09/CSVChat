import { ThemeToggle } from "@/components/theme-toggle";
import { OpenSidebarButton } from "./dataset-sidebar";
import { HeaderActions } from "./header-actions";

/** App header: name, then (right-aligned) the actions. */
export function Header({ chatId }: { chatId: string }) {
  return (
    <header className="relative flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-background px-4 py-2 shadow-sm">
      <OpenSidebarButton />
      {/* not a heading: the main pane owns the page's one <h1> */}
      <p className="text-xl font-bold tracking-[-0.02em]">CSVChat</p>
      <p title={`Chat ${chatId}`} className="hidden min-w-0 max-w-[22rem] truncate rounded-chip border border-border bg-surface px-2 py-1 font-mono text-xs text-muted sm:block">
        {chatId}
      </p>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
        <HeaderActions />
        <ThemeToggle />
      </div>
    </header>
  );
}
