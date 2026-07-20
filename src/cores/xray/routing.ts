import { getGeoAssets } from './geo-assets';
import { RoutingRule } from 'types/xray';
import { accRoutingRules, escapeRegExp, isIPv4, isIPv6, isIPv4CIDR, isIPv6CIDR, isDomain } from '@utils';

export function buildRoutingRules(
    isChain: boolean,
    isBalancer: boolean,
    isWorkerless: boolean,
    isWarp: boolean
): RoutingRule[] {
    const { blockUDP443, customByproxyRules } = globalThis.settings;
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

    const finallOutboundTag = isChain ? "chain" : isWorkerless ? "direct" : "proxy";
    const outTag = isBalancer ? isChain ? "all-chains" : "all-proxies" : finallOutboundTag;
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
    const routingRules = accRoutingRules(getGeoAssets());

    // block (domains, ips, keywords)
    if (routingRules.block.domains.length || routingRules.block.ips.length || routingRules.block.keywords.length) {
        const rule: RoutingRule = { outboundTag: 'block', type: 'field' };
        if (routingRules.block.domains.length) rule.domain = routingRules.block.domains.map(d => `domain:${d}`);
        if (routingRules.block.ips.length) rule.ip = routingRules.block.ips;
        if (routingRules.block.keywords.length) {
            const regexps = routingRules.block.keywords.map(k => `regexp:.*${escapeRegExp(k)}.*`);
            rule.domain = (rule.domain || []).concat(regexps);
        }
        rules.push(rule);
    }

    // bypass
    if (routingRules.bypass.domains.length || routingRules.bypass.ips.length || routingRules.bypass.keywords.length) {
        const rule: RoutingRule = { outboundTag: 'direct', type: 'field' };
        if (routingRules.bypass.domains.length) rule.domain = routingRules.bypass.domains.map(d => `domain:${d}`);
        if (routingRules.bypass.ips.length) rule.ip = routingRules.bypass.ips;
        if (routingRules.bypass.keywords.length) {
            const regexps = routingRules.bypass.keywords.map(k => `regexp:.*${escapeRegExp(k)}.*`);
            rule.domain = (rule.domain || []).concat(regexps);
        }
        rules.push(rule);
    }

    // byproxy
    if (customByproxyRules.length) {
        const domains: string[] = [];
        const ips: string[] = [];
        const keywords: string[] = [];
        for (const item of customByproxyRules) {
            if (isIPv4CIDR(item) || isIPv6CIDR(item) || isIPv4(item) || isIPv6(item)) {
                ips.push(item);
            } else if (isDomain(item)) {
                domains.push(`domain:${item}`);
            } else {
                keywords.push(`regexp:.*${escapeRegExp(item)}.*`);
            }
        }
        const rule: RoutingRule = { outboundTag: outTag, type: 'field' };  // outTag 是最终 fallback 的标签（如 "all-proxies"）
        if (domains.length) rule.domain = domains;
        if (ips.length) rule.ip = ips;
        if (keywords.length) rule.domain = (rule.domain || []).concat(keywords);
        rules.push(rule);
    }

    if (isWorkerless) {
        addRoutingRule(rules, undefined, undefined, undefined, undefined, "tcp", ["tls"], "proxy", false);
        addRoutingRule(rules, undefined, undefined, undefined, undefined, "tcp", ["http"], "http-fragment", false);
        addRoutingRule(rules, undefined, undefined, undefined, undefined, "udp", ["quic"], "udp-noise", false);
        addRoutingRule(rules, undefined, undefined, undefined, "443,2053,2083,2087,2096,8443", "udp", undefined, "udp-noise", false);
    }

    const network = isWarp || isWorkerless ? "tcp,udp" : "tcp";
    addRoutingRule(rules, undefined, undefined, undefined, undefined, network, undefined, outTag, isBalancer);

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
