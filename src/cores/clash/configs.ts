import { getDataset } from 'kv';
import { buildDNS } from './dns';
import { buildRoutingRules, buildRuleProviders } from './routing';
import { buildChainOutbound, buildUrlTest, buildWarpOutbound, buildWebsocketOutbound } from './outbounds';
import type { WireguardOutbound, Config, Outbound, URLTest, Selector, Tun } from 'types/clash';
import { getConfigAddresses, generateRemark, getProtocols } from '@utils';
import { buildSniffer } from './inbounds';

// 辅助函数：从节点名称中提取国家代码（如 "🇺🇸 US-VLESS 1" -> "US"）
function extractCountryCode(tag: string): string | null {
    const match = tag.match(/\s([A-Z]{2})-/);
    return match ? match[1] : null;
}

// 拉取并解析规则
async function fetchCustomGroupRules(url: string): Promise<string[]> {
    try {
        const resp = await fetch(url);
        const text = await resp.text();
        return text.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
    } catch {
        return [];
    }
}

// ==================== buildConfig 函数（保持不变） ====================
async function buildConfig(
    outbounds: Outbound[],
    selectorTags: string[],
    proxyTags: string[],
    chainTags: string[],
    isChain: boolean,
    isWarp: boolean,
    isPro: boolean
): Promise<Config> {
    const { logLevel, allowLANConnection, mtu, enableTun, fakeDNS, enableIPv6 } = globalThis.settings;  // 添加 enableIPv6
    const tcpSettings = isWarp ? {} : {
        "disable-keep-alive": false,
        "keep-alive-idle": 10,
        "keep-alive-interval": 15,
        "tcp-concurrent": true
    };
    
    // 构建 tun（仅当 enableTun 为 true 时）
    let tun: Tun | undefined;
	if (enableTun) {
		tun = {
			enable: true,
			stack: "mixed",
			"auto-route": true,
			"strict-route": true,
			"auto-detect-interface": true,
			"dns-hijack": [
				"any:53",
				"tcp://any:53"
			],
			mtu: mtu || 1500
		};
	}

    const config: Config = {
        "mixed-port": 7890,
        "ipv6": enableIPv6,
        "allow-lan": allowLANConnection,
        "unified-delay": false,
        "log-level": logLevel.replace("none", "silent"),
        "mode": "rule",
        ...tcpSettings,
        "geo-auto-update": true,
        "geo-update-interval": 168,
        "external-controller": "127.0.0.1:9090",
        "external-controller-cors": {
            "allow-origins": ["*"],
            "allow-private-network": true
        },
        "external-ui": "ui",
        "external-ui-url": "https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip",
        "profile": {
            "store-selected": true,
            "store-fake-ip": true
        },
        "dns": await buildDNS(isChain, isWarp, isPro),
        ...(enableTun ? { tun } : {}),   // 仅当启用时添加
        "sniffer": buildSniffer(fakeDNS),
        "proxies": outbounds,
        "proxy-groups": [
            {
                "name": "✅ Selector",
                "type": "select",
                "proxies": selectorTags
            }
        ],
        "rule-providers": buildRuleProviders(),
        "rules": buildRoutingRules(isWarp),
        "ntp": {
            "enable": true,
            "server": "time.cloudflare.com",
            "port": 123,
            "interval": 30
        }
    };

    const name = isWarp ? `💦 Warp ${isPro ? "Pro " : ""}- Best Ping 🚀` : "💦 Best Ping 🚀";
    const mainUrlTest = buildUrlTest(name, proxyTags, isWarp);
    config["proxy-groups"].push(mainUrlTest);
    if (isWarp) config["proxy-groups"].push(buildUrlTest(`💦 WoW ${isPro ? "Pro " : ""}- Best Ping 🚀`, chainTags, isWarp));
    if (isChain) config["proxy-groups"].push(buildUrlTest("💦 🔗 Best Ping 🚀", chainTags, isWarp));

    return config;
}

// ==================== 优化后的 getClNormalConfig ====================
export async function getClNormalConfig(useLink: boolean = false): Promise<Response> {
    const { outProxy, ports } = globalThis.settings;
    const chainProxy = outProxy ? buildChainOutbound() : undefined;
    const isChain = !!chainProxy;

    const proxyTags: string[] = [];
    const chainTags: string[] = [];
    const outbounds: Outbound[] = [];

    const Addresses = await getConfigAddresses(false, useLink);
    const protocols = getProtocols();

    // 按国家聚合节点标签
    const countryNodes: Map<string, string[]> = new Map();

    protocols.forEach(protocol => {
        let protocolIndex = 1;
        ports.forEach(port => {
            Addresses.forEach(addr => {
                const tag = generateRemark(protocolIndex, port, addr, protocol, false, false, useLink);
                const outbound = buildWebsocketOutbound(protocol, tag, addr, port);
                if (outbound) {
                    outbounds.push(outbound);
                    proxyTags.push(tag);

                    const country = extractCountryCode(tag);
                    if (country) {
                        if (!countryNodes.has(country)) countryNodes.set(country, []);
                        countryNodes.get(country)!.push(tag);
                    }

                    if (isChain) {
                        const chainTag = generateRemark(protocolIndex, port, addr, protocol, false, true, useLink);
                        let chain = structuredClone(chainProxy);
                        chain['name'] = chainTag;
                        chain['dialer-proxy'] = tag;
                        outbounds.push(chain);
                        chainTags.push(chainTag);
                    }
                    protocolIndex++;
                }
            });
        });
    });

    // 构建国家分组（url-test）
    const countryGroupTags: string[] = [];
    const countryGroups: URLTest[] = [];
    for (const [country, tags] of countryNodes) {
        if (tags.length >= 2) {
            const flag = String.fromCodePoint(...[...country].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
            const groupNameWithFlag = `${flag} ${country} Best 🚀`;
            const urlTest = buildUrlTest(groupNameWithFlag, tags, false);
            countryGroups.push(urlTest);
            countryGroupTags.push(groupNameWithFlag);
        }
    }

    // 构造 Best Ping 组（只包含原始节点和链式节点，不包含国家分组）
    const bestPingProxies = [...proxyTags, ...chainTags];
    const bestPingGroup = buildUrlTest('💦 Best Ping 🚀', bestPingProxies, false);

    // 构造 Selector 组：顺序 Best Ping、国家分组、原始节点（及链式节点）
    const selectorProxies: string[] = [
        '💦 Best Ping 🚀',
        ...(isChain ? ['💦 🔗 Best Ping 🚀'] : []),
        ...countryGroupTags,
        ...proxyTags,
        ...(isChain ? [...chainTags] : [])
    ];
    const selectorGroup: Selector = {
        name: '✅ Selector',
        type: 'select',
        proxies: selectorProxies
    };

    // 收集所有 proxy-groups
    const proxyGroups: (Selector | URLTest)[] = [selectorGroup, bestPingGroup];
    if (isChain) {
        const chainBestPing = buildUrlTest('💦 🔗 Best Ping 🚀', chainTags, false);
        proxyGroups.push(chainBestPing);
    }
    proxyGroups.push(...countryGroups);

    // 只调用一次 buildConfig，然后覆盖 proxy-groups
    const builtConfig = await buildConfig(
        outbounds,
        [], // selectorTags 不再使用（将被覆盖）
        [], // proxyTags 不再使用
        [], // chainTags 不再使用
        isChain,
        false,
        false
    );
    builtConfig['proxy-groups'] = proxyGroups;
    
    // 构建所有可用节点列表（用于自定义分组的 proxies）
	const allProxies = [
		'✅ Selector',
		'💦 Best Ping 🚀',
		...(isChain ? ['💦 🔗 Best Ping 🚀'] : []),
		...countryGroupTags,
		...proxyTags,
		...(isChain ? chainTags : []),
	];

	const customGroups = globalThis.settings.customGroups || [];
	const insertedRules: string[] = [];
	const newProxyGroups: Selector[] = [];

	for (const group of customGroups) {
		if (!group.url) continue;
		const rules = await fetchCustomGroupRules(group.url);
		if (rules.length === 0) continue;

		// 生成 Selector 组
		newProxyGroups.push({
			name: group.name,
			type: 'select',
			proxies: allProxies,
		});

		// 处理每条规则，自动追加目标组
		for (const rule of rules) {
			const trimmed = rule.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const parts = trimmed.split(',');
			const ruleType = parts[0].trim();
			const routeTypes = [
				'DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-FULL',
				'IP-CIDR', 'IP-CIDR6', 'GEOIP', 'SRC-IP-CIDR',
				'SRC-PORT', 'DST-PORT', 'PROCESS-NAME'
			];
			let finalRule = trimmed;
			if (routeTypes.includes(ruleType) && parts.length < 3) {
				finalRule = `${trimmed},${group.name}`;
			}
			insertedRules.push(finalRule);
		}
	}

	// 将新分组插入到 proxy-groups 中，位置在 ✅ Selector 之后
	if (newProxyGroups.length > 0) {
		const selectorIdx = builtConfig['proxy-groups'].findIndex(g => g.name === '✅ Selector');
		if (selectorIdx !== -1) {
			builtConfig['proxy-groups'].splice(selectorIdx + 1, 0, ...newProxyGroups);
		} else {
			// fallback
			builtConfig['proxy-groups'].push(...newProxyGroups);
		}
	}

	// 插入规则到 rules 数组（放在拦截规则之前）
	if (insertedRules.length > 0) {
		const rulesArray = builtConfig.rules;
		let insertIndex = rulesArray.findIndex(r => r.includes(',REJECT') || r.includes('REJECT'));
		if (insertIndex === -1) {
			insertIndex = rulesArray.findIndex(r => r.startsWith('MATCH'));
		}
		if (insertIndex === -1) insertIndex = rulesArray.length;
		rulesArray.splice(insertIndex, 0, ...insertedRules);
	}

    return new Response(JSON.stringify(builtConfig, null, 4), {
        status: 200,
        headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            'Cache-Control': 'no-store',
            'CDN-Cache-Control': 'no-store'
        }
    });
}

// ==================== getClWarpConfig（保持不变） ====================
export async function getClWarpConfig(request: Request, env: Env, isPro: boolean): Promise<Response> {
    const { warpEndpoints } = globalThis.settings;
    const { warpAccounts } = await getDataset(request, env);

    const proxyTags: string[] = [];
    const chainTags: string[] = [];
    const outbounds: WireguardOutbound[] = [];
    const proSign = isPro ? "Pro " : "";
    const selectorTags = [
        `💦 Warp ${proSign}- Best Ping 🚀`,
        `💦 WoW ${proSign}- Best Ping 🚀`
    ];

    warpEndpoints.forEach((endpoint, index) => {
        const warpTag = `💦 ${index + 1} - Warp ${proSign}🇮🇷`;
        proxyTags.push(warpTag);

        const wowTag = `💦 ${index + 1} - WoW ${proSign}🌍`;
        chainTags.push(wowTag);

        selectorTags.push(warpTag, wowTag);
        const warpOutbound = buildWarpOutbound(warpAccounts[0], warpTag, endpoint, '', isPro);
        const wowOutbound = buildWarpOutbound(warpAccounts[1], wowTag, endpoint, warpTag, false);
        outbounds.push(warpOutbound, wowOutbound);
    });

    const config = await buildConfig(
        outbounds,
        selectorTags,
        proxyTags,
        chainTags,
        false,
        true,
        isPro
    );

    return new Response(JSON.stringify(config, null, 4), {
        status: 200,
        headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            'Cache-Control': 'no-store',
            'CDN-Cache-Control': 'no-store'
        }
    });
}