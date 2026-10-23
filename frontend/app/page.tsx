import { redirect } from "next/navigation";
import { createChat } from "@/lib/api";

export const dynamic = "force-dynamic";

// Opening the app creates a Chat and puts its id in the URL.
export default async function Home() {
  const { id } = await createChat();
  redirect(`/chat/${id}`);
}
