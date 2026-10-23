import { notFound } from "next/navigation";
import { getChat } from "@/lib/api";
import { ChatPanel } from "./chat-panel";
import { UploadPanel } from "./upload-panel";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chat = await getChat(id);
  if (!chat) notFound();
  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <ChatPanel chatId={chat.id}>
        <UploadPanel chatId={chat.id} initialReports={chat.cleaning_reports ?? []} initialProfile={chat.schema_profile} initialNotes={chat.dataset_notes ?? ""} />
      </ChatPanel>
    </main>
  );
}
