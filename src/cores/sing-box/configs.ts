import { getDataset } from 'kv';
import { buildDNS } from './dns';
import { buildRoutingRules } from './routing';
import { buildChainOutbound, buildUrlTest, buildWarpOutbound, buildWebsocketOutbound } from './outbounds.js';
import { Outbound, WireguardEndpoint, Config, URLTest, Selector, MixedInbound, TunInbound } from 'types/sing-box';
import { getConfigAddresses, generateRemark, isHttps, getProtocols, fetchCustomGroupRules, isSupportedClashRule } from '@utils';
import { buildMixedInbound, buildTunInbound } from './inbounds';

// 辅助函数：从节点名称中提取国家代码（如 "🇺🇸 US-VLESS 1" -> "US"）
function extractCountryCode(tag: string): string | null {
    const match = tag.match(/\s([A-Z]{2})-/);
    return match ? match[1] : null;
}

export async function getSbCustomConfig(isFragment: boolean, useLink: boolean = false): Promise<Response> {
    const { outProxy, ports, enableTun, mtu } = globalThis.settings;
    const tunInbound = buildTunInbound(enableTun, mtu);
    const chainProxy = outProxy ? buildChainOutbound() : undefined;
    const isChain = !!chainProxy;

    const proxyTags: string[] = [];
    const chainTags: string[] = [];
    const outbounds: Outbound[] = [];

    const protocols = getProtocols();
    const Addresses = await getConfigAddresses(isFragment, useLink);
    const totalPorts = ports.filter(port => !isFragment || isHttps(port));

    const countryNodes: Map<string, string[]> = new Map();

    protocols.forEach(protocol => {
        let protocolIndex = 1;
        totalPorts.forEach(port => {
            Addresses.forEach(addr => {
                const tag = generateRemark(protocolIndex, port, addr, protocol, isFragment, false, useLink);
                const outbound = buildWebsocketOutbound(protocol, tag, addr, port, isFragment);
                outbounds.push(outbound);
                proxyTags.push(tag);

                const country = extractCountryCode(tag);
                if (country) {
                    if (!countryNodes.has(country)) countryNodes.set(country, []);
                    countryNodes.get(country)!.push(tag);
                }

                if (isChain) {
                    const chainTag = generateRemark(protocolIndex, port, addr, protocol, isFragment, true, useLink);
                    const chain = structuredClone(chainProxy);
                    chain.tag = chainTag;
                    chain.detour = tag;
                    outbounds.push(chain);
                    chainTags.push(chainTag);
                }
                protocolIndex++;
            });
        });
    });

    // 构建国家分组（urltest）
    const countryGroupTags: string[] = [];
    for (const [country, tags] of countryNodes) {
        if (tags.length >= 2) {
            const flag = String.fromCodePoint(...[...country].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
            const groupName = `${flag} ${country} Best 🚀`;
            const urlTest = buildUrlTest(groupName, tags, false);
            outbounds.push(urlTest);
            countryGroupTags.push(groupName);
        }
    }

    // 构建 Best Ping 分组（只包含原始节点和链式节点，不包含国家分组）
    const bestPingTags = [...proxyTags, ...chainTags];
    const bestPingGroup = buildUrlTest('💦 Best Ping 🚀', bestPingTags, false);
    outbounds.push(bestPingGroup);

    // 构建 Selector（顶层选择器）：顺序 Best Ping、国家分组、原始节点、链式节点
    const selectorTags = [
        '💦 Best Ping 🚀',
        ...(isChain ? ['💦 🔗 Best Ping 🚀'] : []),
        ...countryGroupTags,
        ...proxyTags,
        ...(isChain ? [...chainTags] : [])
    ];
    const selectorGroup: Selector = {
        type: "selector",
        tag: "✅ Selector",
        outbounds: selectorTags,
        interrupt_exist_connections: false
    };
    outbounds.push(selectorGroup);
    
     // ===== 新增：自定义分组处理 =====
    const customGroups = globalThis.settings.customGroups || [];
    const customGroupOutbounds: Selector[] = [];
    const customRules: any[] = []; // 用于路由规则

    // 构建所有可用节点列表（用于自定义分组的 proxies）
    const allProxies = [
        '✅ Selector',
        '💦 Best Ping 🚀',
        ...(isChain ? ['💦 🔗 Best Ping 🚀'] : []),
        ...countryGroupTags,
        ...proxyTags,
        ...(isChain ? chainTags : []),
    ];

    for (const group of customGroups) {
        if (!group.url) continue;
        const rules = await fetchCustomGroupRules(group.url);
        if (rules.length === 0) continue;

        // 生成 Selector 组
        customGroupOutbounds.push({
            type: "selector",
            tag: group.name,
            outbounds: allProxies,
            interrupt_exist_connections: false
        });

        // 转换规则为 sing-box 路由规则
        for (const rule of rules) {
			// 过滤不支持的规则类型
			if (!isSupportedClashRule(rule)) continue;
            const trimmed = rule.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            // 解析 Clash 风格规则：DOMAIN-KEYWORD, youtube, ...
            const parts = trimmed.split(',');
            const ruleType = parts[0].trim().toUpperCase();
            const value = parts[1]?.trim();
            if (!value) continue;

            // 构建 sing-box 路由规则（只处理常见类型）
            let singRule: any = { outbound: group.name };
            switch (ruleType) {
                case 'DOMAIN':
                    singRule.domain = [value];
                    break;
                case 'DOMAIN-SUFFIX':
                    singRule.domain_suffix = [value];
                    break;
                case 'DOMAIN-KEYWORD':
                    singRule.domain_keyword = [value];
                    break;
                case 'DOMAIN-FULL':
                    singRule.domain = [value]; // 全匹配
                    break;
                case 'IP-CIDR':
                case 'IP-CIDR6':
                    singRule.ip_cidr = [value];
                    break;
                case 'GEOIP':
                    // GEOIP 暂时忽略，因为需要 rule_set
                    continue;
                default:
                    continue; // 忽略不支持的规则
            }
            customRules.push(singRule);
        }
    }
    // ===== 自定义分组处理结束 =====

    // 如果有链式代理，添加链式 Best Ping
    if (isChain) {
        const chainBestPing = buildUrlTest('💦 🔗 Best Ping 🚀', chainTags, false);
        outbounds.push(chainBestPing);
    }
    
    const selectorIdx = outbounds.findIndex(o => o.tag === '✅ Selector');
    if (selectorIdx !== -1) {
        outbounds.splice(selectorIdx + 1, 0, ...customGroupOutbounds);
    } else {
        outbounds.push(...customGroupOutbounds);
    }

    // 构建最终配置
    const config: Config = {
        log: {
            disabled: globalThis.settings.logLevel === "none",
            level: globalThis.settings.logLevel === "none" ? undefined : globalThis.settings.logLevel === "warning" ? "warn" : globalThis.settings.logLevel,
            timestamp: true
        },
        dns: await buildDNS(false, isChain),
        inbounds: [
			tunInbound,
			buildMixedInbound()
		].filter(Boolean) as (MixedInbound | TunInbound)[],
        outbounds: outbounds,
        route: buildRoutingRules(false, isChain),
        ntp: {
            enabled: true,
            server: "time.cloudflare.com",
            server_port: 123,
            domain_resolver: "dns-direct",
            interval: "30m",
            write_to_system: false
        },
        experimental: {
            cache_file: {
                enabled: true,
                store_fakeip: true
            },
            clash_api: {
                external_controller: "127.0.0.1:9090",
                external_ui: "ui",
                default_mode: "Rule",
                external_ui_download_url: "https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip",
                external_ui_download_detour: "direct"
            }
        }
    };
    
    // 重新构建 route，合并规则
    const baseRoute = buildRoutingRules(false, isChain);
	const rulesArray = baseRoute.rules;
	// 找到第一个 reject 规则索引
	let insertIdx = rulesArray.findIndex(r => r.action === 'reject');
	if (insertIdx === -1) {
		// 若无，则在 final 规则前
		insertIdx = rulesArray.findIndex(r => r.outbound === '✅ Selector' || r.outbound?.includes('Selector'));
	}
	if (insertIdx === -1) insertIdx = rulesArray.length;
	// 插入自定义规则
	rulesArray.splice(insertIdx, 0, ...customRules);
	config.route = { ...baseRoute, rules: rulesArray };

    return new Response(JSON.stringify(config, null, 4), {
        status: 200,
        headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            'Cache-Control': 'no-store',
            'CDN-Cache-Control': 'no-store'
        }
    });
}

export async function getSbWarpConfig(request: Request, env: Env): Promise<Response> {
    const { warpEndpoints, enableTun, mtu } = globalThis.settings;
    const tunInbound = buildTunInbound(enableTun, mtu);
    const { warpAccounts } = await getDataset(request, env);

    const proxyTags: string[] = [];
    const chainTags: string[] = [];
    const endpoints: WireguardEndpoint[] = [];  // ← 改为 endpoints
    const selectorTags = [
        "💦 Warp - Best Ping 🚀",
        "💦 WoW - Best Ping 🚀"
    ];

    warpEndpoints.forEach((endpoint, index) => {
        const warpTag = `💦 ${index + 1} - Warp 🇮🇷`;
        proxyTags.push(warpTag);

        const wowTag = `💦 ${index + 1} - WoW 🌍`;
        chainTags.push(wowTag);

        selectorTags.push(warpTag, wowTag);
        const warpOutbound = buildWarpOutbound(warpAccounts[0], warpTag, endpoint);
        const wowOutbound = buildWarpOutbound(warpAccounts[1], wowTag, endpoint, warpTag);
        endpoints.push(warpOutbound, wowOutbound);  // ← 放入 endpoints
    });

    const bestPing = buildUrlTest("💦 Warp - Best Ping 🚀", proxyTags, true);
    const wowBestPing = buildUrlTest("💦 WoW - Best Ping 🚀", chainTags, true);

    const config: Config = {
        log: {
            disabled: globalThis.settings.logLevel === "none",
            level: globalThis.settings.logLevel === "none" ? undefined : globalThis.settings.logLevel === "warning" ? "warn" : globalThis.settings.logLevel,
            timestamp: true
        },
        dns: await buildDNS(true, false),
        inbounds: [
			tunInbound,
			buildMixedInbound()
		].filter(Boolean) as (MixedInbound | TunInbound)[],
        outbounds: [  // 只放非 Wireguard 的出站
            {
                type: "selector",
                tag: "✅ Selector",
                outbounds: selectorTags,
                interrupt_exist_connections: false
            },
            {
                type: "direct",
                tag: "direct"
            },
            bestPing,
            wowBestPing
        ],
        endpoints: endpoints,  // ← Wireguard 节点放这里
        route: buildRoutingRules(true, false),
        ntp: {
            enabled: true,
            server: "time.cloudflare.com",
            server_port: 123,
            domain_resolver: "dns-direct",
            interval: "30m",
            write_to_system: false
        },
        experimental: {
            cache_file: {
                enabled: true,
                store_fakeip: true
            },
            clash_api: {
                external_controller: "127.0.0.1:9090",
                external_ui: "ui",
                default_mode: "Rule",
                external_ui_download_url: "https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip",
                external_ui_download_detour: "direct"
            }
        }
    };

    return new Response(JSON.stringify(config, null, 4), {
        status: 200,
        headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            'Cache-Control': 'no-store',
            'CDN-Cache-Control': 'no-store'
        }
    });
}