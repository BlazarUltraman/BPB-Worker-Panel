import { fetchWarpAccounts } from '@warp';
import { getDomain, resolveDNS } from '@utils';
import { base64DecodeUtf8 } from '@common';

// kv.ts 顶部添加
async function fetchLinkIPs(url: string): Promise<string[]> {
    if (!url) return [];
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        return text.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
    } catch (e) {
        console.error('Failed to fetch link IPs:', e);
        return [];
    }
}

// kv.ts 中新增
async function fetchMultipleLinkIPs(input: string): Promise<string[]> {
    if (!input) return [];
    // 按逗号、换行分割，去除空串
    const urls = input.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (urls.length === 0) return [];

    const allIPs: string[] = [];
    for (const url of urls) {
        try {
            const ips = await fetchLinkIPs(url);
            allIPs.push(...ips);
        } catch (e) {
            console.error(`Failed to fetch from ${url}:`, e);
            // 继续尝试其他链接
        }
    }
    // 去重
    return [...new Set(allIPs)];
}

export async function getDataset(
    request: Request,
    env: Env
): Promise<{ settings: Settings, warpAccounts: WarpAccount[] }> {
    const { httpConfig: { panelVersion }, settings } = globalThis;
    let proxySettings: Settings | null, warpAccounts: WarpAccount[] | null;

    try {
        proxySettings = await env.kv.get("proxySettings", { type: 'json' });
        warpAccounts = await env.kv.get('warpAccounts', { type: 'json' });

        if (!proxySettings) {
            await env.kv.put("proxySettings", JSON.stringify(settings));
            proxySettings = settings;
        }

        if (!warpAccounts) {
            warpAccounts = await fetchWarpAccounts(env);
        }

        if (panelVersion !== proxySettings.panelVersion) {
            proxySettings = await updateDataset(request, env);
        }

        return {
            settings: proxySettings,
            warpAccounts
        };
    } catch (error) {
        console.log(error);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`An error occurred while getting KV: ${message}`);
    }
}

export async function updateDataset(request: Request, env: Env): Promise<Settings> {
    const { settings, httpConfig: { panelVersion } } = globalThis;
    const newSettings: Settings | null = request.method === 'PUT' ? await request.json() : null;
    let currentSettings: Settings | null;

    try {
        currentSettings = await env.kv.get("proxySettings", { type: 'json' });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(message);
        throw new Error(`An error occurred while getting current KV settings: ${message}`);
    }

    const getParam = async <T extends keyof Settings>(
        field: keyof Settings,
        callback?: (value: Settings[T]) => any | Promise<any>
    ) => {
        const value = newSettings?.[field] ?? currentSettings?.[field] ?? settings[field];
        return callback ? await callback(value) : value;
    };

    const fields: Array<
        [keyof Settings] |
        [keyof Settings, keyof Settings, (key: keyof Settings) => any | Promise<any>]
    > = [
            ["remoteDNS"],
            ["remoteDnsHost", "remoteDNS", getDnsParams],
            ["localDNS"],
            ["antiSanctionDNS"],
            ["enableIPv6"],
            ["fakeDNS"],
            ["logLevel"],
            ["allowLANConnection"],
            ["proxyIPMode"],
            ["proxyIPs"],
            ["prefixes"],
            ["outProxy"],
            ["outProxyParams", "outProxy", extractProxyParams],
            ["cleanIPs"],
            ["customCdnAddrs"],
            ["customCdnHost"],
            ["customCdnSni"],
            ["bestVLTRInterval"],
            ["VLConfigs"],
            ["TRConfigs"],
            ["ports"],
            ["fingerprint"],
            ["enableTFO"],
            ["fragmentMode"],
            ["fragmentLengthMin"],
            ["fragmentLengthMax"],
            ["fragmentIntervalMin"],
            ["fragmentIntervalMax"],
            ["fragmentMaxSplitMin"],
            ["fragmentMaxSplitMax"],
            ["fragmentPackets"],
            ["bypassIran"],
            ["bypassChina"],
            ["bypassRussia"],
            ["bypassOpenAi"],
            ["bypassGoogleAi"],
            ["bypassMicrosoft"],
            ["bypassOracle"],
            ["bypassDocker"],
            ["bypassAdobe"],
            ["bypassEpicGames"],
            ["bypassIntel"],
            ["bypassAmd"],
            ["bypassNvidia"],
            ["bypassAsus"],
            ["bypassHp"],
            ["bypassLenovo"],
            ["blockAds"],
            ["blockPorn"],
            ["blockUDP443"],
            ["blockMalware"],
            ["blockPhishing"],
            ["blockCryptominers"],
            ["customBypassRules"],
            ["customBlockRules"],
            ["customBypassSanctionRules"],
            ["warpRemoteDNS"],
            ["warpEndpoints"],
            ["bestWarpInterval"],
            ["xrayUdpNoises"],
            ["knockerNoiseMode"],
            ["noiseCountMin"],
            ["noiseCountMax"],
            ["noiseSizeMin"],
            ["noiseSizeMax"],
            ["noiseDelayMin"],
            ["noiseDelayMax"],
            ["amneziaNoiseCount"],
            ["amneziaNoiseSizeMin"],
            ["amneziaNoiseSizeMax"],
            ["linkUrl"]
        ];

    const entries = await Promise.all(
        fields.map(async ([key, callbackKey, callbackFunc]) => {
            return [key, await getParam(callbackKey ?? key, callbackFunc)];
        })
    );

    const updatedSettings: Settings = {
        ...Object.fromEntries(entries),
        panelVersion: panelVersion
    };
    
    // 处理 linkUrl -> linkIPs
	const linkUrl = newSettings?.linkUrl ?? currentSettings?.linkUrl ?? settings.linkUrl;
	if (linkUrl) {
		const ipList = await fetchMultipleLinkIPs(linkUrl);
		updatedSettings.linkIPs = ipList;
	} else {
		updatedSettings.linkIPs = [];
	}

    try {
        await env.kv.put("proxySettings", JSON.stringify(updatedSettings));
        return updatedSettings;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(error);
        throw new Error(`An error occurred while updating KV: ${message}`);
    }
}

async function getDnsParams(dns: string): Promise<DnsHost> {
    const { host, isHostDomain } = getDomain(dns);
    const dohHost: DnsHost = { host, isDomain: isHostDomain, ipv4: [], ipv6: [] };

    if (isHostDomain) {
        const { ipv4, ipv6 } = await resolveDNS(host);
        dohHost.ipv4 = ipv4;
        dohHost.ipv6 = ipv6;
    }

    return dohHost;
}

// 添加配置读写函数
export interface CloudflareConfig {
    accountId: string;
    apiToken: string;
    email: string;
    globalApiKey: string;
}

export async function getCloudflareConfig(env: Env): Promise<CloudflareConfig> {
    const defaultConfig: CloudflareConfig = { accountId: '', apiToken: '', email: '', globalApiKey: '' };
    try {
        const stored = await env.kv.get('cfConfig', 'json') as CloudflareConfig | null;
        if (stored && typeof stored === 'object') {
            return {
                accountId: stored.accountId || '',
                apiToken: stored.apiToken || '',
                email: stored.email || '',
                globalApiKey: stored.globalApiKey || ''
            };
        }
        return defaultConfig;
    } catch {
        return defaultConfig;
    }
}

export async function saveCloudflareConfig(env: Env, config: CloudflareConfig): Promise<void> {
    await env.kv.put('cfConfig', JSON.stringify(config));
}

function extractProxyParams(chainProxy: string) {
    if (!chainProxy) return {};
    
    const { _SS_, _TR_, _VL_, _VM_ } = globalThis.dict;
    let url = new URL(chainProxy);
    const protocol = url.protocol.slice(0, -1);
    const stdProtocol = protocol === "ss" ? _SS_ : protocol.replace("socks5", "socks");

    if (stdProtocol === _VM_) {
        const config = JSON.parse(base64DecodeUtf8(url.host));
        return {
            protocol: stdProtocol,
            uuid: config.id,
            server: config.add,
            port: +config.port,
            aid: +config.aid,
            type: config.net,
            headerType: config.type,
            serviceName: config.path,
            authority: config.authority,
            path: config.path || undefined,
            host: config.host || undefined,
            security: config.tls,
            sni: config.sni,
            fp: config.fp,
            alpn: config.alpn || undefined
        };
    }

    const configParams: Record<string, string | number | undefined> = {
        protocol: stdProtocol,
        server: url.hostname,
        port: +url.port
    };

    const parseParams = (queryParams: boolean, customParams: Record<string, string | undefined>) => {
        if (queryParams) {
            for (const [key, value] of url.searchParams) {
                configParams[key] = value || undefined;
            }
        }

        return {
            ...configParams,
            ...customParams
        };
    }

    switch (stdProtocol) {
        case _VL_:
            return parseParams(true, {
                uuid: url.username
            });

        case _TR_:
            return parseParams(true, {
                password: url.username
            });

        case _SS_:
            const auth = base64DecodeUtf8(url.username);
            const [first, ...rest] = auth.split(':');
            return parseParams(true, {
                method: first,
                password: rest.join(':')
            });

        case 'socks':
        case 'http':
            let user, pass;
            try {
                const userInfo = base64DecodeUtf8(url.username);
                if (userInfo.includes(":")) [user, pass] = userInfo.split(":");
            } catch (error) {
                user = url.username;
                pass = url.password;
            }

            return parseParams(false, {
                user: user || undefined,
                pass: pass || undefined
            });

        default:
            return {};
    }
}