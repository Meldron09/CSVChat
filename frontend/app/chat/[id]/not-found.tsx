export default function ChatNotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Chat not found</h1>
      <p className="mt-2">
        No chat exists with this id. Check the link, or{" "}
        <a className="underline" href="/">start a new chat</a>.
      </p>
    </main>
  );
}
