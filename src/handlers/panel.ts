import type { PanelSettings, TelegramBot, KvSettings } from '#types/settings';
import { deployPages, deletePagesProject } from '@api/pages';
import { getUsage } from '@api/usage';
import { fetchWarpAccounts } from '@api/warp';
import { deployWorkers, deleteWorker } from '@api/workers';
import { resetPassword, logout, authenticate } from '@auth';
import { decompressGzipBase64, respond, HttpStatus, safeError } from '@common';
import { buildScript, updateMainSettings } from '@main';
import { getGlobals, getMainSettings, subscriptions, clients, getKvSettings, setSettings } from '@settings';
import { validateSettings } from '@validators';
import { fallback } from './utils';
import { setTelegramBot } from '@api/telegram';
import {
    getDataset, updateDataset,
    getCloudflareConfig, saveCloudflareConfig,
    getBackgroundConfig, saveBackgroundConfig, defaultBackground,
} from '@kv';
import type { CloudflareConfig } from '@kv';

export async function handlePanel(request: Request, env: Env): Promise<Response> {
    const { pathname } = getGlobals();
    const parts = pathname.split('/');
    const path = parts.slice(2).join('/');

    switch (path) {
        case 'panel':
            return renderPanel(request, env);

        case 'panel/settings':
            return getPanelSettings(request, env);

        case 'panel/update-settings':
            return updatePanelSettings(request, env);

        case 'panel/reset-settings':
            return resetPanelSettings(request, env);

        case 'panel/reset-password':
            return resetPassword(request, env);

        case 'panel/my-ip':
            return getMyIP(request);

        case 'panel/update-warp':
            return updateWarpConfigs(request, env);

        case 'panel/update-panel':
            return updatePanel(request, env);

        case 'panel/delete-panel':
            return deletePanel(request, env);

        case 'panel/usage':
            return getUsage(request, env);

        case 'panel/logout':
            return logout();

		case 'panel/cloudflare-usage':
			if (!await authenticate(request, env)) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized');
			return getCloudflareUsage(env);

		case 'panel/kv-usage':
			if (!await authenticate(request, env)) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized');
			return getKvUsage(env);
		case 'panel/cloudflare-config':
			if (request.method === 'GET')  return getCloudflareConfigHandler(request, env);
			if (request.method === 'POST') return updateCloudflareConfig(request, env);
			return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed');
		case 'panel/background-config':
			if (request.method === 'GET')  return getBackgroundConfigHandler(request, env);
			if (request.method === 'POST') return updateBackgroundConfig(request, env);
			return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed');
		case 'panel/reset-background':   return resetBackgroundConfig(request, env);
		case 'panel/dark-mode':          return updateDarkMode(request, env);
        
        default:
            return fallback(request, env);
    }
}

async function renderPanel(request: Request, env: Env): Promise<Response> {
    const pwd = await env.kv.get('pwd');
    if (pwd) {
        const auth = await authenticate(request, env);
        if (!auth) {
            const url = new URL('./login', request.url);
            return Response.redirect(url, 302);
        }
    }

    const bg = await getBackgroundConfig(env);
    const str = await decompressGzipBase64(PANEL_HTML_CONTENT);
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

async function updatePanel(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    try {
        const auth = await authenticate(request, env);
        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
        }

        const { deployType } = getGlobals();
        const script = await buildScript(true);
        if (deployType === 'pages') {
            await deployPages(script);
        } else {
            await deployWorkers(script);
        }

        return respond(true, HttpStatus.OK);
    } catch (error) {
        return respond(
            false,
            HttpStatus.INTERNAL_SERVER_ERROR,
            `Error occurred while upgrading panel: ${safeError(error)}`
        );
    }
}

async function deletePanel(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    try {
        const auth = await authenticate(request, env);
        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
        }

        const { deployType } = getGlobals();
        if (deployType === 'pages') {
            await deletePagesProject();
        } else {
            await deleteWorker();
        }

        return respond(true, HttpStatus.OK);
    } catch (error) {
        return respond(
            false,
            HttpStatus.INTERNAL_SERVER_ERROR,
            `Error occurred while deleting panel: ${safeError(error)}`
        );
    }
}

async function getPanelSettings(request: Request, env: Env): Promise<Response> {
    const isPassSet = Boolean(await env.kv.get('pwd'));

    try {
        const auth = await authenticate(request, env);
        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.', { isPassSet });
        }

        const { settings: kvSettings, telegramBot } = await getDataset(env);
        const mainSettings = getMainSettings();
        const data = {
            proxySettings: { ...kvSettings, ...mainSettings },
            telegramSettings: telegramBot,
            subscriptions,
            clients,
            isPassSet
        };

        return respond(true, HttpStatus.OK, undefined, data, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
    } catch (error) {
        console.log(error);
        return respond(
            false,
            HttpStatus.INTERNAL_SERVER_ERROR,
            `Error occurred while fetching settings: ${safeError(error)}`
        );
    }
}

async function updatePanelSettings(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'PUT') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    try {
        const auth = await authenticate(request, env);
        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
        }

        const newSettings: PanelSettings = await request.json();
        const errors = validateSettings(newSettings);
        if (errors) return respond(false, HttpStatus.BAD_REQUEST, 'Validation Error', errors);

        await Promise.all([
            updateDataset(env, newSettings),
            updateMainSettings(newSettings)
        ]);

        const { securePath } = getGlobals();
        if (newSettings.securePath !== securePath) {
            const bot: TelegramBot | null = await env.kv.get('telegramBot', { type: 'json' });
            if (bot) {
                await setTelegramBot(newSettings.securePath, bot.telegramBotToken);
            }
        }

        return respond(true, HttpStatus.OK, '');
    } catch (error) {
        console.log(error);
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, safeError(error));
    }
}

async function resetPanelSettings(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed!');
    }

    try {
        const auth = await authenticate(request, env);
        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
        }

        const [kvSettings, mainSettings] = await Promise.all([
            updateDataset(env),
            updateMainSettings(null)
        ]);

        return respond(true, HttpStatus.OK, '', { ...kvSettings, ...mainSettings });
    } catch (error) {
        console.log(error);
        return respond(
            false,
            HttpStatus.INTERNAL_SERVER_ERROR,
            `Error occurred while resetting settings: ${safeError(error)}`
        );
    }
}

async function getMyIP(request: Request): Promise<Response> {
    const ip = await request.text();

    try {
        const response = await fetch(`http://ip-api.com/json/${ip}?nocache=${Date.now()}`);
        const geoLocation = await response.json();
        return respond(true, HttpStatus.OK, '', geoLocation);
    } catch (error) {
        console.error('Error fetching IP address:', error);
        return respond(
            false,
            HttpStatus.INTERNAL_SERVER_ERROR,
            `Error fetching IP address: ${safeError(error)}`
        )
    }
}

async function updateWarpConfigs(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');

    try {
        const auth = await authenticate(request, env);
        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
        }

        await fetchWarpAccounts(env);
        return respond(true, HttpStatus.OK, 'Warp configs updated successfully!');
    } catch (error) {
        console.log(error);
        return respond(
            false,
            HttpStatus.INTERNAL_SERVER_ERROR,
            `An error occurred while updating Warp configs: ${safeError(error)}`
        );
    }
}

// ---- Cloudflare 用量 ----
const CF_REQ_LIMIT = 100000;
const KV_READ_LIMIT = 100000;
const KV_WRITE_LIMIT = 1000;

async function getCloudflareUsage(env: Env): Promise<Response> {
    const cfg = await getCloudflareConfig(env);
    if (!cfg.accountId || (!cfg.apiToken && (!cfg.email || !cfg.globalApiKey))) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Missing Cloudflare credentials',
            { pages: 0, workers: 0, total: 0, percentage: 0, limit: CF_REQ_LIMIT });
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiToken) headers['Authorization'] = `Bearer ${cfg.apiToken}`;
    else { headers['X-AUTH-EMAIL'] = cfg.email; headers['X-AUTH-KEY'] = cfg.globalApiKey; }

    const now = new Date(); now.setUTCHours(0, 0, 0, 0);
    const query = {
        query: `query getBillingMetrics($AccountID: String!, $filter: AccountWorkersInvocationsAdaptiveFilter_InputObject) {
            viewer { accounts(filter: {accountTag: $AccountID}) {
                pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: $filter) { sum { requests } }
                workersInvocationsAdaptive(limit: 10000, filter: $filter) { sum { requests } }
            } }
        }`,
        variables: { AccountID: cfg.accountId, filter: { datetime_geq: now.toISOString(), datetime_leq: new Date().toISOString() } }
    };

    try {
        const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
            method: 'POST', headers, body: JSON.stringify(query)
        });
        const result: any = await res.json();
        if (result.errors?.length) throw new Error(result.errors[0].message);
        const acc = result.data?.viewer?.accounts?.[0];
        const pages = acc?.pagesFunctionsInvocationsAdaptiveGroups?.reduce((s: number, g: any) => s + (g.sum?.requests || 0), 0) || 0;
        const workers = acc?.workersInvocationsAdaptive?.reduce((s: number, g: any) => s + (g.sum?.requests || 0), 0) || 0;
        const total = pages + workers;
        return respond(true, HttpStatus.OK, '', {
            pages, workers, total,
            percentage: Math.min((total / CF_REQ_LIMIT) * 100, 100).toFixed(2),
            limit: CF_REQ_LIMIT
        });
    } catch (e) {
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, safeError(e),
            { pages: 0, workers: 0, total: 0, percentage: 0, limit: CF_REQ_LIMIT });
    }
}

async function getKvUsage(env: Env): Promise<Response> {
    const cfg = await getCloudflareConfig(env);
    if (!cfg.accountId || (!cfg.apiToken && (!cfg.email || !cfg.globalApiKey))) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Missing Cloudflare credentials',
            { readTotal: 0, writeTotal: 0, details: [] });
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiToken) headers['Authorization'] = `Bearer ${cfg.apiToken}`;
    else { headers['X-AUTH-EMAIL'] = cfg.email; headers['X-AUTH-KEY'] = cfg.globalApiKey; }

    // 获取 namespace 列表
    const nsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/storage/kv/namespaces?per_page=100`, { headers });
    const nsData: any = await nsRes.json();
    const namespaceMap: Record<string, string> = {};
    (nsData.result || []).forEach((n: any) => { namespaceMap[n.id] = n.title; });

    const today = new Date().toISOString().split('T')[0];
    const query = {
        query: `query GetKVUsage($accountTag: String!, $start: Date!, $end: Date!) {
            viewer { accounts(filter: { accountTag: $accountTag }) {
                kvOperationsAdaptiveGroups(limit: 1000, filter: { date_geq: $start, date_leq: $end }) {
                    dimensions { namespaceId actionType }
                    sum { requests }
                }
            } }
        }`,
        variables: { accountTag: cfg.accountId, start: today, end: today }
    };

    try {
        const res = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers, body: JSON.stringify(query) });
        const result: any = await res.json();
        if (result.errors?.length) throw new Error(result.errors[0].message);

        const raw = result.data?.viewer?.accounts?.[0]?.kvOperationsAdaptiveGroups || [];
        let readTotal = 0, writeTotal = 0;
        const detailMap = new Map<string, { namespaceName: string; read: number; write: number; delete: number; list: number }>();
        Object.keys(namespaceMap).forEach(id => detailMap.set(id, { namespaceName: namespaceMap[id], read: 0, write: 0, delete: 0, list: 0 }));

        for (const item of raw) {
            const nsId = item.dimensions?.namespaceId; if (!nsId) continue;
            const action = item.dimensions?.actionType;
            const cnt = Number(item.sum?.requests) || 0;
            if (!detailMap.has(nsId)) detailMap.set(nsId, { namespaceName: nsId, read: 0, write: 0, delete: 0, list: 0 });
            const entry = detailMap.get(nsId)!;
            if (action === 'read') { readTotal += cnt; entry.read += cnt; }
            else if (action === 'write') { writeTotal += cnt; entry.write += cnt; }
            else if (action === 'delete') entry.delete += cnt;
            else if (action === 'list') entry.list += cnt;
        }

        return respond(true, HttpStatus.OK, '', {
            readTotal, writeTotal,
            readPercentage: Number(Math.min((readTotal / KV_READ_LIMIT) * 100, 100).toFixed(2)),
            writePercentage: Number(Math.min((writeTotal / KV_WRITE_LIMIT) * 100, 100).toFixed(2)),
            readLimit: KV_READ_LIMIT, writeLimit: KV_WRITE_LIMIT,
            details: Array.from(detailMap.entries()).map(([id, v]) => ({ namespaceId: id, ...v }))
        });
    } catch (e) {
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, safeError(e),
            { readTotal: 0, writeTotal: 0, details: [] });
    }
}

// ---- 配置读写 ----
async function getCloudflareConfigHandler(request: Request, env: Env): Promise<Response> {
    if (!await authenticate(request, env)) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized');
    return respond(true, HttpStatus.OK, '', await getCloudflareConfig(env));
}

async function updateCloudflareConfig(request: Request, env: Env): Promise<Response> {
    if (!await authenticate(request, env)) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized');
    const body: any = await request.json();
    const cfg: CloudflareConfig = {
        accountId: body.accountId || '', apiToken: body.apiToken || '',
        email: body.email || '', globalApiKey: body.globalApiKey || '',
        queryUrl: body.queryUrl || ''
    };
    await saveCloudflareConfig(env, cfg);
    return respond(true, HttpStatus.OK, 'Cloudflare config updated');
}

// ---- 背景 ----
async function getBackgroundConfigHandler(request: Request, env: Env): Promise<Response> {
    if (!await authenticate(request, env)) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized');
    return respond(true, HttpStatus.OK, '', await getBackgroundConfig(env));
}

async function updateBackgroundConfig(request: Request, env: Env): Promise<Response> {
    if (!await authenticate(request, env)) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized');
    const body: any = await request.json();
    const { image, position, opacity } = body;
    if (!image || typeof position !== 'string' || typeof opacity !== 'number' || opacity < 0 || opacity > 1) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Invalid config');
    }
    const saved = await saveBackgroundConfig(env, { image, position, opacity });
    return respond(true, HttpStatus.OK, 'Background updated', saved);
}

async function resetBackgroundConfig(request: Request, env: Env): Promise<Response> {
    if (!await authenticate(request, env)) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized');
    await env.kv.put('backgroundConfig', JSON.stringify(defaultBackground));
    return respond(true, HttpStatus.OK, 'Reset', defaultBackground);
}

// ---- 暗色模式 ----
async function updateDarkMode(request: Request, env: Env): Promise<Response> {
    if (!await authenticate(request, env)) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized');
    const { darkMode } = await request.json() as any;
    const settings = await env.kv.get('proxySettings', 'json') as KvSettings | null;
    const next = { ...(settings ?? getKvSettings()), darkMode: darkMode === true };
    await env.kv.put('proxySettings', JSON.stringify(next));
    await setSettings(env);   // ✅ 移到 return 之前
    return respond(true, HttpStatus.OK, 'Dark mode updated');
}