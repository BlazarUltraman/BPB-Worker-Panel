import { getGeoAssets } from './geo-assets';
import { accRoutingRules,parseRuleLine } from '@utils';
import { Route, RoutingRule, RuleSet } from 'types/sing-box';

export function buildRoutingRules(isWarp: boolean, isChain: boolean): Route {
    const { blockUDP443, bypassLinkRules, byproxyLinkRules, enableIPv6 } = globalThis.settings;
    const rules: RoutingRule[] = [];

    // 添加基础规则
    rules.push(
        { ip_cidr: "172.19.0.2", action: "hijack-dns" },
        { clash_mode: "Direct", outbound: "direct" },
        { clash_mode: "Global", outbound: "✅ Selector" },
        { action: "sniff" },
        { protocol: "dns", action: "hijack-dns" },
        { ip_is_private: true, outbound: "direct" }
    );

    // 添加 Warp / UDP 规则
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

    if (blockDomains.length) {
        addRoutingRule(rules, 'reject', routingRules.block.domains, undefined, routingRules.block.geosites);
    }

    const blockIPs = [
        ...routingRules.block.geoips,
        ...routingRules.block.ips
    ];

    if (blockIPs.length) {
        addRoutingRule(rules, 'reject', undefined, routingRules.block.ips, undefined, routingRules.block.geoips);
    }

    const bypassDomains = [
        ...routingRules.bypass.geosites,
        ...routingRules.bypass.domains
    ];

    if (bypassDomains.length) {
        addRoutingRule(rules, 'direct', routingRules.bypass.domains, undefined, routingRules.bypass.geosites);
    }

    const bypassIPs = [
        ...routingRules.bypass.geoips,
        ...routingRules.bypass.ips
    ];

    if (bypassIPs.length) {
        addRoutingRule(rules, 'direct', undefined, routingRules.bypass.ips, undefined, routingRules.bypass.geoips);
    }

    const strategy = enableIPv6 ? "prefer_ipv4" : "ipv4_only";
    const ruleSets: RuleSet[] = geoAssets.reduce((sets, asset) => {
        addRuleSets(sets, asset);
        return sets;
    }, []);

	// ----- 新增 Link Rules -----
    const addLinkRules = (ruleList: string[], outbound: string) => {
        ruleList.forEach(line => {
            const parsed = parseRuleLine(line);
            if (!parsed) return;
            const { type, value } = parsed;
            const rule: RoutingRule = { action: 'route', outbound };
            switch (type) {
                case 'DOMAIN': rule.domain = [value]; break;
                case 'DOMAIN-SUFFIX': rule.domain_suffix = [value]; break;
                case 'DOMAIN-KEYWORD': rule.domain_keyword = [value]; break;
                case 'IP-CIDR':
                case 'IP-CIDR6': rule.ip_cidr = [value]; break;
                case 'PROCESS-NAME': rule.process_name = [value]; break;
                case 'USER-AGENT': rule.user_agent = [value]; break;
                case 'IP-ASN': rule.asn = [value]; break;
                default: return;
            }
            rules.push(rule);
        });
    };

    const finalOutbound = isChain ? '💦 Best Ping 🚀' : '✅ Selector';
    addLinkRules(bypassLinkRules, 'direct');
    addLinkRules(byproxyLinkRules, finalOutbound);

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