export const POPUP_NAME = 'fianto-checkout';

export function popupFeatures(width = 480, height = 720): string {
  const left = Math.max(0, Math.round((window.screenX ?? 0) + ((window.outerWidth || width) - width) / 2));
  const top = Math.max(0, Math.round((window.screenY ?? 0) + ((window.outerHeight || height) - height) / 2));
  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
}

/** A same-origin about:blank popup: fill it so the payer sees something while the session is created. */
export function showLoading(popup: Window): void {
  try {
    const doc = popup.document;
    doc.title = 'Secure checkout';
    const p = doc.createElement('p');
    p.textContent = 'Loading secure checkout…';
    p.setAttribute('style', 'font:16px system-ui,sans-serif;text-align:center;margin-top:40vh;color:#444');
    doc.body.replaceChildren(p);
  } catch {
    // A reused popup already on the checkout origin is cross-origin: nothing to write, nothing lost.
  }
}
