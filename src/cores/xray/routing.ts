import { getGeoAssets } from './geo-assets';
import { RoutingRule } from 'types/xray';
import { accRoutingRules,parseRuleLine } from '@utils';

export function buildRoutingRules(
    isChain: boolean,
    isBalancer: boolean,
    isWorkerless: boolean,
    isWarp: boolean
): RoutingRule[] {
    const { blockUDP443, bypassLinkRules, byproxyLinkRules } = globalThis.settings;
    const rules: RoutingRule[] = [
        {
            inboundTag: [
                "mixed-in"
            ],
            port: 53,
            outboundTag: "dns-out",
            type: "field"
        },
        {
            inboundTag: [
                "dns-in"
            ],
            outboundTag: "dns-out",
            type: "field"
        }
    ];
    
    const outTag = isBalancer ? (isChain ? 'all-chains' : 'all-proxies') : (isChain ? 'chain' : 'proxy');
    const finallOutboundTag = isChain ? "chain" : isWorkerless ? "direct" : "proxy";
    const remoteDnsProxy = isBalancer ? "all-proxies" : "proxy";

    addRoutingRule(rules, ["remote-dns"], undefined, undefined, undefined, undefined, undefined, remoteDnsProxy, isBalancer);
    addRoutingRule(rules, ["dns"], undefined, undefined, undefined, undefined, undefined, "direct", false);

    addRoutingRule(rules, undefined, ["geosite:private"], undefined, undefined, undefined, undefined, "direct", false);
    addRoutingRule(rules, undefined, undefined, ["geoip:private"], undefined, undefined, undefined, "direct", false);

    if (!(isWarp || isWorkerless)) {
        addRoutingRule(rules, undefined, undefined, undefined, undefined, "udp", undefined, "block", false);
    } else if (blockUDP443) {
        addRoutingRule(rules, undefined, undefined, undefined, 443, "udp", undefined, "block", false);
    }

    const geoRules: GeoAsset[] = getGeoAssets();
    const routingRules = accRoutingRules(geoRules);

    const blockDomains = [
        ...routingRules.block.geosites,
        ...routingRules.block.domains.map(domain => `domain:${domain}`)
    ];

    if (blockDomains.length) {
        addRoutingRule(rules, undefined, blockDomains, undefined, undefined, undefined, undefined, 'block');
    }

    const blockIPs = [
        ...routingRules.block.geoips as string[],
        ...routingRules.block.ips
    ];

    if (blockIPs.length) {
        addRoutingRule(rules, undefined, undefined, blockIPs, undefined, undefined, undefined, 'block');
    }

    const bypassDomains = [
        ...routingRules.bypass.geosites,
        ...routingRules.bypass.domains.map(domain => `domain:${domain}`)
    ];

    if (bypassDomains.length) {
        addRoutingRule(rules, undefined, bypassDomains, undefined, undefined, undefined, undefined, 'direct');
    }

    const bypassIPs = [
        ...routingRules.bypass.geoips,
        ...routingRules.bypass.ips
    ];

    if (bypassIPs.length) {
        addRoutingRule(rules, undefined, undefined, bypassIPs, undefined, undefined, undefined, 'direct');
    }

    if (isWorkerless) {
        addRoutingRule(rules, undefined, undefined, undefined, undefined, "tcp", ["tls"], "proxy", false);
        addRoutingRule(rules, undefined, undefined, undefined, undefined, "tcp", ["http"], "http-fragment", false);
        addRoutingRule(rules, undefined, undefined, undefined, undefined, "udp", ["quic"], "udp-noise", false);
        addRoutingRule(rules, undefined, undefined, undefined, "443,2053,2083,2087,2096,8443", "udp", undefined, "udp-noise", false);
    }

    // final 路由
    const network = isWarp || isWorkerless ? "tcp,udp" : "tcp";
    addRoutingRule(rules, undefined, undefined, undefined, undefined, network, undefined, outTag, isBalancer);

    // ----- 新增 Link Rules -----
    const addLinkRules = (ruleList: string[], outbound: string) => {
        ruleList.forEach(line => {
            const parsed = parseRuleLine(line);
            if (!parsed) return;
            const { type, value } = parsed;
            if (type === 'DOMAIN-KEYWORD' || type === 'USER-AGENT') return; // Xray 不支持
            const rule: RoutingRule = { type: 'field' };
            switch (type) {
				case 'DOMAIN':
				case 'DOMAIN-SUFFIX':
					rule.domain = [value];
					break;
				case 'IP-CIDR':
				case 'IP-CIDR6':
					rule.ip = [value];
					break;
				case 'PROCESS-NAME':
					rule.process = [value];
					break;
				case 'IP-ASN':
					rule.asn = [value];
					break;
				default: return;
			}
            rule.outboundTag = outbound;
            rules.push(rule);
        });
    };

    addLinkRules(bypassLinkRules, 'direct');
    addLinkRules(byproxyLinkRules, outTag); // 使用统一 outTag

    return rules;
}

const addRoutingRule = (
    rules: RoutingRule[],
    inboundTag?: string[],
    domain?: string[],
    ip?: string[],
    port?: number | string,
    network?: "tcp" | "udp" | "tcp,udp",
    protocol?: ("http" | "tls" | "bittorrent" | "quic")[],
    outboundTag?: string,
    isBalancer?: boolean
) => rules.push({
    inboundTag,
    domain,
    ip,
    port,
    network,
    protocol,
    balancerTag: isBalancer ? outboundTag : undefined,
    outboundTag: isBalancer ? undefined : outboundTag,
    type: "field"
});

function parseRule(rule: string): any {
    const [type, value] = rule.split(',').map(s => s.trim());
    if (!type || !value) return null;
    switch (type.toUpperCase()) {
        case 'DOMAIN-SUFFIX': return { domain_suffix: value };
        case 'DOMAIN': return { domain: value };
        case 'DOMAIN-KEYWORD': return { domain_keyword: value };
        // 可扩展 IP-CIDR 等
        default: return null;
    }
}