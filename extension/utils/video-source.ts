export function resolveDownloadableVideoUrl({
  currentSrc,
  sourceUrls = [],
}: {
  currentSrc?: string
  sourceUrls?: string[]
}) {
  for (const value of [currentSrc, ...sourceUrls]) {
    if (!value) continue
    try {
      const url = new URL(value)
      if (["http:", "https:"].includes(url.protocol) && /\.(mp4|webm)$/i.test(url.pathname))
        return url.toString()
    } catch {
      /* Ignore non-file sources, including blob players. */
    }
  }
}

export function resolveXStatusUrl(hrefs: string[], pageUrl: string) {
  for (const href of hrefs) {
    try {
      const url = new URL(href, pageUrl)
      if (
        !isXHostname(url.hostname) ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port
      )
        continue
      if (!/^\/[A-Za-z0-9_]+\/status\/\d+\/?$/.test(url.pathname)) continue
      url.hostname = "x.com"
      url.pathname = url.pathname.replace(/\/$/, "")
      url.search = ""
      url.hash = ""
      return url.toString()
    } catch {
      // Ignore malformed links collected from the page.
    }
  }
}

function isXHostname(hostname: string) {
  return ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(hostname)
}
