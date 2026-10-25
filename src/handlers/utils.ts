import { HttpStatus } from '@common';
import { getGlobals } from '@settings';
import { getBackgroundConfig } from '@kv';

// utils.ts 的 fallback 中，在“代理到 fallback 域名”之前插入
export async function fallback(request: Request, env: Env): Promise<Response> {
    const { url, method, headers, body } = request;
    const { fallback } = getGlobals();

    // ===== 背景图代理 =====
    const { pathname } = new URL(url);
    if (pathname === '/background-image') {
        const cfg = await getBackgroundConfig(env);   // env 需传参
        if (cfg.image && /^https?:\/\//i.test(cfg.image)) {
            try {
                const r = await fetch(cfg.image, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                if (!r.ok) return new Response('Not found', { status: 404 });
                const nr = new Response(r.body, r);
                nr.headers.set('Cache-Control', 'public, max-age=86400');
                const contentType = r.headers.get('content-type') || 'image/jpeg';
                nr.headers.set('Content-Type', contentType);
                return nr;
            } catch {
                return new Response('Proxy error', { status: 500 });
            }
        }
        // 默认背景
        const defaultUrl = 'https://framagit.org/Falcon/Source/-/raw/main/background/Toomi_15.jpg?ref_type=heads';
        const r = await fetch(defaultUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const nr = new Response(r.body, r);
        nr.headers.set('Content-Type', 'image/jpeg');
        return nr;
    }
    // ===== 结束 =====

    if (!fallback) return new Response('Not Found', { status: HttpStatus.NOT_FOUND });

    const newURL = new URL(url);
    newURL.hostname = fallback;
    newURL.protocol = 'https:';
    const newRequest = new Request(newURL.toString(), {
        method,
        headers,
        body,
        redirect: 'manual'
    });

    return fetch(newRequest);
}