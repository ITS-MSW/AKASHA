import type { FolderOption } from "./akasha-api"

export type ExtensionRequest =
  | { type: "akasha:connect" }
  | { type: "akasha:list-folders" }
  | {
      type: "akasha:save"
      selectionId: string
      sourceUrls: string[]
      folderId: string
    }

export type ExtensionResponse<T> = { ok: true; value: T } | { ok: false; error: string }

export type OpenCapturePanelMessage = {
  type: "akasha:open-capture"
  onlyIfPostUrl?: string
  pageUrl?: string
}

export async function callExtension<T>(request: ExtensionRequest) {
  const response = (await browser.runtime.sendMessage(request)) as ExtensionResponse<T>

  if (!response.ok) {
    throw new Error(response.error)
  }

  return response.value
}

export function connectLibrary() {
  return callExtension<FolderOption[]>({ type: "akasha:connect" })
}

export function getFolderOptions() {
  return callExtension<FolderOption[]>({ type: "akasha:list-folders" })
}

export function saveLibraryCapture(selectionId: string, sourceUrls: string[], folderId: string) {
  return callExtension<{ captureIds: string[] }>({
    type: "akasha:save",
    selectionId,
    sourceUrls,
    folderId,
  })
}
