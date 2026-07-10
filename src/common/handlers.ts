import { Authenticate, generateJWTToken, resetPassword } from "auth";
import { getDataset, updateDataset } from "kv";
import { setSettings } from "@init";
import { getClNormalConfig, getClWarpConfig } from "@clash/configs";
import { getSbCustomConfig, getSbWarpConfig } from "@sing-box/configs";
import { getXrCustomConfigs, getXrWarpConfigs } from "@xray/configs";
import { fetchWarpAccounts } from "@warp";
import { VlOverWSHandler } from "@vless";
import { TrOverWSHandler } from "@trojan";
import JSZip from "jszip";
import { HttpStatus, respond } from "@common";
// 在 handlers.ts 顶部导入必要的依赖
import { getCloudflareConfig, saveCloudflareConfig, type CloudflareConfig } from 'kv';

// 添加接口定义
interface GraphQLResponse {
    data?: {
        viewer?: {
            accounts?: Array<{
                pagesFunctionsInvocationsAdaptiveGroups?: Array<{ sum?: { requests?: number } }>;
                workersInvocationsAdaptive?: Array<{ sum?: { requests?: number } }>;
                kvOperationsAdaptiveGroups?: Array<{
                    dimensions?: { namespaceId?: string; actionType?: string };
                    sum?: { requests?: number };
                }>;
            }>;
        };
    };
    errors?: Array<{ message: string }>;
}

interface KVNamespacesResponse {
    result?: Array<{ id: string; title: string }>;
}

// 默认限制常量
const CLOUDFLARE_REQUESTS_LIMIT = 100000;
const KV_READ_LIMIT = 100000;
const KV_WRITE_LIMIT = 1000;

async function getCloudflareUsage(env: Env): Promise<Response> {
    const config = await getCloudflareConfig(env);
    const { accountId, apiToken, email, globalApiKey } = config;

    if (!accountId || (!apiToken && (!email || !globalApiKey))) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Missing Cloudflare credentials', {
            pages: 0, workers: 0, total: 0, percentage: 0, limit: CLOUDFLARE_REQUESTS_LIMIT
        });
    }

    try {
        const API = 'https://api.cloudflare.com/client/v4';
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        if (apiToken) {
            headers['Authorization'] = `Bearer ${apiToken}`;
        } else {
            headers['X-AUTH-EMAIL'] = email;
            headers['X-AUTH-KEY'] = globalApiKey;
        }

        const now = new Date();
        now.setUTCHours(0, 0, 0, 0);
        const query = {
            query: `query getBillingMetrics($AccountID: String!, $filter: AccountWorkersInvocationsAdaptiveFilter_InputObject) {
                viewer { accounts(filter: {accountTag: $AccountID}) {
                    pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: $filter) { sum { requests } }
                    workersInvocationsAdaptive(limit: 10000, filter: $filter) { sum { requests } }
                } }
            }`,
            variables: { AccountID: accountId, filter: { datetime_geq: now.toISOString(), datetime_leq: new Date().toISOString() } }
        };

        const res = await fetch(`${API}/graphql`, {
            method: 'POST',
            headers,
            body: JSON.stringify(query)
        });

        if (!res.ok) throw new Error(`GraphQL request failed: ${res.status}`);
        const result = await res.json() as GraphQLResponse;
        if (result.errors?.length) throw new Error(result.errors[0].message);

        const acc = result?.data?.viewer?.accounts?.[0];
        if (!acc) throw new Error('No account data');

        const pages = acc.pagesFunctionsInvocationsAdaptiveGroups?.reduce((s: number, g: any) => s + (g.sum?.requests || 0), 0) || 0;
        const workers = acc.workersInvocationsAdaptive?.reduce((s: number, g: any) => s + (g.sum?.requests || 0), 0) || 0;
        const total = pages + workers;
        const percentage = Math.min((total / CLOUDFLARE_REQUESTS_LIMIT) * 100, 100);

        return respond(true, HttpStatus.OK, '', { pages, workers, total, percentage: percentage.toFixed(2), limit: CLOUDFLARE_REQUESTS_LIMIT });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, message, { pages: 0, workers: 0, total: 0, percentage: 0, limit: CLOUDFLARE_REQUESTS_LIMIT });
    }
}

async function getKvUsage(env: Env): Promise<Response> {
    const config = await getCloudflareConfig(env);
    const { accountId, apiToken, email, globalApiKey } = config;

    if (!accountId || (!apiToken && (!email || !globalApiKey))) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Missing Cloudflare credentials', {
            readTotal: 0, writeTotal: 0, readPercentage: 0, writePercentage: 0, details: []
        });
    }

    try {
        const API = 'https://api.cloudflare.com/client/v4';
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        if (apiToken) {
            headers['Authorization'] = `Bearer ${apiToken}`;
        } else {
            headers['X-AUTH-EMAIL'] = email;
            headers['X-AUTH-KEY'] = globalApiKey;
        }

        // 获取所有 KV 命名空间
        const nsRes = await fetch(`${API}/accounts/${accountId}/storage/kv/namespaces?per_page=100`, { headers });
        if (!nsRes.ok) throw new Error(`Failed to list KV namespaces: ${nsRes.status}`);
        const nsData = await nsRes.json() as KVNamespacesResponse;
        const namespaceMap: Record<string, string> = {};
        nsData.result?.forEach((ns: any) => { namespaceMap[ns.id] = ns.title; });

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
            variables: { accountTag: accountId, start: today, end: today }
        };

        const res = await fetch(`${API}/graphql`, {
            method: 'POST',
            headers,
            body: JSON.stringify(query)
        });

        if (!res.ok) throw new Error(`GraphQL KV request failed: ${res.status}`);
        const result = await res.json() as GraphQLResponse;
        if (result.errors?.length) throw new Error(result.errors[0].message);

        const rawData = result?.data?.viewer?.accounts?.[0]?.kvOperationsAdaptiveGroups || [];
        let readTotal = 0, writeTotal = 0;
        const detailsMap = new Map<string, { namespaceId: string; namespaceName: string; read: number; write: number; delete: number; list: number }>();

        // 初始化所有命名空间
        Object.keys(namespaceMap).forEach(id => {
            detailsMap.set(id, { namespaceId: id, namespaceName: namespaceMap[id], read: 0, write: 0, delete: 0, list: 0 });
        });

        for (const item of rawData) {
            const action = item.dimensions?.actionType;
            const count = Number(item.sum?.requests) || 0;
            const nsId = item.dimensions?.namespaceId;
            if (!detailsMap.has(nsId)) {
                detailsMap.set(nsId, { namespaceId: nsId, namespaceName: nsId, read: 0, write: 0, delete: 0, list: 0 });
            }
            const entry = detailsMap.get(nsId)!;
            if (action === 'read') { readTotal += count; entry.read += count; }
            else if (action === 'write') { writeTotal += count; entry.write += count; }
            else if (action === 'delete') entry.delete += count;
            else if (action === 'list') entry.list += count;
        }

        const readPercentage = Math.min((readTotal / KV_READ_LIMIT) * 100, 100);
        const writePercentage = Math.min((writeTotal / KV_WRITE_LIMIT) * 100, 100);

        return respond(true, HttpStatus.OK, '', {
            readTotal,
            writeTotal,
            readPercentage: Number(readPercentage.toFixed(2)),
            writePercentage: Number(writePercentage.toFixed(2)),
            readLimit: KV_READ_LIMIT,
            writeLimit: KV_WRITE_LIMIT,
            details: Array.from(detailsMap.values())
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, message, {
            readTotal: 0, writeTotal: 0, readPercentage: 0, writePercentage: 0, details: []
        });
    }
}

async function getCloudflareConfigHandler(env: Env): Promise<Response> {
    const config = await getCloudflareConfig(env);
    return respond(true, HttpStatus.OK, '', config);
}

async function updateCloudflareConfig(request: Request, env: Env): Promise<Response> {
    const auth = await Authenticate(request, env);
    if (!auth) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized');

    const config = await request.json() as CloudflareConfig;
    // 只检查是否为字符串，允许空字符串（用于清除配置）
    if (typeof config.accountId !== 'string') {
		return respond(false, HttpStatus.BAD_REQUEST, 'Invalid accountId');
	}
    // 允许配置为空（清除）
    await saveCloudflareConfig(env, {
        accountId: config.accountId || '',
        apiToken: config.apiToken || '',
        email: config.email || '',
        globalApiKey: config.globalApiKey || ''
    });
    return respond(true, HttpStatus.OK, 'Cloudflare config updated');
}

interface BackgroundConfig {
    image: string;
    position: string;
    opacity: number;
}

export async function handleWebsocket(request: Request): Promise<Response> {
    const { pathName } = globalThis.globalConfig;
    const encodedPathConfig = pathName.replace("/", "");

    try {
        const { protocol, mode, panelIPs } = JSON.parse(atob(encodedPathConfig));
        globalThis.wsConfig = {
            ...globalThis.wsConfig,
            wsProtocol: protocol,
            proxyMode: mode,
            panelIPs: panelIPs
        };

        switch (protocol) {
            case 'vl':
                return await VlOverWSHandler(request);

            case 'tr':
                return await TrOverWSHandler(request);

            default:
                return await fallback(request);
        }

    } catch (error) {
        return new Response('Failed to parse WebSocket path config', { status: HttpStatus.BAD_REQUEST });
    }
}

export async function handlePanel(request: Request, env: Env): Promise<Response> {
    const { pathName } = globalThis.globalConfig;

    switch (pathName) {
        case '/panel':
            return await renderPanel(request, env);

        case '/panel/settings':
            return await getSettings(request, env);

        case '/panel/update-settings':
            return await updateSettings(request, env);

        case '/panel/reset-settings':
            return await resetSettings(request, env);

        case '/panel/reset-password':
            return await resetPassword(request, env);

        case '/panel/my-ip':
            return await getMyIP(request);

        case '/panel/update-warp':
            return await updateWarpConfigs(request, env);

        case '/panel/get-warp-configs':
            return await getWarpConfigs(request, env);
            
        // 在 handlePanel 的 switch 中添加
		case '/panel/background-config':
			if (request.method === 'GET') {
				return await getBackgroundConfig(env);
			} else if (request.method === 'POST') {
				return await updateBackgroundConfig(request, env);
			} else {
				return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed');
			}

		case '/panel/reset-background':
			if (request.method === 'POST') {
				return await resetBackgroundConfig(request, env);
			} else {
				return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed');
			}
			
		// 添加路由处理
		case '/panel/cloudflare-usage':
			if (request.method === 'GET') {
				return await getCloudflareUsage(env);
			}
			return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed');

		case '/panel/kv-usage':
			if (request.method === 'GET') {
				return await getKvUsage(env);
			}
			return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed');

		case '/panel/cloudflare-config':
			if (request.method === 'GET') {
				return await getCloudflareConfigHandler(env);
			} else if (request.method === 'POST') {
				return await updateCloudflareConfig(request, env);
			}
			return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed');

        default:
            return await fallback(request);
    }
}

// 默认背景配置
const defaultBackground = {
    image: 'https://framagit.org/Falcon/Source/-/raw/main/background/Toomi_15.jpg?ref_type=heads',
    position: 'left',
    opacity: 0.85
};

async function getBackgroundConfig(env: Env): Promise<Response> {
    let config = await env.kv.get('backgroundConfig', { type: 'json' });
    if (!config) {
        // 若不存在，写入默认值并返回
        await env.kv.put('backgroundConfig', JSON.stringify(defaultBackground));
        config = defaultBackground;
    }
    return respond(true, HttpStatus.OK, '', config);
}

async function updateBackgroundConfig(request: Request, env: Env): Promise<Response> {
    const auth = await Authenticate(request, env);
    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized');
    }
    const body = await request.json() as { image: string; position: string; opacity: number };
    const { image, position, opacity } = body;
    if (!image || typeof position !== 'string' || typeof opacity !== 'number' || opacity < 0 || opacity > 1) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Invalid config');
    }
    const config = { image, position, opacity };
    await env.kv.put('backgroundConfig', JSON.stringify(config));
    return respond(true, HttpStatus.OK, 'Background config updated', config);
}

async function resetBackgroundConfig(request: Request, env: Env): Promise<Response> {
    const auth = await Authenticate(request, env);
    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized');
    }
    await env.kv.put('backgroundConfig', JSON.stringify(defaultBackground));
    return respond(true, HttpStatus.OK, 'Background reset to default', defaultBackground);
}

export async function renderError(error: any): Promise<Response> {
    const message = error instanceof Error ? error.message : String(error);
    const html = await decompressHtml(__ERROR_HTML_CONTENT__, true) as string;
    const errorPage = html.replace('__ERROR_MESSAGE__', message);

    return new Response(errorPage, {
        status: HttpStatus.OK,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
    const { pathName } = globalThis.globalConfig;

    if (pathName === '/login') {
        return await renderLogin(request, env);
    }

    if (pathName === '/login/authenticate') {
        return await generateJWTToken(request, env);
    }

    return await fallback(request);
}

export function logout(): Response {
    return respond(true, HttpStatus.OK, 'Successfully logged out!', null, {
        'Set-Cookie': 'jwtToken=; Secure; SameSite=None; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'Content-Type': 'text/plain'
    });
}

export async function handleSubscriptions(request: Request, env: Env): Promise<Response> {
    await setSettings(request, env);
    const {
        globalConfig: { pathName },
        httpConfig: { client, subPath }
    } = globalThis;

    switch (pathName) {
        case `/sub/normal/${subPath}`:
            switch (client) {
                case 'xray':
                    return await getXrCustomConfigs(false);

                case 'sing-box':
                    return await getSbCustomConfig(false);

                case 'clash':
                    return await getClNormalConfig();

                default:
                    break;
            }

        case `/sub/fragment/${subPath}`:
            switch (client) {
                case 'xray':
                    return await getXrCustomConfigs(true);

                case 'sing-box':
                    return await getSbCustomConfig(true);

                default:
                    break;
            }

        case `/sub/warp/${subPath}`:
            switch (client) {
                case 'xray':
                    return await getXrWarpConfigs(request, env, false, false);

                case 'sing-box':
                    return await getSbWarpConfig(request, env);

                case 'clash':
                    return await getClWarpConfig(request, env, false);

                default:
                    break;
            }

        case `/sub/warp-pro/${subPath}`:
            switch (client) {
                case 'xray':
                    return await getXrWarpConfigs(request, env, true, false);

                case 'xray-knocker':
                    return await getXrWarpConfigs(request, env, true, true);

                case 'clash':
                    return await getClWarpConfig(request, env, true);

                default:
                    break;
            }

        default:
            return await fallback(request);
    }
}

async function updateSettings(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'PUT') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const auth = await Authenticate(request, env);

    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    const proxySettings = await updateDataset(request, env);
    return respond(true, HttpStatus.OK, '', proxySettings);
}

async function resetSettings(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed!');
    }

    const auth = await Authenticate(request, env);

    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    try {
        const { settings } = globalThis;
        await env.kv.put("proxySettings", JSON.stringify(settings));
        return respond(true, HttpStatus.OK, '', settings);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(error);
        throw new Error(`An error occurred while updating KV: ${message}`);
    }
}

async function getSettings(request: Request, env: Env): Promise<Response> {
    const isPassSet = Boolean(await env.kv.get('pwd'));
    const auth = await Authenticate(request, env);

    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.', { isPassSet });
    }

    const dataset = await getDataset(request, env);
    const { subPath } = globalThis.httpConfig;

    const data = {
        proxySettings: dataset.settings,
        isPassSet,
        subPath: subPath
    };

    return respond(true, HttpStatus.OK, undefined, data);
}

export async function fallback(request: Request): Promise<Response> {
    const { fallbackDomain } = globalThis.globalConfig;
    const { url, method, headers, body } = request;

    const newURL = new URL(url);
    newURL.hostname = fallbackDomain;
    newURL.protocol = 'https:';
    const newRequest = new Request(newURL.toString(), {
        method,
        headers,
        body,
        redirect: 'manual'
    });

    return await fetch(newRequest);
}

async function getMyIP(request: Request): Promise<Response> {
    const ip = await request.text();

    try {
        const response = await fetch(`http://ip-api.com/json/${ip}?nocache=${Date.now()}`);
        const geoLocation = await response.json();

        return respond(true, HttpStatus.OK, '', geoLocation);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Error fetching IP address:', error);
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error fetching IP address: ${message}`)
    }
}

async function getWarpConfigs(request: Request, env: Env): Promise<Response> {
    const {
        httpConfig: { client },
        dict: { _project_ }
    } = globalThis;

    const isPro = client === 'amnezia';
    const auth = await Authenticate(request, env);

    if (!auth) {
        return new Response('Unauthorized or expired session.', { status: HttpStatus.UNAUTHORIZED });
    }

    const { warpAccounts, settings } = await getDataset(request, env);
    const { warpIPv6, publicKey, privateKey } = warpAccounts[0];
    const {
        warpEndpoints,
        warpRemoteDNS,
        amneziaNoiseCount,
        amneziaNoiseSizeMin,
        amneziaNoiseSizeMax
    } = settings;

    const zip = new JSZip();
    const trimLines = (str: string) => str.split("\n").map(line => line.trim()).join("\n");

    try {
        warpEndpoints?.forEach((endpoint, index) => {
            const config =
                `[Interface]
                PrivateKey = ${privateKey}
                Address = 172.16.0.2/32, ${warpIPv6}
                DNS = ${warpRemoteDNS}
                MTU = 1280
                ${isPro ?
                    `Jc = ${amneziaNoiseCount}
                    Jmin = ${amneziaNoiseSizeMin}
                    Jmax = ${amneziaNoiseSizeMax}
                    S1 = 0
                    S2 = 0
                    H1 = 0
                    H2 = 0
                    H3 = 0
                    H4 = 0`
                    : ''
                }
                [Peer]
                PublicKey = ${publicKey}
                AllowedIPs = 0.0.0.0/0, ::/0
                Endpoint = ${endpoint}
                PersistentKeepalive = 25`;

            zip.file(`${_project_}-Warp-${index + 1}.conf`, trimLines(config));
        });

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const arrayBuffer = await zipBlob.arrayBuffer();

        return new Response(arrayBuffer, {
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="${_project_}-Warp-${isPro ? "Pro-" : ""}configs.zip"`,
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(`Error generating ZIP file: ${message}`, { status: HttpStatus.INTERNAL_SERVER_ERROR });
    }
}

export async function serveIcon(): Promise<Response> {
    const faviconBase64 = __ICON__;
    const body = Uint8Array.from(atob(faviconBase64), c => c.charCodeAt(0));

    return new Response(body, {
        headers: {
            'Content-Type': 'image/x-icon',
            'Cache-Control': 'public, max-age=86400',
        }
    });
}

async function renderPanel(request: Request, env: Env): Promise<Response> {
    const pwd = await env.kv.get('pwd');

    if (pwd) {
        const auth = await Authenticate(request, env);
        if (!auth) {
            const { urlOrigin } = globalThis.httpConfig;
            return Response.redirect(`${urlOrigin}/login`, 302);
        }
    }

    const html = await decompressHtml(__PANEL_HTML_CONTENT__, false);
    return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}

async function renderLogin(request: Request, env: Env): Promise<Response> {
    const auth = await Authenticate(request, env);
    if (auth) {
        const { urlOrigin } = globalThis.httpConfig;
        return Response.redirect(`${urlOrigin}/panel`, 302);
    }

    const html = await decompressHtml(__LOGIN_HTML_CONTENT__, false);
    return new Response(html, {
        headers: {
            'Content-Type': 'text/html; charset=utf-8'
        }
    });
}

export async function renderSecrets(): Promise<Response> {
    const html = await decompressHtml(__SECRETS_HTML_CONTENT__, false);
    return new Response(html, {
        headers: {
            'Content-Type': 'text/html; charset=utf-8'
        }
    });
}

async function updateWarpConfigs(request: Request, env: Env): Promise<Response> {
    if (request.method === 'POST') {
        const auth = await Authenticate(request, env);

        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized.');
        }

        try {
            await fetchWarpAccounts(env);
            return respond(true, HttpStatus.OK, 'Warp configs updated successfully!');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(error);
            return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `An error occurred while updating Warp configs: ${message}`);
        }
    }

    return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowd.');
}

async function decompressHtml(content: string, asString: boolean): Promise<string | ReadableStream<Uint8Array>> {
    const bytes = Uint8Array.from(atob(content), c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));

    if (asString) {
        const decompressedArrayBuffer = await new Response(stream).arrayBuffer();
        const decodedString = new TextDecoder().decode(decompressedArrayBuffer);
        return decodedString;
    }

    return stream;
}
