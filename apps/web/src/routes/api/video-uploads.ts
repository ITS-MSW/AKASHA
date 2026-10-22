import { createFileRoute } from "@tanstack/react-router"
import { videoUploadChunkBytes } from "@akasha/contracts"
import {
  getSessionGoogleCredentials,
  useStillroomSession,
} from "@/server/auth/session.server"
import { CaptureSourceError } from "@/server/drive/drive.server"
import { LibraryUploadDestinationError } from "@/server/drive/library-upload.server"
import {
  continueVideoUpload,
  startVideoUpload,
  videoUploadInput,
} from "@/server/drive/video-upload.server"
import { isSameOriginUploadRequest } from "./uploads"

export const Route = createFileRoute("/api/video-uploads")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      PUT: ({ request }) => handle(request),
    },
  },
})

async function handle(request: Request) {
  const headers = {
    "Cache-Control": "private, no-store",
    Vary: "Cookie, Authorization",
    "X-Content-Type-Options": "nosniff",
  }
  if (!isSameOriginUploadRequest(request))
    return Response.json(
      { error: "Could not verify upload request." },
      { status: 403, headers }
    )
  const credentials = await getSessionGoogleCredentials(
    await useStillroomSession()
  )
  if (!credentials)
    return Response.json(
      { error: "Connect your library before uploading." },
      { status: 401, headers }
    )
  try {
    const token = request.headers.get("X-Akasha-Upload")
    const limit = request.method === "PUT" ? videoUploadChunkBytes : 4096
    const reader = request.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    if (reader) {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.length
          if (size > limit) {
            await reader.cancel()
            return Response.json(
              { error: "Upload chunk is too large." },
              { status: 413, headers }
            )
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
    }
    const bytes = Buffer.concat(chunks)
    if (request.method === "PUT" && !token)
      return Response.json(
        { error: "Upload session is missing." },
        { status: 400, headers }
      )
    const input = token
      ? null
      : videoUploadInput.safeParse(JSON.parse(bytes.toString()))
    if (!token && !input?.success)
      return Response.json(
        { error: "Choose an MP4 or WebM video up to 50 MiB." },
        { status: 400, headers }
      )
    const result = token
      ? await continueVideoUpload(
          credentials,
          token,
          request.method === "PUT"
            ? {
                offset: Number(
                  request.headers.get("X-Akasha-Offset") ?? "invalid"
                ),
                bytes,
              }
            : undefined
        )
      : await startVideoUpload(credentials, input!.data!)
    return Response.json(result, { headers })
  } catch (error) {
    const invalid =
      error instanceof CaptureSourceError ||
      error instanceof LibraryUploadDestinationError
    return Response.json(
      {
        error: invalid
          ? error.message
          : "The upload was interrupted. Retry to continue.",
      },
      { status: invalid ? 422 : 502, headers }
    )
  }
}
