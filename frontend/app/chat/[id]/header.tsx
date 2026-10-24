import { ThemeToggle } from "@/components/theme-toggle";
import { OpenSidebarButton } from "./dataset-sidebar";

/** App header: name, then (right-aligned) the actions. Later actions ("Copy chat link", "New chat") go before ThemeToggle. */
export function Header({ chatId }: { chatId: string }) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">
      <OpenSidebarButton />
      <h1 className="text-xl font-semibold">CSVChat</h1>
      <p className="hidden text-sm text-muted sm:block">Chat {chatId}</p>
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
      </div>
    </header>
  );
}
