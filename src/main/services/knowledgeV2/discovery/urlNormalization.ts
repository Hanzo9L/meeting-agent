export interface NormalizedLearnUrl {
  canonicalUrl: string;
  locale: string | null;
  articlePath: string;
  hostname: string;
}

const LOCALE_SEGMENT = /^[a-z]{2}-[a-z]{2}$/i;

export function normalizeLearnUrl(inputUrl: string): NormalizedLearnUrl | null {
  let url: URL;
  try {
    url = new URL(inputUrl.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/i.test(url.protocol)) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }

  const first = segments[0]?.toLowerCase() ?? "";
  const hasLocale = LOCALE_SEGMENT.test(first);
  const locale = hasLocale ? first : null;
  const pathWithoutLocale = hasLocale ? segments.slice(1) : segments;
  if (pathWithoutLocale.length === 0) {
    return null;
  }
  const articlePath = `/${pathWithoutLocale.map((segment) => segment.toLowerCase()).join("/")}`;
  const canonicalPath = `/${[locale ?? "en-us", ...pathWithoutLocale.map((segment) => segment.toLowerCase())].join("/")}`;
  const canonicalUrl = `https://${hostname}${canonicalPath}`;
  return {
    canonicalUrl,
    locale,
    articlePath,
    hostname
  };
}
