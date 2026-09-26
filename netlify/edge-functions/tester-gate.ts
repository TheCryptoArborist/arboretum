import type { Config, Context } from "@netlify/edge-functions";

declare const Netlify: { env: { get(name: string): string | undefined } };

// Only these files are public. Never add a wildcard for game JS, guides or APIs.
function publicPaths(): Set<string> {
  return new Set(["/", "/index.html", "/robots.txt", "/sitemap.xml",
    "/prelaunch/site.css", "/prelaunch/forest.jpg", "/prelaunch/hero.png",
    "/prelaunch/mark.png", "/prelaunch/ancient.jpg"]);
}
function secure(response: Response, publicPage = false): Response {
  const h = new Headers(response.headers);
  h.set("Cache-Control", "private, no-store, max-age=0");
  h.set("Netlify-CDN-Cache-Control", "no-store");
  h.set("CDN-Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Vary", "Cookie");
  if (!publicPage) h.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  h.delete("ETag"); h.delete("Last-Modified");
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers: h});
}
function publicCsp(response: Response): Response {
  const result = secure(response, true);
  result.headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  return result;
}
function htmlPage(message = "", configured = true, status = 200): Response {
  // All interpolated strings below are fixed server messages, never request input.
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Tester access | Arboretum</title><link rel="stylesheet" href="/prelaunch/site.css"><link rel="icon" href="/prelaunch/mark.png"></head><body><header class="header wrap"><a class="brand" href="/"><span class="brand-mark"><img src="/prelaunch/mark.png" alt="" width="52" height="52"></span><span>ARBORETUM<small>PRIVATE TESTING</small></span></a><a class="text-link" href="/">Back to preview ↗</a></header><main class="access"><section class="access-card"><p class="eyebrow">THE TESTER ENTRANCE</p><h1>Welcome back<br>to your garden.</h1><p>This entrance is for invited testers. Public access will be announced through the community.</p>${message ? `<p class="error" role="alert">${message}</p>` : ""}${configured ? `<form method="post" action="/tester-access" autocomplete="on"><label for="password">Tester access code</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256" spellcheck="false" autocapitalize="none"><button class="button primary" type="submit">Enter the testing garden <span aria-hidden="true">→</span></button></form>` : `<p class="error">Tester access has not been activated on this preview. The existing live testing site has not been changed.</p>`}<p class="micro">Use only the website access code provided by the project. Never enter your wallet recovery phrase or private key here.</p><a class="text-link back" href="https://t.me/cryptoarborist" rel="noopener noreferrer" target="_blank">Community &amp; launch updates ↗</a><form class="logout-form" method="post" action="/tester-logout"><button class="button" type="submit">End this browser's tester session</button></form></section></main></body></html>`;
  const response = publicCsp(new Response(html, {status, headers: {"Content-Type": "text/html; charset=utf-8"}}));
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  // Native form POSTs use Origin: null under no-referrer. Keep same-origin
  // metadata for login/logout without sending referrers to other sites.
  response.headers.set("Referrer-Policy", "same-origin");
  return response;
}
function text(message: string, status: number): Response {
  return secure(new Response(message, {status, headers: {"Content-Type": "text/plain; charset=utf-8"}}));
}
function b64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function unb64(input: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) throw new Error("Invalid encoding");
  return Uint8Array.from(atob(input.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
}
async function sessionKey(secret: string, password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(`${secret}\0${password}`), {name:"HMAC",hash:"SHA-256"}, false, ["sign", "verify"]);
}
async function samePassword(input: string, expected: string): Promise<boolean> {
  const a = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)));
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
async function validSession(request: Request, key: CryptoKey, now: number): Promise<boolean> {
  const cookies = request.headers.get("cookie") ?? "";
  if (cookies.length > 8192) return false;
  const values = cookies.split(";").map(x => x.trim()).filter(x => x.startsWith("__Host-arboretum_tester="));
  if (values.length !== 1) return false;
  const token = values[0].slice("__Host-arboretum_tester=".length);
  if (token.length > 2048) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  try {
    const sig = unb64(parts[1]);
    if (sig.length !== 32 || !await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(parts[0]))) return false;
    const payload = JSON.parse(new TextDecoder().decode(unb64(parts[0])));
    return payload.v === 1 && payload.host === new URL(request.url).host &&
      Number.isSafeInteger(payload.exp) && Number.isSafeInteger(payload.iat) &&
      payload.iat <= now && payload.exp > now && payload.exp - payload.iat === 43_200;
  } catch { return false; }
}
function sameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin &&
    !["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "");
}
async function boundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    length += chunk.value.length;
    if (length > 2048) { await reader.cancel(); return null; }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  return new TextDecoder().decode(bytes);
}

export default async function testerGate(request: Request, context: Context): Promise<Response> {
  try {
    const url = new URL(request.url), path = url.pathname;
    if (path.includes("%") || path.includes("\\") || path.includes("//")) return text("Invalid path", 400);
    if (publicPaths().has(path)) {
      if (!["GET","HEAD"].includes(request.method)) return text("Method not allowed", 405);
      return publicCsp(await context.next());
    }
    const password = Netlify.env.get("ARBORETUM_TESTER_PASSWORD") ?? "";
    const secret = Netlify.env.get("ARBORETUM_SESSION_SECRET") ?? "";
    const configured = password.length >= 32 && password.length <= 256 && secret.length >= 64;
    const now = Math.floor(Date.now() / 1000);
    if (path === "/tester-logout") {
      if (request.method !== "POST" || !sameOrigin(request)) return text("Not permitted", 403);
      const response = secure(Response.redirect(`${url.origin}/tester-access`, 303));
      response.headers.set("Set-Cookie", "__Host-arboretum_tester=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
      return response;
    }
    if (["/tester-access", "/tester-access/", "/tester-access.html"].includes(path)) {
      if (["GET", "HEAD"].includes(request.method)) {
        const page = htmlPage("", configured);
        return request.method === "HEAD" ? new Response(null, {status:page.status, headers:page.headers}) : page;
      }
      if (request.method !== "POST") return text("Method not allowed", 405);
      if (!sameOrigin(request)) return text("Not permitted", 403);
      if (!configured) return htmlPage("", false, 503);
      if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get("content-type") ?? "")) return text("Unsupported content type", 415);
      const body = await boundedBody(request);
      if (body === null) return text("Request too large", 413);
      const values = new URLSearchParams(body).getAll("password");
      if (values.length !== 1 || values[0].length > 256 || !await samePassword(values[0], password)) {
        // High-entropy invite codes are required. A shared code is not individual identity.
        return htmlPage("That access code was not accepted. Please check the code from the project.", true, 401);
      }
      const key = await sessionKey(secret, password);
      const payload = b64(new TextEncoder().encode(JSON.stringify({v:1, host:url.host, iat:now, exp:now+43_200, nonce:crypto.randomUUID()})));
      const signature = b64(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(payload))));
      const response = secure(Response.redirect(`${url.origin}/game.html`, 303));
      response.headers.set("Set-Cookie", `__Host-arboretum_tester=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`);
      return response;
    }
    if (!configured) return text("Tester access is not configured on this deployment.", 503);
    if (!await validSession(request, await sessionKey(secret,password), now)) {
      if (request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html"))
        return secure(Response.redirect(`${url.origin}/tester-access`,303));
      return text("Tester authorization required",401);
    }
    if (path === "/play" || path === "/play/") return secure(Response.redirect(`${url.origin}/game.html`,302));
    // Protected content is served only after authentication; never opt into edge caching.
    return secure(await context.next());
  } catch {
    // Fail closed, and never log request bodies, passwords, or session cookies.
    return text("Tester access is temporarily unavailable.",503);
  }
}

export const config: Config = { path: "/*" };
