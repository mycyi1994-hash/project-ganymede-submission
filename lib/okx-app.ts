/**
 * OKX's universal link that opens a page in the OKX app's built-in browser, where OKX Wallet is
 * already connected: on a phone without the extension, this is the one-tap way in.
 */
export function okxAppUrl(pageUrl: string): string {
  return `https://www.okx.com/download?deeplink=${encodeURIComponent(`okx://wallet/dapp/url?dappUrl=${encodeURIComponent(pageUrl)}`)}`;
}
