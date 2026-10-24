import { notFound } from "next/navigation";
import { getChat } from "@/lib/api";
import { AsOfDateProvider } from "./as-of-date";
import { ChatPane } from "./chat-pane";
import { DatasetProvider } from "./dataset-context";
import { DatasetSidebar } from "./dataset-sidebar";
import { Header } from "./header";
import { fromTranscript } from "./turn";
import { UploadPanel } from "./upload-panel";

export const dynamic = "force-dynamic";

/** Header over two panes: the Dataset sidebar (a drawer below `lg`) and the chat pane (Transcript + pinned composer). */
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chat = await getChat(id);
  if (!chat) notFound();
  return (
    <AsOfDateProvider chatId={chat.id} savedAsOf={chat.as_of_date}>
      <DatasetProvider
        chatId={chat.id}
        initialReports={chat.cleaning_reports ?? []}
        initialProfile={chat.schema_profile}
        initialNotes={chat.dataset_notes ?? ""}
        initialTurnCount={chat.transcript.length}
      >
        <div className="flex h-[calc(100dvh-0.375rem)] flex-col">
          <Header chatId={chat.id} />
          <main className="flex min-h-0 flex-1">
            <DatasetSidebar>
              <UploadPanel chatId={chat.id} />
            </DatasetSidebar>
            <ChatPane chatId={chat.id} initialTurns={chat.transcript.map(fromTranscript)} />
          </main>
        </div>
      </DatasetProvider>
    </AsOfDateProvider>
  );
}
