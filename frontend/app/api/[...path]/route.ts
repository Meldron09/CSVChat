import type { NextRequest } from "next/server";

// Browser -> backend proxy: /api/<path> is forwarded to BACKEND_URL/<path>. Request and response bodies are
// streamed (never buffered), so 200MB uploads work and later tickets can reuse it for the SSE stream.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

async function proxy(req: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const headers = new Headers(req.headers);
  for (const h of ["host", "connection", "expect"]) headers.delete(h); // hop-by-hop; undici rejects `expect`
  const upstream = await fetch(`${BACKEND_URL}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    // @ts-expect-error `duplex` is required to stream a request body but is missing from the DOM typings
    duplex: "half",
    cache: "no-store",
  });
  return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
