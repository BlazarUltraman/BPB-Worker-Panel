import { getDataset } from 'kv';
import { buildDNS } from './dns';
import { buildRoutingRules } from './routing';
import { buildChainOutbound, buildUrlTest, buildWarpOutbound, buildWebsocketOutbound } from './outbounds.js';
import { Outbound, WireguardEndpoint, Config, URLTest, Selector } from 'types/sing-box';
import { getConfigAddresses, generateRemark, isHttps, getProtocols } from '@utils';
import { buildMixedInbound, tun } from './inbounds';

// 辅助函数：从节点名称中提取国家代码（如 "🇺🇸 US-VLESS 1" -> "US"）
function extractCountryCode(tag: string): string | null {
    const match = tag.match(/\s([A-Z]{2})-/);
    return match ? match[1] : null;
}

export async function getSbCustomConfig(isFragment: boolean, useLink: boolean = false): Promise<Response> {
    const { outProxy, ports } = globalThis.settings;
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
            const groupName = `${flag} ${country} Best`;
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

    // 如果有链式代理，添加链式 Best Ping
    if (isChain) {
        const chainBestPing = buildUrlTest('💦 🔗 Best Ping 🚀', chainTags, false);
        outbounds.push(chainBestPing);
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
            tun,
            buildMixedInbound()
        ],
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
    const { warpEndpoints } = globalThis.settings;
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
            tun,
            buildMixedInbound()
        ],
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