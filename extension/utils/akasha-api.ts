import { type CaptureDraft, captureOutcomeSchema } from "@akasha/contracts"

const AUTH_STORAGE_KEY = "akashaDeviceCredential"
const LEGACY_AUTH_STORAGE_KEY = "stillroomGoogleAuth"

export type FolderOption = {
  depth: number
  id: string
  label: string
}

export type DedupeBackfillPage = {
  nextPageToken?: string
  restart?: boolean
  scannedCount: number
  updatedCount: number
}

export async function connectAkasha() {
  const redirectUrl = browser.identity.getRedirectURL("oauth2")
  const responseUrl = await browser.identity.launchWebAuthFlow({
    interactive: true,
    url: createAkashaAuthorizationUrl(getAkashaApiUrl(), redirectUrl),
  })

  if (!responseUrl) {
    throw new Error("Akasha authorization was cancelled.")
  }

  const credential = parseAkashaAuthorizationResponse(responseUrl)
  await browser.storage.local.set({ [AUTH_STORAGE_KEY]: credential })
  await browser.storage.local.remove(LEGACY_AUTH_STORAGE_KEY)
  return listFolderOptions()
}

export async function listFolderOptions(signal?: AbortSignal) {
  const response = await authenticatedRequest("/api/extension/folders", {
    signal,
  })
  const body = (await response.json()) as {
    folders: Array<Omit<FolderOption, "depth"> & { depth?: number }>
  }
  return normalizeFolderOptions(body.folders)
}

export function normalizeFolderOptions(
  folders: Array<Omit<FolderOption, "depth"> & { depth?: number }>
) {
  return folders.map((folder) => {
    const legacyIndent = folder.label.match(/^(?:— )+/)?.[0] ?? ""
    return {
      depth: folder.depth ?? legacyIndent.length / 2,
      id: folder.id,
      label: folder.label.slice(legacyIndent.length),
    }
  })
}

export async function saveCapture(
  draft: CaptureDraft,
  folderId: string,
  captureId: string,
  attempt: number
) {
  const response = await authenticatedRequest("/api/extension/captures", {
    body: JSON.stringify({ ...draft, attempt, captureId, folderId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
  const body = (await response.json()) as { outcome?: unknown }

  return {
    outcome: captureOutcomeSchema.parse(body.outcome ?? "saved"),
  }
}

export async function backfillDuplicateMetadata(pageToken?: string) {
  const response = await authenticatedRequest("/api/extension/dedupe", {
    body: JSON.stringify({ pageToken }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })

  return (await response.json()) as DedupeBackfillPage
}

export async function hasAkashaCredential() {
  return Boolean(await readCredential())
}

export function createAkashaAuthorizationUrl(apiUrl: string, redirectUrl: string) {
  const url = new URL("/api/extension/auth", apiUrl)
  url.searchParams.set("redirect_uri", redirectUrl)
  return url.toString()
}

export function parseAkashaAuthorizationResponse(responseUrl: string) {
  const response = new URL(responseUrl)
  const params = new URLSearchParams(response.hash.slice(1))
  const credential = params.get("credential")

  if (params.get("error") || !credential) {
    throw new Error("Akasha authorization was not completed.")
  }

  return credential
}

async function authenticatedRequest(path: string, init?: RequestInit) {
  const credential = await readCredential()

  if (!credential) {
    throw new Error("Connect Akasha to continue.")
  }

  const response = await fetch(new URL(path, getAkashaApiUrl()), {
    ...init,
    headers: {
      Authorization: `Bearer ${credential}`,
      ...init?.headers,
    },
  })
  const rotatedCredential = response.headers.get("X-Akasha-Credential")

  if (rotatedCredential) {
    await browser.storage.local.set({ [AUTH_STORAGE_KEY]: rotatedCredential })
  }

  if (response.status === 401) {
    await browser.storage.local.remove(AUTH_STORAGE_KEY)
    throw new AkashaApiError("Connect Akasha to continue.", 401)
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new AkashaApiError(body?.error ?? "Akasha could not reach your library.", response.status)
  }

  return response
}

export class AkashaApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "AkashaApiError"
  }

  get retryable() {
    return this.status === 408 || this.status === 429 || this.status >= 500
  }
}

async function readCredential() {
  const result = await browser.storage.local.get(AUTH_STORAGE_KEY)
  return result[AUTH_STORAGE_KEY] as string | undefined
}

function getAkashaApiUrl() {
  const configuredUrl = import.meta.env.WXT_AKASHA_API_URL?.trim() || "http://localhost:3000"
  const url = new URL(configuredUrl)

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Akasha API URL must use HTTP or HTTPS.")
  }

  return url.toString()
}
