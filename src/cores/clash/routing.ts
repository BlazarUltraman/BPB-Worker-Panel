import { RuleProvider } from 'types/clash';
import { getGeoAssets } from './geo-assets';
import { isIPv6, isIPv4, isIPv4CIDR, isIPv6CIDR, isDomain, accRoutingRules } from '@utils';

export function buildRoutingRules(isWarp: boolean) {
    const { blockUDP443, customByproxyRules } = globalThis.settings;
    const geoAssets = getGeoAssets();
    const routingRules = accRoutingRules(geoAssets);
    const rules = [`GEOIP,lan,DIRECT,no-resolve`];

    if (!isWarp) {
        rules.push("NETWORK,udp,REJECT");
    } else if (blockUDP443) {
        rules.push("AND,((NETWORK,udp),(DST-PORT,443)),REJECT");
    }

    // ---- block rules ----
    // (现有 domains 和 ips 不变，新增 keywords)
    for (const geosite of routingRules.block.geosites) {
        rules.push(`RULE-SET,${geosite},REJECT`);
    }
    for (const domain of routingRules.block.domains) {
        rules.push(`DOMAIN-SUFFIX,${domain},REJECT`);
    }
    for (const geoip of routingRules.block.geoips) {
        rules.push(`RULE-SET,${geoip},REJECT`);
    }
    for (const ip of routingRules.block.ips) {
        rules.push(buildIpCidrRule(ip, 'REJECT'));
    }
    for (const keyword of routingRules.block.keywords) {
        rules.push(`DOMAIN-KEYWORD,${keyword},REJECT`);
    }

    // ---- bypass rules ----
    // (同理增加 keywords)
    for (const geosite of routingRules.bypass.geosites) {
        rules.push(`RULE-SET,${geosite},DIRECT`);
    }
    for (const domain of routingRules.bypass.domains) {
        rules.push(`DOMAIN-SUFFIX,${domain},DIRECT`);
    }
    for (const geoip of routingRules.bypass.geoips) {
        rules.push(`RULE-SET,${geoip},DIRECT`);
    }
    for (const ip of routingRules.bypass.ips) {
        rules.push(buildIpCidrRule(ip, 'DIRECT'));
    }
    for (const keyword of routingRules.bypass.keywords) {
        rules.push(`DOMAIN-KEYWORD,${keyword},DIRECT`);
    }

    // ---- byproxy rules ----
    for (const rule of customByproxyRules) {
        if (isIPv4CIDR(rule) || isIPv6CIDR(rule) || isIPv4(rule) || isIPv6(rule)) {
            rules.push(buildIpCidrRule(rule, '✅ Selector'));
        } else if (isDomain(rule)) {
            rules.push(`DOMAIN-SUFFIX,${rule},✅ Selector`);
        } else {
            rules.push(`DOMAIN-KEYWORD,${rule},✅ Selector`);
        }
    }

    rules.push("MATCH,✅ Selector");
    return rules;
}

export function buildRuleProviders(): Record<string, RuleProvider> | undefined {
    const geoAssets = getGeoAssets();
    return geoAssets.reduce((providers, asset) => {
        addRuleProvider(providers, asset);
        return providers;
    }, {}).omitEmpty();
}

function addRuleProvider(
    ruleProviders: Record<string, RuleProvider>,
    ruleProvider: GeoAsset
) {
    const { geosite, geoip, geositeURL, geoipURL, format } = ruleProvider;
    const fileExtension = format === 'text' ? 'txt' : format;

    const defineProvider = (geo: string, behavior: 'domain' | 'ipcidr', url: string) => {
        ruleProviders[geo] = {
            type: "http",
            format: format!,
            behavior,
            path: `./ruleset/${geo}.${fileExtension}`,
            interval: 86400,
            url
        };
    };

    if (geosite && geositeURL) defineProvider(geosite, 'domain', geositeURL);
    if (geoip && geoipURL) defineProvider(geoip, 'ipcidr', geoipURL);
}

function buildIpCidrRule(ip: string, proxy: string) {
    ip = isIPv6(ip) ? ip.replace(/\[|\]/g, '') : ip;
    const cidr = ip.includes('/') ? '' : isIPv4(ip) ? '/32' : '/128';
    return `IP-CIDR,${ip}${cidr},${proxy}`;
}