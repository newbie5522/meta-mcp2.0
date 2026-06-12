import { promises as dns } from "node:dns";
import { isIP } from "node:net";

const ALLOWED_PROTOCOLS = new Set(["https:"]);

const PRIVATE_V4_RANGES: Array<[bigint, bigint, string]> = [
  [bn("10.0.0.0"), bn("10.255.255.255"), "RFC1918 10.0.0.0/8"],
  [bn("172.16.0.0"), bn("172.31.255.255"), "RFC1918 172.16.0.0/12"],
  [bn("192.168.0.0"), bn("192.168.255.255"), "RFC1918 192.168.0.0/16"],
  [bn("127.0.0.0"), bn("127.255.255.255"), "loopback 127.0.0.0/8"],
  [bn("169.254.0.0"), bn("169.254.255.255"), "link-local 169.254.0.0/16"],
  [bn("0.0.0.0"), bn("0.255.255.255"), "current-network 0.0.0.0/8"],
  [bn("100.64.0.0"), bn("100.127.255.255"), "CGNAT 100.64.0.0/10"],
  [bn("224.0.0.0"), bn("239.255.255.255"), "multicast 224.0.0.0/4"],
  [bn("240.0.0.0"), bn("255.255.255.255"), "reserved 240.0.0.0/4"],
];

function bn(ipv4: string): bigint {
  return ipv4
    .split(".")
    .reduce<bigint>((acc, oct) => (acc << 8n) | BigInt(Number.parseInt(oct, 10)), 0n);
}

function isPrivateV4(ip: string): string | null {
  if (isIP(ip) !== 4) return null;
  const value = bn(ip);
  for (const [lo, hi, label] of PRIVATE_V4_RANGES) {
    if (value >= lo && value <= hi) return label;
  }
  return null;
}

function isPrivateV6(ip: string): string | null {
  if (isIP(ip) !== 6) return null;
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return "IPv6 loopback/unspecified";
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return "IPv6 link-local fe80::/10";
  }
  if (/^f[cd]/.test(lower)) return "IPv6 unique-local fc00::/7";
  return null;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export function unsafeIpReason(ip: string): string | null {
  return isPrivateV4(ip) ?? isPrivateV6(ip);
}

export async function assertSafePublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`URL is malformed: ${raw}`);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeUrlError(`URL protocol "${url.protocol}" is not allowed; only https:`);
  }

  const bareHost = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;

  const literalIpVersion = isIP(bareHost);
  if (literalIpVersion) {
    const reason = unsafeIpReason(bareHost);
    if (reason) throw new UnsafeUrlError(`URL points at private IP (${reason})`);
    return url;
  }

  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  for (const { address } of addresses) {
    const reason = unsafeIpReason(address);
    if (reason) {
      throw new UnsafeUrlError(`Hostname ${url.hostname} resolves to private IP ${address} (${reason})`);
    }
  }

  return url;
}
