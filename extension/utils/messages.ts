import type { FolderOption } from "./akasha-api"

export type ExtensionRequest =
  | { type: "akasha:prepare-video"; draft: unknown }
  | { type: "akasha:connect" }
  | { type: "akasha:list-folders"; refresh?: boolean }
  | {
      type: "akasha:save"
      selectionId: string
      sourceUrls: string[]
      folderId: string
    }

export type ExtensionResponse<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status?: number }

export class ExtensionCallError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = "ExtensionCallError"
  }
}

export type OpenCapturePanelMessage = {
  type: "akasha:open-capture"
  onlyIfPostUrl?: string
  pageUrl?: string
}

export async function callExtension<T>(request: ExtensionRequest) {
  const response = (await browser.runtime.sendMessage(request)) as ExtensionResponse<T>

  if (!response.ok) {
    throw new ExtensionCallError(response.error, response.status)
  }

  return response.value
}

export function connectLibrary() {
  return callExtension<FolderOption[]>({ type: "akasha:connect" })
}

export function getFolderOptions(refresh = false) {
  return callExtension<FolderOption[]>({ type: "akasha:list-folders", refresh })
}

export function saveLibraryCapture(selectionId: string, sourceUrls: string[], folderId: string) {
  return callExtension<{ captureIds: string[] }>({
    type: "akasha:save",
    selectionId,
    sourceUrls,
    folderId,
  })
}
