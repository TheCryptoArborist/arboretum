import type { Context, Config } from '@netlify/edge-functions';

// These are the complete exceptions to the tester gate. Never use /guide/*.
export function publicGuidePaths(): string[] {
  return ['/player-guide', '/player-guide.html', '/player-guide/',
    '/guide/player-guide.css', '/guide/player-guide.js'];
}

export default async function publicPlayerGuide(request: Request, context: Context): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (!publicGuidePaths().includes(url.pathname)) return new Response('Not found', {status:404});
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
    if (url.pathname === '/player-guide/') return Response.redirect(`${url.origin}/player-guide${url.search}`,308);
    const original = await context.next();
    const headers = new Headers(original.headers);
    headers.set('Cache-Control','private, no-store, max-age=0');
    headers.set('Netlify-CDN-Cache-Control','no-store');
    headers.set('CDN-Cache-Control','no-store');
    headers.set('X-Content-Type-Options','nosniff');
    headers.set('X-Frame-Options','DENY');
    headers.set('Referrer-Policy','same-origin');
    // Only an inert handbook script is permitted. No wallets, APIs, frames or forms.
    headers.set('Content-Security-Policy',"default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (!['treegrow.xyz','www.treegrow.xyz'].includes(url.hostname)) headers.set('X-Robots-Tag','noindex, nofollow');
    else headers.delete('X-Robots-Tag');
    headers.delete('Set-Cookie'); headers.delete('ETag'); headers.delete('Last-Modified');
    return new Response(request.method === 'HEAD' ? null : original.body, {status:original.status, headers});
  } catch {
    return new Response('The player handbook is temporarily unavailable.', {status:503,headers:{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'}});
  }
}
export const config: Config = { path: publicGuidePaths() };
