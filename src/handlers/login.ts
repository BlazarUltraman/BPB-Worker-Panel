import { generateJWTToken, authenticate } from '@auth';
import { decompressGzipBase64 } from '@common';
import { getGlobals } from '@settings';
import { fallback } from './utils';
import { getBackgroundConfig } from '@kv';

export async function handleLogin(request: Request, env: Env): Promise<Response> {
    const { pathname } = getGlobals();
    const parts = pathname.split('/');
    const path = parts.slice(2).join('/');

    switch (path) {
        case 'login':
            return renderLogin(request, env);

        case 'login/authenticate':
            return generateJWTToken(request, env);

        default:
            return fallback(request, env);
    }
}

async function renderLogin(request: Request, env: Env): Promise<Response> {
    const auth = await authenticate(request, env);
    if (auth) {
        const panelURL = new URL('./panel', request.url);
        return Response.redirect(panelURL, 302);
    }

    const bg = await getBackgroundConfig(env);
    const str = await decompressGzipBase64(LOGIN_HTML_CONTENT);
    let html = str.replaceAll('__ICON__', ICON_CONTENT);

    let bgUrl = bg.image;
    if (/^https?:\/\//i.test(bgUrl)) bgUrl = `/background-image?v=${bg.version || 1}`;

    html = html.replace(/<body([^>]*)>/, (_m, attrs) => {
        const style = `background-size:cover;background-position:${bg.position};background-attachment:fixed;`;
        const bgScript = `<script>setTimeout(function(){document.body.style.setProperty('background-image','url(${JSON.stringify(bgUrl)})','important');},5);</script>`;
        return `<body${attrs} style="${style}">${bgScript}`;
    });

    html = html.replace('</head>', `<style>.container-big{opacity:${bg.opacity} !important;}</style></head>`);

    return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    });
}