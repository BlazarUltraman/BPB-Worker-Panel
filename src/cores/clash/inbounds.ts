import { Sniffer, Tun } from "types/clash";

export function buildSniffer(fakeDNS: boolean): Sniffer {
    const enabled = !fakeDNS;
    return {
        "enable": enabled,
        "force-dns-mapping": enabled,
        "parse-pure-ip": enabled,
        "override-destination": enabled,
        "sniff": {
            "HTTP": {
                "ports": [80, 8080, 8880, 2052, 2082, 2086, 2095]
            },
            "TLS": {
                "ports": [443, 8443, 2053, 2083, 2087, 2096]
            }
        }
    };
}