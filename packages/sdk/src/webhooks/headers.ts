export type HeadersLike = Headers | { get(name: string): string | null } | Record<string, string | string[] | undefined>;

function hasGet(headers: HeadersLike): headers is { get(name: string): string | null } {
  return typeof (headers as { get?: unknown }).get === 'function';
}

/** Case-insensitive; the first value of an array; undefined for absent or empty. */
export function readHeader(headers: HeadersLike, name: string): string | undefined {
  let value: string | string[] | null | undefined;
  if (hasGet(headers)) {
    value = headers.get(name);
  } else {
    const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
    value = key === undefined ? undefined : (headers as Record<string, string | string[] | undefined>)[key];
  }
  const first = Array.isArray(value) ? value[0] : value;
  return first ? first : undefined;
}
