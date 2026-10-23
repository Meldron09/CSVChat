// Server-side only: the frontend's server talks to the backend over the compose network.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function createChat(): Promise<{ id: string }> {
  const res = await fetch(`${BACKEND_URL}/chats`, { method: "POST", cache: "no-store" });
  if (!res.ok) throw new Error(`POST /chats failed: ${res.status}`);
  return res.json();
}

/** Returns null when the Chat does not exist. */
export async function getChat(id: string): Promise<{ id: string } | null> {
  const res = await fetch(`${BACKEND_URL}/chats/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /chats/${id} failed: ${res.status}`);
  return res.json();
}
