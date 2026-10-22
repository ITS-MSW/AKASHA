import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "wxt"

const extensionKey =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjO1vMpQeepjTCuJpNXNqRAtT3r1JIAA7cF/vC7JncEY8taIaNAm8N3A6BUGrj/TVOGKQFM1+3LPT0RjLeLcOuxLLeRDgbKcT0D5zei89MbAvBwb+wNTwDKrgVBLkBE60LIpbu1vVmYx3cdIiPYWJ9BTuDk9PwLcIjHUsm+ActagDSkGVb1ar+jEm/c/szJX7pxaG5CV8gmPvlNfjpOQGxYIlHtenRaMzCEiyyGwoD4NaA4hmSu4QkrMRWlePewkscGws2lpHeQKsIh45XoxgZcaEPALKLKhnvOog91OcpqVHmKjmcGmVPfbfoDl6xvdn015n8JwqAdSt+SI49E8ynQIDAQAB"

export default defineConfig({
  vite: () => ({ plugins: [tailwindcss()] }),
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Akasha Capture",
    description: "Capture visual inspiration into your Akasha library.",
    key: extensionKey,
    action: {},
    permissions: ["alarms", "contextMenus", "identity", "notifications", "scripting", "storage"],
    host_permissions: ["<all_urls>"],
  },
})
