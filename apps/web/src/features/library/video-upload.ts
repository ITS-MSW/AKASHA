import { videoUploadChunkBytes } from "@akasha/contracts"
import type { CaptureOutcome } from "@akasha/contracts"
import { z } from "zod"
import { toast } from "@heroui/react"

const pendingVideoSchema = z.object({
  id: z.string(),
  token: z.string().max(12000),
  fileName: z.string(),
  sha256: z.string(),
  folderId: z.string(),
  folderName: z.string(),
  byteSize: z.number(),
  mimeType: z.string(),
  createdAt: z.number(),
})
export type PendingVideoUpload = z.infer<typeof pendingVideoSchema>
export const emptyPendingVideos: PendingVideoUpload[] = []
export function parsePendingVideos(value: unknown) {
  return z
    .array(pendingVideoSchema)
    .parse(value)
    .filter((item) => Date.now() - item.createdAt < 6 * 24 * 60 * 60_000)
}
export function reportUploadStorageError() {
  toast.warning("Keep this tab open. Upload progress could not be saved.")
}

type Progress = { offset: number; token?: string; outcome?: CaptureOutcome }
async function requestUpload(init: RequestInit): Promise<Progress> {
  const response = await fetch("/api/video-uploads", {
    ...init,
    signal: AbortSignal.timeout(45_000),
  })
  const body = (await response.json()) as Progress & { error?: string }
  if (!response.ok)
    throw new Error(body.error || "Upload interrupted. Retry to continue.")
  if (!Number.isSafeInteger(body.offset) || body.offset < 0)
    throw new Error("Could not read upload progress.")
  return body
}

export async function uploadVideo(
  file: File,
  task: {
    id: string
    folderId: string
    folderName: string
    resume?: PendingVideoUpload
  },
  onSession: (session: PendingVideoUpload) => void,
  onProgress: (percent: number, saving: boolean) => void
) {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
  const sha256 = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  if (
    task.resume &&
    (task.resume.sha256 !== sha256 ||
      task.resume.byteSize !== file.size ||
      task.resume.mimeType !== file.type)
  )
    throw new Error("Select the same video to resume this upload.")
  let session = task.resume
  if (!session) {
    const created = await requestUpload({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        folderId: task.folderId,
        mimeType: file.type,
        byteSize: file.size,
        sha256,
      }),
    })
    if (!created.token) throw new Error("Could not start upload.")
    session = {
      id: task.id,
      token: created.token,
      sha256,
      fileName: file.name,
      folderId: task.folderId,
      folderName: task.folderName,
      byteSize: file.size,
      mimeType: file.type,
      createdAt: Date.now(),
    }
    onSession(session)
  }
  const headers = { "X-Akasha-Upload": session.token }
  let progress = await requestUpload({ method: "POST", headers })
  while (!progress.outcome && progress.offset < file.size) {
    const offset = progress.offset
    progress = await requestUpload({
      method: "PUT",
      headers: {
        ...headers,
        "X-Akasha-Offset": String(offset),
        "Content-Type": "application/octet-stream",
      },
      body: file.slice(offset, offset + videoUploadChunkBytes),
    })
    if (progress.offset <= offset || progress.offset > file.size)
      throw new Error("Upload interrupted. Retry to continue.")
    onProgress(
      Math.round((progress.offset / file.size) * 100),
      progress.offset === file.size
    )
  }
  if (!progress.outcome)
    progress = await requestUpload({ method: "POST", headers })
  if (!progress.outcome)
    throw new Error("Could not finish upload. Retry to continue.")
  return progress.outcome
}
