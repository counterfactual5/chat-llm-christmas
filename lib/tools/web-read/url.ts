/**
 * URL normalization and SSRF-ish hostname blocking for web_read.
 */

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') return true;
  if (host === '::1' || host === '[::1]') return true;
  if (host === 'metadata.google.internal') return true;

  // IPv4 literal (including decimal / short forms normalized by URL)
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map((p) => Number(p));
    if (parts.some((n) => n > 255)) return true;
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }

  // IPv6 literals arrive without brackets from URL.hostname
  if (host.includes(':')) {
    if (host === '::1') return true;
    if (host.startsWith('fc') || host.startsWith('fd')) return true; // ULA
    if (host.startsWith('fe80')) return true; // link-local
    // IPv4-mapped IPv6 ::ffff:x.x.x.x
    const mapped = host.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (mapped) return isBlockedHostname(mapped[1]);
  }

  return false;
}

export function normalizeUrl(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (isBlockedHostname(u.hostname)) return null;
    return u.toString();
  } catch {
    try {
      const u = new URL(`https://${s}`);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (isBlockedHostname(u.hostname)) return null;
      return u.toString();
    } catch {
      return null;
    }
  }
}

