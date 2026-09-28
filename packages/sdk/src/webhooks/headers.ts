export type HeadersLike = Headers | Record<string, string | string[] | undefined>;

/** Case-insensitive; the first value of an array; undefined for absent or empty. */
export function readHeader(headers: HeadersLike, name: string): string | undefined {
  let value: string | string[] | null | undefined;
  if (headers instanceof Headers) {
    value = headers.get(name);
  } else {
    const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
    value = key === undefined ? undefined : headers[key];
  }
  const first = Array.isArray(value) ? value[0] : value;
  return first ? first : undefined;
}
