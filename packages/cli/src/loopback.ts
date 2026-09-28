/**
 * True for a URL whose host is `localhost`, an IPv4 address in `127.0.0.0/8`, or the IPv6
 * loopback `[::1]`. Used to gate `trigger --forward-to`: without this, a validly-signed fake
 * business event could be POSTed to any URL on the internet and mistaken for a real delivery
 * (C5).
 */
export function isLoopbackUrl(url: string): boolean {
  let hostname: string;
  try {
    ({ hostname } = new URL(url));
  } catch {
    return false;
  }
  // WHATWG URL parsing always keeps the brackets on an IPv6 hostname (`new URL('http://[::1]/')
  // .hostname === '[::1]'`, never the bare `::1`), so there is no unbracketed form to check.
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) && octets[0] === 127;
}
