import { getGeoAssets } from './geo-assets';
import { isIPv4, isIPv6, isIPv4CIDR, isIPv6CIDR, isDomain, accRoutingRules } from '@utils';
import { Route, RoutingRule, RuleSet } from 'types/sing-box';

export function buildRoutingRules(isWarp: boolean, isChain: boolean): Route {
    const { blockUDP443, customByproxyRules, enableIPv6 } = globalThis.settings;

    const rules: RoutingRule[] = [
        {
            ip_cidr: "172.19.0.2",
            action: "hijack-dns"
        },
        {
            clash_mode: "Direct",
            outbound: "direct"
        },
        {
            clash_mode: "Global",
            outbound: "✅ Selector"
        },
        {
            action: "sniff"
        },
        {
            protocol: "dns",
            action: "hijack-dns"
        },
        {
            ip_is_private: true,
            outbound: "direct"
        }
    ];

    if (!isWarp) {
        addRoutingRule(rules, 'reject', undefined, undefined, undefined, undefined, "udp");
    } else if (blockUDP443) {
        addRoutingRule(rules, 'reject', undefined, undefined, undefined, undefined, "udp", "quic", 443);
    }

    const geoAssets = getGeoAssets();
    const routingRules = accRoutingRules(geoAssets);

    const blockDomains = [
        ...routingRules.block.geosites,
        ...routingRules.block.domains
    ];

    // block
    if (routingRules.block.domains.length || routingRules.block.ips.length || routingRules.block.keywords.length) {
        const rule: RoutingRule = { action: 'reject' };
        if (routingRules.block.domains.length) rule.domain_suffix = routingRules.block.domains;
        if (routingRules.block.ips.length) rule.ip_cidr = routingRules.block.ips;
        if (routingRules.block.keywords.length) rule.domain_keyword = routingRules.block.keywords;
        rules.push(rule);
    }

    // bypass
    if (routingRules.bypass.domains.length || routingRules.bypass.ips.length || routingRules.bypass.keywords.length) {
        const rule: RoutingRule = { outbound: 'direct' };
        if (routingRules.bypass.domains.length) rule.domain_suffix = routingRules.bypass.domains;
        if (routingRules.bypass.ips.length) rule.ip_cidr = routingRules.bypass.ips;
        if (routingRules.bypass.keywords.length) rule.domain_keyword = routingRules.bypass.keywords;
        rules.push(rule);
    }
    
    // byproxy
    if (customByproxyRules.length) {
        const byproxyDomains: string[] = [];
        const byproxyIps: string[] = [];
        const byproxyKeywords: string[] = [];
        for (const item of customByproxyRules) {
            if (isIPv4CIDR(item) || isIPv6CIDR(item) || isIPv4(item) || isIPv6(item)) {
                byproxyIps.push(item);
            } else if (isDomain(item)) {
                byproxyDomains.push(item);
            } else {
                byproxyKeywords.push(item);
            }
        }
        const rule: RoutingRule = { outbound: '✅ Selector' };
        if (byproxyDomains.length) rule.domain_suffix = byproxyDomains;
        if (byproxyIps.length) rule.ip_cidr = byproxyIps;
        if (byproxyKeywords.length) rule.domain_keyword = byproxyKeywords;
        rules.push(rule);
    }

    const strategy = enableIPv6 ? "prefer_ipv4" : "ipv4_only";
    const ruleSets: RuleSet[] = geoAssets.reduce((sets, asset) => {
        addRuleSets(sets, asset);
        return sets;
    }, []);

    return {
        rules,
        rule_set: ruleSets.omitEmpty(),
        auto_detect_interface: true,
        default_domain_resolver: {
            server: "dns-direct",
            strategy,
            rewrite_ttl: 60
        },
        final: "✅ Selector"
    };
}

function addRoutingRule(
    rules: RoutingRule[],
    type: 'direct' | 'reject' | 'route',
    domain?: string[],
    ip?: string[],
    geosite?: string[],
    geoip?: string[],
    network?: "tcp" | "udp",
    protocol?: "http" | "tls" | "quic" | "dns",
    port?: number
) {
    rules.push({
        rule_set: geosite || geoip,
        domain_suffix: domain?.length ? domain : undefined,
        ip_cidr: ip?.length ? ip : undefined,
        network,
        protocol,
        port,
        action: type === 'reject' ? 'reject' : 'route',
        outbound: type === 'direct' ? 'direct' : undefined
    });
}

function addRuleSets(ruleSets: RuleSet[], geoAsset: GeoAsset) {
    const { geosite, geositeURL, geoip, geoipURL } = geoAsset;

    const addRuleSet = (geo: string, url: string) => ruleSets.push({
        type: "remote",
        tag: geo,
        format: "binary",
        url,
        download_detour: "direct"
    });

    if (geosite && geositeURL) addRuleSet(geosite, geositeURL);
    if (geoip && geoipURL) addRuleSet(geoip, geoipURL);
}