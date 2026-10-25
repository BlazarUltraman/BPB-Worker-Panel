import { DnsHost, KvSettings, PanelSettings, TelegramBot, WarpAccount } from '#types/settings';
import { extractProxyParams, extractUpstreamParams, getDomain, resolveDNS } from '@utils';
import { fetchWarpAccounts } from '@api/warp';
import { safeError } from '@common';
import { getKvSettings } from '@settings';
import { setCustomDomain } from '@main';

export async function getDataset(env: Env): Promise<{
    settings: KvSettings,
    telegramBot: TelegramBot,
    warpAccounts: WarpAccount[]
}> {
    let settings: KvSettings | null, warpAccounts: WarpAccount[] | null;
    const kvSettings = getKvSettings();

    try {
        settings = await env.kv.get('proxySettings', { type: 'json' });
        warpAccounts = await env.kv.get('warpAccounts', { type: 'json' });
        if (!settings) {
            await env.kv.put('proxySettings', JSON.stringify(kvSettings));
            settings = kvSettings;
        }

        if (!warpAccounts) {
            warpAccounts = await fetchWarpAccounts(env);
        }

		if (VERSION !== settings.panelVersion) {
			settings = await updateDataset(env, settings as PanelSettings);
		}

        let telegramBot: TelegramBot | null = await env.kv.get('telegramBot', { type: 'json' });
        if (!telegramBot) {
            telegramBot = { telegramBotToken: '', telegramUserId: '' };
            await env.kv.put('telegramBot', JSON.stringify(telegramBot));
        }

        return {
            settings,
            telegramBot,
            warpAccounts
        };
    } catch (error) {
        console.log(error);
        throw new Error(`An error occurred while getting KV: ${safeError(error)}`);
    }
}

export async function updateDataset(env: Env, newSettings?: PanelSettings): Promise<KvSettings> {
    if (!newSettings) {
        const kvSettings = getKvSettings();
        await env.kv.put('proxySettings', JSON.stringify(kvSettings));
        return kvSettings;
    }

    let currentSettings: KvSettings | null;
    const kvSettings = getKvSettings();

    try {
        currentSettings = await env.kv.get('proxySettings', { type: 'json' });
    } catch (error) {
        console.log(error);
        throw new Error(`An error occurred while getting current KV settings: ${safeError(error)}`);
    }

    const getParam = async <T extends keyof KvSettings>(
        key: T,
        cbKey?: T,
        callback?: (value: KvSettings[T]) => any | Promise<any>
    ) => {
        const resolve = (k: T) => newSettings?.[k] ?? currentSettings?.[k] ?? kvSettings[k];

        if (callback && cbKey) {
            const cbValue = resolve(cbKey);
            if (cbValue !== currentSettings?.[cbKey]) {
                return callback(cbValue);
            }
        }

        const value = newSettings?.[key] ?? currentSettings?.[key] ?? kvSettings[key];
        return value;
    };

    const fields: Array<
        [keyof KvSettings] |
        [keyof KvSettings, keyof KvSettings, (key: any) => any | Promise<any>]
    > = [
            ['remoteDNS'],
            ['remoteDnsHost', 'remoteDNS', getDnsParams],
            ['localDNS'],
            ['antiSanctionDNS'],
            ['enableIPv6'],
            ['fakeDNS'],
            ['logLevel'],
            ['allowLANConnection'],
            ['customDomain', 'customDomain', setCustomDomain],
            ['upstreamProxy'],
            ['upstreamParams', 'upstreamProxy', extractUpstreamParams],
            ['chainProxy'],
            ['chainProxyParams', 'chainProxy', extractProxyParams],
            ['cleanIPs'],
            ['customCdnAddrs'],
            ['customCdnHost'],
            ['customCdnSni'],
            ['bestPingInterval'],
            ['protocols'],
            ['ports'],
            ['fingerprint'],
            ['enableTFO'],
            ['fragmentMode'],
            ['fragmentLengthMin'],
            ['fragmentLengthMax'],
            ['fragmentDelayMin'],
            ['fragmentDelayMax'],
            ['fragmentMaxSplitMin'],
            ['fragmentMaxSplitMax'],
            ['fragmentPackets'],
            ['enableECH'],
            ['echServerName'],
            ['bypassIran'],
            ['bypassChina'],
            ['bypassRussia'],
            ['bypassOpenAi'],
            ['bypassGoogleAi'],
            ['bypassMicrosoft'],
            ['bypassOracle'],
            ['bypassDocker'],
            ['bypassAdobe'],
            ['bypassEpicGames'],
            ['bypassIntel'],
            ['bypassAmd'],
            ['bypassNvidia'],
            ['bypassAsus'],
            ['bypassHp'],
            ['bypassLenovo'],
            ['blockAds'],
            ['blockPorn'],
            ['blockUDP443'],
            ['blockMalware'],
            ['blockPhishing'],
            ['blockCryptominers'],
            ['customBypassRules'],
            ['customBlockRules'],
            ['customBypassSanctionRules'],
            ['warpRemoteDNS'],
            ['warpEndpoints'],
            ['warpBestPingInterval'],
            ['warpReservedBytes'],
            ['xrayUdpNoises'],
            ['knockerNoiseMode'],
            ['knockerNoiseCountMin'],
            ['knockerNoiseCountMax'],
            ['knockerNoiseSizeMin'],
            ['knockerNoiseSizeMax'],
            ['knockerNoiseDelayMin'],
            ['knockerNoiseDelayMax'],
            ['amneziaNoiseCount'],
            ['amneziaNoiseSizeMin'],
            ['amneziaNoiseSizeMax'],
            ['customSubs'],
            ['remoteSettings'],
            ['linkUrl'],
            ['customGroups'],
            ['customConfigs']
        ];

    try {
        const entries = await Promise.all(
            fields.map(async ([key, callbackKey, callbackFunc]) => {
                return [key, await getParam(key, callbackKey, callbackFunc)];
            })
        );

        const updatedSettings: KvSettings = {
            ...Object.fromEntries(entries),
            panelVersion: VERSION
        };

        // linkUrl → linkIPs 联动（带缓存比对）
		const linkUrl = newSettings?.linkUrl ?? currentSettings?.linkUrl ?? kvSettings.linkUrl;
		const currentLinkIPs = currentSettings?.linkIPs ?? kvSettings.linkIPs ?? [];

		if (linkUrl) {
			const newIPs = await fetchMultipleLinkIPs(linkUrl);
			const sortedNew = [...newIPs].sort();
			const sortedCur = [...currentLinkIPs].sort();
			const same = sortedNew.length === sortedCur.length && sortedNew.every((v, i) => v === sortedCur[i]);
			updatedSettings.linkIPs = same ? currentLinkIPs : newIPs;
		} else {
			updatedSettings.linkIPs = [];
		}

		// customGroups 保证是数组
		updatedSettings.customGroups = Array.isArray(updatedSettings.customGroups) ? updatedSettings.customGroups : [];
        
        await env.kv.put('proxySettings', JSON.stringify(updatedSettings));
        return updatedSettings;
    } catch (error) {
        console.log(error);
        throw new Error(`An error occurred while updating KV: ${safeError(error)}`);
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

export interface CloudflareConfig {
    accountId: string;
    apiToken: string;
    email: string;
    globalApiKey: string;
    queryUrl?: string;
}

export interface BackgroundConfig {
    image: string;
    position: string;
    opacity: number;
    version?: number;
}

export const defaultBackground: BackgroundConfig = {
    image: '/background-image',
    position: 'left',
    opacity: 0.85,
    version: 1
};

const defaultCfConfig: CloudflareConfig = {
    accountId: '', apiToken: '', email: '', globalApiKey: '', queryUrl: ''
};

export async function getCloudflareConfig(env: Env): Promise<CloudflareConfig> {
    const stored = await env.kv.get('cfConfig', 'json') as CloudflareConfig | null;
    return stored ?? { ...defaultCfConfig };
}

export async function saveCloudflareConfig(env: Env, config: CloudflareConfig): Promise<void> {
    await env.kv.put('cfConfig', JSON.stringify(config));
}

export async function getBackgroundConfig(env: Env): Promise<BackgroundConfig> {
    const cfg = await env.kv.get('backgroundConfig', { type: 'json' }) as BackgroundConfig | null;
    return cfg && cfg.image ? cfg : { ...defaultBackground };
}

export async function saveBackgroundConfig(env: Env, cfg: BackgroundConfig): Promise<BackgroundConfig> {
    const current = await getBackgroundConfig(env);
    // 图片变化才 bump version，强制刷新缓存；否则保留原版本
    const version = cfg.image !== current.image ? Date.now() : (current.version || 1);
    const next = { ...cfg, version };
    await env.kv.put('backgroundConfig', JSON.stringify(next));
    return next;
}

async function fetchLinkIPs(url: string): Promise<string[]> {
    if (!url) return [];
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        return text.split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'));
	} catch (e) {
		let host = 'invalid-url';
		try { host = new URL(url).host; } catch { /* noop */ }
		console.error(`Failed to fetch link IPs from ${host}:`, e);
		return [];
	}
}

export async function fetchMultipleLinkIPs(input: string): Promise<string[]> {
    if (!input) return [];
    const urls = input.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    const results = await Promise.all(urls.map(u => fetchLinkIPs(u).catch(() => [])));
    return [...new Set(results.flat())];
}