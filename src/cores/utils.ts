export function isDomain(address: string): boolean {
    if (!address) return false;
    const domainRegex = /^(?!-)(?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,}$/;
    return domainRegex.test(address);
}

export async function resolveDNS(domain: string, onlyIPv4 = false): Promise<DnsResult> {
    const { dohURL } = globalThis.globalConfig;
    const dohBaseURL = `${dohURL}?name=${encodeURIComponent(domain)}`;
    const dohURLs = {
        ipv4: `${dohBaseURL}&type=A`,
        ipv6: `${dohBaseURL}&type=AAAA`,
    };

    try {
        const ipv4 = await fetchDNSRecords(dohURLs.ipv4, 1);
        const ipv6 = onlyIPv4 ? [] : await fetchDNSRecords(dohURLs.ipv6, 28);
        return { ipv4, ipv6 };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Error resolving DNS for ${domain}: ${message}`);
    }
}

async function fetchDNSRecords(url: string, recordType: number) {
    try {
        const response = await fetch(url, { headers: { accept: 'application/dns-json' } });
        const data: any = await response.json();

        if (!data.Answer) return [];

        return data.Answer
            .filter((record: any) => record.type === recordType)
            .map((record: any) => record.data);

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to fetch DNS records from ${url}: ${message}`);
    }
}

export function getProtocols() {
    const {
        settings: { VLConfigs, TRConfigs },
        dict: { _VL_, _TR_ }
    } = globalThis;

    return [].concatIf(VLConfigs, _VL_).concatIf(TRConfigs, _TR_);
}


export async function getConfigAddresses(isFragment: boolean, useLink: boolean = false): Promise<string[]> {
    const {
        httpConfig: { hostName },
        settings: { enableIPv6, customCdnAddrs, cleanIPs, linkIPs }
    } = globalThis;

    const ipList = useLink ? linkIPs : cleanIPs;
    
	const cleanAddresses = ipList.map(item => {
		const addr = item.split('#')[0].trim();
		if (!addr) return null;
		const { host } = parseHostPort(addr, true);  // brackets: true 保留 IPv6 的 []
		return host;
	}).filter(Boolean);

    const { ipv4, ipv6 } = await resolveDNS(hostName, !enableIPv6); // ← 必须保留
    const addrs = [
        hostName,
        'www.speedtest.net',
        ...ipv4,
        ...ipv6.map((ip: string) => `[${ip}]`),
        ...cleanAddresses
    ];

    return addrs.concatIf(!isFragment, customCdnAddrs);
}

function classifyRules(rules: string[]) {
    const domains: string[] = [];
    const ips: string[] = [];
    const keywords: string[] = [];
    for (const rule of rules) {
        if (isDomain(rule)) {
            domains.push(rule);
        } else if (isIPv4CIDR(rule) || isIPv6CIDR(rule) || isIPv4(rule) || isIPv6(rule)) {
            ips.push(rule);
        } else {
            keywords.push(rule);
        }
    }
    return { domains, ips, keywords };
}

// 通用备注查找函数
function getRemarkFromList(address: string, ipList: string[]): string | null {
    const normalizeAddr = (addr: string) => addr.replace(/^\[|\]$/g, '');
    const normalizedTarget = normalizeAddr(address);

    for (const item of ipList) {
        const parts = item.split('#');
        const rawAddr = parts[0].trim();
        // 使用 parseHostPort 提取 host（去掉端口）
        const { host } = parseHostPort(rawAddr, true);
        const addr = normalizeAddr(host);
        if (addr === normalizedTarget && parts.length > 1) {
            return parts.slice(1).join('#').trim();
        }
    }
    return null;
}

// 在模块顶部维护一个 Map（每次生成配置前需重置）
const remarkCounter = new Map<string, number>();

// 添加国旗转换辅助函数
function getFlagEmoji(countryCode: string): string {
    if (!countryCode || countryCode.length !== 2) return '';
    const codePoints = countryCode.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65);
    return String.fromCodePoint(...codePoints);
}

// 修改 generateRemark 签名，增加 useLink 参数
export function generateRemark(
    index: number,
    port: number,
    address: string,
    protocol: string,
    isFragment: boolean,
    isChain: boolean,
    useLink: boolean = false  // 新增
): string {
    const { _VL_, _VL_CAP_, _TR_CAP_ } = globalThis.dict;
    const protoSign = protocol === _VL_ ? _VL_CAP_ : _TR_CAP_;
    const prefix = isChain ? '🔗 ' : '';

    // 根据 useLink 选择 IP 列表
    const { cleanIPs, linkIPs } = globalThis.settings;
    const ipList = useLink ? linkIPs : cleanIPs;
    const remark = getRemarkFromList(address, ipList);

    let prefixSymbol = '☁ ';
    let displayName = 'Clean';
    let count = index;

    if (remark) {
        count = (remarkCounter.get(remark) || 0) + 1;
        remarkCounter.set(remark, count);

        if (/^[A-Z]{2}$/.test(remark)) {
            const flag = getFlagEmoji(remark);
            prefixSymbol = flag + ' ';
            displayName = remark;
        } else {
            prefixSymbol = '☁ ';
            displayName = remark;
        }
    } else {
        count = index;
        prefixSymbol = '☁ ';
        displayName = 'Clean';
    }

    return `${prefixSymbol}${displayName}-${prefix}${protoSign} ${count}`;
}

export function randomUpperCase(str: string): string {
    let result = '';

    for (let i = 0; i < str.length; i++) {
        result += Math.random() < 0.5 ? str[i].toUpperCase() : str[i];
    }

    return result;
}

export function getRandomString(lengthMin: number, lengthMax: number): string {
    let result = '';
    const charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const length = Math.floor(Math.random() * (lengthMax - lengthMin + 1)) + lengthMin;

    for (let i = 0; i < length; i++) {
        result += charSet.charAt(Math.floor(Math.random() * charSet.length));
    }

    return result;
}

export function generateWsPath(protocol: string): string {
    const {
        settings: { proxyIPMode, proxyIPs, prefixes },
        dict: { _VL_ }
    } = globalThis;

    const config = {
        junk: getRandomString(8, 16),
        protocol: protocol === _VL_ ? "vl" : "tr",
        mode: proxyIPMode,
        panelIPs: proxyIPMode === 'proxyip' ? proxyIPs : prefixes
    };

    return `/${btoa(JSON.stringify(config))}`;
}

export function base64ToDecimal(base64: string): number[] {
    const binaryString = atob(base64);
    const hexString = Array
        .from(binaryString)
        .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('');

    const decimalArray = hexString
        .match(/.{2}/g)!
        .map(hex => parseInt(hex, 16));

    return decimalArray;
}

export function isIPv4(address: string): boolean {
    const ipv4Pattern = /^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/([0-9]|[1-2][0-9]|3[0-2]))?$/;
    return ipv4Pattern.test(address);
}

export function isIPv6(address: string): boolean {
    const ipv6Pattern = /^\[(?:(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,7}:|::(?:[a-fA-F0-9]{1,4}:){0,7}|(?:[a-fA-F0-9]{1,4}:){1,6}:[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,5}(?::[a-fA-F0-9]{1,4}){1,2}|(?:[a-fA-F0-9]{1,4}:){1,4}(?::[a-fA-F0-9]{1,4}){1,3}|(?:[a-fA-F0-9]{1,4}:){1,3}(?::[a-fA-F0-9]{1,4}){1,4}|(?:[a-fA-F0-9]{1,4}:){1,2}(?::[a-fA-F0-9]{1,4}){1,5}|[a-fA-F0-9]{1,4}:(?::[a-fA-F0-9]{1,4}){1,6})\](?:\/(1[0-1][0-9]|12[0-8]|[0-9]?[0-9]))?$/;
    return ipv6Pattern.test(address);
}

export function isIPv4CIDR(address: string): boolean {
    const ipv4CidrPattern = /^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/([0-9]|[1-2][0-9]|3[0-2]))?$/;
    return ipv4CidrPattern.test(address);
}

export function isIPv6CIDR(address: string): boolean {
    const ipv6CidrPattern = /^\[?(?:(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,7}:|::(?:[a-fA-F0-9]{1,4}:){0,7}|(?:[a-fA-F0-9]{1,4}:){1,6}:[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,5}(?::[a-fA-F0-9]{1,4}){1,2}|(?:[a-fA-F0-9]{1,4}:){1,4}(?::[a-fA-F0-9]{1,4}){1,3}|(?:[a-fA-F0-9]{1,4}:){1,3}(?::[a-fA-F0-9]{1,4}){1,4}|(?:[a-fA-F0-9]{1,4}:){1,2}(?::[a-fA-F0-9]{1,4}){1,5}|[a-fA-F0-9]{1,4}:(?::[a-fA-F0-9]{1,4}){1,6})\](?:\/(1[0-1][0-9]|12[0-8]|[0-9]?[0-9]))?$/;
    return ipv6CidrPattern.test(address);
}

export function getDomain(url: string) {
    try {
        const newUrl = new URL(url);
        const host = newUrl.hostname;
        const isHostDomain = isDomain(host);

        return {
            host,
            isHostDomain
        };
    } catch {
        return {
            host: '',
            isHostDomain: false
        };
    }
}

export function selectSniHost(address: string) {
    const {
        httpConfig: { hostName },
        settings: { customCdnAddrs, customCdnHost, customCdnSni }
    } = globalThis;

    const isCustomAddr = customCdnAddrs.includes(address);
    const sni = isCustomAddr ? customCdnSni : randomUpperCase(hostName);
    const host = isCustomAddr ? customCdnHost : hostName;

    return { host, sni, allowInsecure: isCustomAddr };
}

export function parseHostPort(input: string, brackets?: boolean): { host: string, port: number } {
    const regex = /^(?:\[(?<ipv6>.+?)\]|(?<host>[^:]+))(:(?<port>\d+))?$/;
    const match = input.match(regex);

    if (!match || !match.groups) return { host: "", port: 0 };
    const { ipv6, host: plainHost, port: portStr } = match.groups;

    let host = ipv6 ?? plainHost ?? "";
    if (brackets && ipv6) host = `[${ipv6}]`;
    const port = portStr ? Number(portStr) : 0;

    return { host, port };
}

export function isHttps(port: number): boolean {
    const { defaultHttpsPorts } = globalThis.httpConfig;
    return defaultHttpsPorts.includes(port);
}

const isBypass = (type: string) => type === "direct";
const isBlock = (type: string) => type === "block";

export function accRoutingRules(geoAssets: GeoAsset[]) {
    const {
        customBypassRules,
        customBypassSanctionRules,
        customBlockRules
    } = globalThis.settings;
    
    const bypass = classifyRules(customBypassRules);
    const block = classifyRules(customBlockRules);

    return {
        bypass: {
            geosites: geoAssets.filter(rule => isBypass(rule.type)).map(rule => rule.geosite),
            geoips: geoAssets.filter(rule => isBypass(rule.type) && rule.geoip).map(rule => rule.geoip!),
           domains: bypass.domains,
           ips: bypass.ips,
           keywords: bypass.keywords,
        },
        block: {
            geosites: geoAssets.filter(rule => isBlock(rule.type)).map(rule => rule.geosite),
            geoips: geoAssets.filter(rule => isBlock(rule.type) && rule.geoip).map(rule => rule.geoip!),
           domains: block.domains,
           ips: block.ips,
           keywords: block.keywords,
        }
    };
}

export function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function accDnsRules(geoAssets: GeoAsset[]) {
    const {
        localDNS,
        antiSanctionDNS,
        customBypassRules,
        customBypassSanctionRules,
        customBlockRules
    } = globalThis.settings;

    return {
        bypass: {
            localDNS: {
                geositeGeoips: geoAssets
                    .filter(({ type, geoip, dns }) => isBypass(type) && geoip && dns === localDNS)
                    .map(({ geosite, geoip }) => ({ geosite, geoip })),
                geosites: geoAssets
                    .filter(({ type, geoip, dns }) => isBypass(type) && !geoip && dns === localDNS)
                    .map(rule => rule.geosite),
                domains: customBypassRules.filter(isDomain)
            },
            antiSanctionDNS: {
                geosites: geoAssets
                    .filter(rule => isBypass(rule.type) && rule.dns === antiSanctionDNS)
                    .map(rule => rule.geosite),
                domains: customBypassSanctionRules.filter(isDomain)
            }
        },
        block: {
            geosites: geoAssets
                .filter(rule => isBlock(rule.type))
                .map(rule => rule.geosite),
            domains: customBlockRules.filter(isDomain)
        }
    };
}

export function toRange(min?: number, max?: number) {
    if (!min || !max) return undefined;
    if (min === max) return String(min);
    return `${min}-${max}`;
}

Array.prototype.concatIf = function <T>(condition: boolean, concat: T | T[]): T[] {
    if (!condition) return this;
    if (Array.isArray(concat)) return [...this, ...concat];
    return [...this, concat]
}

Object.prototype.omitEmpty = function <T>(): T | undefined {
    if (Object.keys(this).length === 0) return undefined;
    return this as T;
}