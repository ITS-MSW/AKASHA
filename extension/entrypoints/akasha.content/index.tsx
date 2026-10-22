import { Button } from "@heroui/react"
import { enableShadowDOM } from "@react-stately/flags"
import { createRoot } from "react-dom/client"
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root"
import { findSmallestMediaAtPoint, getMediaActionPosition } from "@/utils/media"
import type { OpenCapturePanelMessage } from "@/utils/messages"
import { discoverVideo } from "@/utils/video-discovery"
import { discoverXImages, isPostVisible, normalizeXImageUrl } from "@/utils/x-images"
import App from "./App"
import "./style.css"

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "ui",
  async main(ctx) {
    enableShadowDOM()
    const ui = await createShadowRootUi(ctx, {
      name: "akasha-capture",
      position: "modal",
      zIndex: 2_147_483_647,
      isolateEvents: true,
      onMount(container) {
        const root = createRoot(container)
        root.render(<App onClose={() => ui.remove()} />)
        return root
      },
      onRemove(root) {
        root?.unmount()
      },
    })

    let preparing = false
    let hoveredVideo: HTMLVideoElement | null = null
    let actionRoot: ReturnType<typeof createRoot> | undefined
    let actionPosition = { left: 0, top: 0 }
    const action = await createShadowRootUi(ctx, {
      name: "akasha-video-action",
      position: "overlay",
      zIndex: 2_147_483_646,
      anchor: "body",
      isolateEvents: true,
      onMount(container) {
        actionRoot = createRoot(container)
        return actionRoot
      },
      onRemove(root) {
        root?.unmount()
        actionRoot = undefined
      },
    })
    function renderAction(video: HTMLVideoElement) {
      actionPosition = getMediaActionPosition(video.getBoundingClientRect(), {
        actionHeight: 32,
        actionWidth: 64,
        inset: 8,
        viewportHeight: innerHeight,
        viewportWidth: innerWidth,
      })
      if (!action.mounted) {
        action.mount()
        Object.assign(action.shadowHost.style, { position: "fixed", top: "0", left: "0" })
      }
      actionRoot?.render(
        <div
          className="dark"
          style={{
            position: "fixed",
            ...actionPosition,
            zIndex: 2147483646,
            fontFamily: "sans-serif",
          }}
        >
          <Button
            size="sm"
            aria-label="Save video to Akasha"
            onPress={async () => {
              if (preparing) return
              preparing = true
              try {
                const draft = await discoverVideo(video)
                const result = await browser.runtime.sendMessage({
                  type: "akasha:prepare-video",
                  draft,
                })
                if (result?.ok && !ui.mounted) {
                  action.remove()
                  ui.mount()
                }
              } finally {
                preparing = false
              }
            }}
          >
            Save
          </Button>
        </div>
      )
    }
    const trackVideo = (event: PointerEvent) => {
      if (event.composedPath().includes(action.shadowHost)) return
      const video = findSmallestMediaAtPoint(
        Array.from(document.querySelectorAll("video")),
        event.clientX,
        event.clientY
      )
      hoveredVideo = video ?? null
      if (video && !ui.mounted) renderAction(video)
      else action.remove()
    }
    const reposition = () => {
      const rect = hoveredVideo?.getBoundingClientRect()
      if (
        hoveredVideo?.isConnected &&
        rect &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        rect.right > 0 &&
        rect.left < innerWidth &&
        !ui.mounted
      )
        renderAction(hoveredVideo)
      else action.remove()
    }
    document.addEventListener("pointermove", trackVideo, { passive: true, capture: true })
    document.addEventListener("scroll", reposition, { passive: true, capture: true })
    let clickedVideo: HTMLVideoElement | null = null
    let clickedImage: HTMLImageElement | null = null
    let clickedPage = ""
    const rememberImage = (event: MouseEvent) => {
      clickedVideo =
        event.target instanceof HTMLVideoElement
          ? event.target
          : (findSmallestMediaAtPoint(
              Array.from(document.querySelectorAll("video")),
              event.clientX,
              event.clientY
            ) ?? null)
      clickedImage = event.target instanceof HTMLImageElement ? event.target : null
      clickedPage = location.href
    }
    document.addEventListener("contextmenu", rememberImage, true)
    const discover = (message: { type: string; srcUrl?: string }) => {
      if (message?.type === "akasha:discover-video")
        return clickedVideo && clickedPage === location.href
          ? discoverVideo(clickedVideo, message.srcUrl)
          : Promise.resolve(null)
      if (message?.type !== "akasha:discover-images") return
      if (
        !clickedImage?.isConnected ||
        clickedPage !== location.href ||
        !message.srcUrl ||
        !normalizeXImageUrl(message.srcUrl) ||
        normalizeXImageUrl(clickedImage.currentSrc || clickedImage.src) !==
          normalizeXImageUrl(message.srcUrl)
      )
        return Promise.resolve([])
      return Promise.resolve(discoverXImages(clickedImage, location.href, document.title))
    }
    browser.runtime.onMessage.addListener(discover)
    const openPanel = (message: OpenCapturePanelMessage) => {
      if (message?.type !== "akasha:open-capture") return
      if (
        message.onlyIfPostUrl &&
        (ui.mounted ||
          message.pageUrl !== location.href ||
          !isPostVisible(message.onlyIfPostUrl, location.href))
      )
        return Promise.resolve({ ok: false })
      if (!ui.mounted) ui.mount()
      return Promise.resolve({ ok: true })
    }

    browser.runtime.onMessage.addListener(openPanel)
    ctx.onInvalidated(() => {
      action.remove()
      document.removeEventListener("pointermove", trackVideo, true)
      document.removeEventListener("scroll", reposition, true)
      browser.runtime.onMessage.removeListener(openPanel)
      browser.runtime.onMessage.removeListener(discover)
      document.removeEventListener("contextmenu", rememberImage, true)
    })
  },
})
