import type { CaptureDraft } from "@akasha/contracts"
import { collectXVideos, normalizeVideoPoster } from "@/utils/x-video"

export default defineContentScript({
  matches: [
    "https://x.com/*",
    "https://www.x.com/*",
    "https://twitter.com/*",
    "https://www.twitter.com/*",
  ],
  runAt: "document_start",
  world: "MAIN",
  main() {
    window.dispatchEvent(new Event("akasha:replace-video-observer"))
    const records = new Map<string, { draft: CaptureDraft; at: number }>()
    function collect(value: unknown) {
      for (const draft of collectXVideos(value)) {
        const key = normalizeVideoPoster(draft.thumbnailUrl ?? "")
        if (!key) continue
        records.delete(`${new URL(draft.pageUrl).pathname.split("/").at(-1)}|${key}`)
        records.set(`${new URL(draft.pageUrl).pathname.split("/").at(-1)}|${key}`, {
          draft,
          at: Date.now(),
        })
        const oldest = records.keys().next().value
        if (records.size > 100 && oldest) records.delete(oldest)
      }
    }
    function isPostResponse(value: string) {
      try {
        const url = new URL(value, location.href)
        return url.origin === location.origin && url.pathname.startsWith("/i/api/graphql/")
      } catch {
        return false
      }
    }
    const originalFetch = window.fetch
    const wrappedFetch: typeof window.fetch = async function (this: Window, ...args) {
      const response = await originalFetch.apply(this, args)
      if (isPostResponse(response.url)) {
        void response
          .clone()
          .text()
          .then((text) => {
            if (text.length <= 8_000_000) collect(JSON.parse(text))
          })
          .catch(() => undefined)
      }
      return response
    }
    window.fetch = wrappedFetch
    const originalSend = XMLHttpRequest.prototype.send
    const wrappedSend: typeof XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest,
      ...args
    ) {
      this.addEventListener(
        "load",
        () => {
          if (!isPostResponse(this.responseURL)) return
          try {
            if (this.responseType === "json") collect(this.response)
            else if (
              (!this.responseType || this.responseType === "text") &&
              this.responseText.length <= 8_000_000
            )
              collect(JSON.parse(this.responseText))
          } catch {
            /* Unrelated or incomplete responses are not capture candidates. */
          }
        },
        { once: true }
      )
      return originalSend.apply(this, args)
    }
    XMLHttpRequest.prototype.send = wrappedSend
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.type !== "akasha:video-source-request"
      )
        return
      const { poster, postUrl, nonce } = event.data
      if (
        typeof postUrl !== "string" ||
        typeof poster !== "string" ||
        typeof nonce !== "string" ||
        nonce.length > 100
      )
        return
      let statusId: string | undefined
      try {
        statusId = new URL(postUrl).pathname.split("/").at(-1)
      } catch {
        return
      }
      const key = normalizeVideoPoster(poster)
      const found = key ? records.get(`${statusId}|${key}`) : undefined
      window.postMessage(
        {
          type: "akasha:video-source-response",
          nonce,
          draft: found && Date.now() - found.at < 30 * 60_000 ? found.draft : null,
        },
        location.origin
      )
    }
    window.addEventListener("message", receive)
    const cleanup = () => {
      if (window.fetch === wrappedFetch) window.fetch = originalFetch
      if (XMLHttpRequest.prototype.send === wrappedSend)
        XMLHttpRequest.prototype.send = originalSend
      window.removeEventListener("message", receive)
      records.clear()
      window.removeEventListener("akasha:replace-video-observer", cleanup)
    }
    window.addEventListener("akasha:replace-video-observer", cleanup, { once: true })
  },
})
