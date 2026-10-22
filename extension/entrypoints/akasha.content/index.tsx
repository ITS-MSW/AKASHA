import { createRoot } from "react-dom/client"
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root"
import type { OpenCapturePanelMessage } from "@/utils/messages"
import { discoverXImages, isPostVisible, normalizeXImageUrl } from "@/utils/x-images"
import App from "./App"
import "./style.css"

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "ui",
  async main(ctx) {
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

    let clickedImage: HTMLImageElement | null = null
    let clickedPage = ""
    const rememberImage = (event: MouseEvent) => {
      clickedImage = event.target instanceof HTMLImageElement ? event.target : null
      clickedPage = location.href
    }
    document.addEventListener("contextmenu", rememberImage, true)
    const discover = (message: { type: string; srcUrl?: string }) => {
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
      browser.runtime.onMessage.removeListener(openPanel)
      browser.runtime.onMessage.removeListener(discover)
      document.removeEventListener("contextmenu", rememberImage, true)
    })
  },
})
