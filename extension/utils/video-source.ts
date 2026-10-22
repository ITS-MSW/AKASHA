type VideoSourceCandidates = {
  currentSrc?: string
  embeddedUrls?: string[]
  performanceUrls?: string[]
  sourceUrls?: string[]
}

const VIDEO_PATH_PATTERN = /\.(?:mp4|webm)(?:$|[?#])/i

export function resolveDownloadableVideoUrl({
  currentSrc,
  embeddedUrls = [],
  performanceUrls = [],
  sourceUrls = [],
}: VideoSourceCandidates) {
  const candidates = [
    ...sourceUrls.map((url) => ({ score: 80_000_000, url })),
    ...(currentSrc ? [{ score: 100_000_000, url: currentSrc }] : []),
    ...performanceUrls.map((url, index) => ({ score: 20_000_000 + index, url })),
    ...embeddedUrls.map((url, index) => ({ score: 10_000_000 - index * 100, url })),
  ]

  return candidates
    .map(({ score, url }) => ({
      score: score + getProviderScore(url) + getQualityScore(url),
      url: normalizeVideoUrl(url),
    }))
    .filter((candidate): candidate is { score: number; url: string } => Boolean(candidate.url))
    .sort((left, right) => right.score - left.score)[0]?.url
}

export function extractEmbeddedVideoUrls(scriptText: string) {
  const normalized = scriptText
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")

  return (normalized.match(/https?:\/\/[^"'\\\s<>]+/g) ?? [])
    .map(normalizeVideoUrl)
    .filter((url): url is string => Boolean(url))
}

export function inferVideoMimeType(url: string) {
  return new URL(url).pathname.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4"
}

export function resolveXStatusUrl(hrefs: string[], pageUrl: string) {
  for (const href of hrefs) {
    try {
      const url = new URL(href, pageUrl)
      if (!isXHostname(url.hostname)) continue
      if (!/^\/[A-Za-z0-9_]+\/status\/\d+\/?$/.test(url.pathname)) continue
      url.search = ""
      url.hash = ""
      return url.toString()
    } catch {
      // Ignore malformed links collected from the page.
    }
  }
}

function normalizeVideoUrl(value: string) {
  try {
    const url = new URL(value.replace(/&amp;/g, "&"))
    if (!["http:", "https:"].includes(url.protocol)) return undefined
    if (url.hostname === "abs.twimg.com") return undefined
    if (url.hostname === "pbs.twimg.com" && url.pathname.startsWith("/static/")) return undefined
    if (!VIDEO_PATH_PATTERN.test(`${url.pathname}${url.search}${url.hash}`)) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function isXHostname(hostname: string) {
  return (
    hostname === "x.com" ||
    hostname === "www.x.com" ||
    hostname === "twitter.com" ||
    hostname.endsWith(".twitter.com")
  )
}

function getQualityScore(value: string) {
  const dimensions = value.match(/(?:^|[/_-])(\d{2,4})x(\d{2,4})(?:[/_.-]|$)/i)
  const namedQuality = value.match(/(?:^|[/_-])(\d{3,4})p(?:[/_.-]|$)/i)
  const compatibilityScore = /hevc/i.test(value) ? -10_000 : /expMp4/i.test(value) ? -5_000 : 0

  if (dimensions) return compatibilityScore + Number(dimensions[2])
  if (namedQuality) return compatibilityScore + Number(namedQuality[1])
  return compatibilityScore
}

function getProviderScore(value: string) {
  try {
    const url = new URL(value.replace(/&amp;/g, "&"))
    if (url.hostname === "video.twimg.com") return 100_000_000
    if (url.hostname.endsWith("pinimg.com") && url.pathname.includes("/videos/")) {
      return 50_000_000
    }
    if (/\/(?:vid|videos)\//i.test(url.pathname)) return 5_000_000
    return 0
  } catch {
    return 0
  }
}
