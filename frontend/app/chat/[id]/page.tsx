import { notFound } from "next/navigation";
import { getChat } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chat = await getChat(id);
  if (!chat) notFound();
  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">CSVChat</h1>
      <p className="mt-2 text-sm text-zinc-500">Chat {chat.id}</p>
    </main>
  );
}
