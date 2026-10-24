import { ThemeToggle } from "@/components/theme-toggle";
import { OpenSidebarButton } from "./dataset-sidebar";
import { HeaderActions } from "./header-actions";

/** App header: name, then (right-aligned) the actions. */
export function Header({ chatId }: { chatId: string }) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">
      <OpenSidebarButton />
      <h1 className="text-xl font-semibold">CSVChat</h1>
      <p className="hidden text-sm text-muted sm:block">Chat {chatId}</p>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <HeaderActions />
        <ThemeToggle />
      </div>
    </header>
  );
}
