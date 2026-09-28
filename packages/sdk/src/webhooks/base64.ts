const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64.test(value) || value.length % 4 !== 0) return null;
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
