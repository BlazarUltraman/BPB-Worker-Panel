import { getDataset } from 'kv';
import { buildDNS } from './dns';
import { buildRoutingRules } from './routing';
import { buildChainOutbound, buildUrlTest, buildWarpOutbound, buildWebsocketOutbound } from './outbounds.js';
import { Outbound, WireguardEndpoint, Config, URLTest, Selector } from 'types/sing-box';
import { getConfigAddresses, generateRemark, isHttps, getProtocols } from '@utils';
import { buildMixedInbound, tun } from './inbounds';

// 辅助函数：从节点名称中提取国家代码（如 "🇺🇸 US-VLESS 1" -> "US"）
function extractCountryCode(tag: string): string | null {
    const match = tag.match(/^([🇦🇿-🇿🇼])\s+([A-Z]{2})-/);
    if (match) return match[2];
    return null;
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

    // 用于聚合节点标签及其国家
    const countryNodes: Map<string, string[]> = new Map(); // country -> tags[]

    protocols.forEach(protocol => {
        let protocolIndex = 1;
        totalPorts.forEach(port => {
            Addresses.forEach(addr => {
                const tag = generateRemark(protocolIndex, port, addr, protocol, isFragment, false, useLink);
                const outbound = buildWebsocketOutbound(protocol, tag, addr, port, isFragment);
                outbounds.push(outbound);
                proxyTags.push(tag);

                // 提取国家
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

    // 构建 Best Ping 分组（包含所有节点 + 国家分组）
    const bestPingTags = [...proxyTags, ...chainTags, ...countryGroupTags];
    const bestPingGroup = buildUrlTest('💦 Best Ping 🚀', bestPingTags, false);
    outbounds.push(bestPingGroup);

    // 构建 Selector（顶层选择器）
    const selectorTags = ['💦 Best Ping 🚀', ...(isChain ? ['💦 🔗 Best Ping 🚀'] : []), ...countryGroupTags];
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

    // 构建最终配置（直接构造 Config 对象，避免 buildConfig 覆盖）
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