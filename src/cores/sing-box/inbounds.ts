import { MixedInbound, TunInbound } from "types/sing-box";

export function buildTunInbound(mtu: number): TunInbound {
    return {
        type: "tun",
        tag: "tun-in",
        address: ["172.19.0.1/28"],
        mtu: mtu || 1500,
        auto_route: true,
        strict_route: true,
        stack: "mixed"
    };
}

export function buildMixedInbound(): MixedInbound {
    const { allowLANConnection } = globalThis.settings;
    return {
        type: "mixed",
        tag: "mixed-in",
        listen: allowLANConnection ? "0.0.0.0" : "127.0.0.1",
        listen_port: 2080
    };
}