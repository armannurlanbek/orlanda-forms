// Resolve the real client IP behind the Cloudflare tunnel.
import type { Request } from 'express';

export function getClientIp(req: Request): string {
  const cf = req.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = req.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.ip ?? 'unknown';
}

// Truncate to a /24 (IPv4) or /48 (IPv6) for privacy-preserving storage (§16.9).
export function anonymizeIp(ip: string): string {
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return parts.slice(0, 3).join(':') + '::';
  }
  return ip;
}
