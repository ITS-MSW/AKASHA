import { createFileRoute } from "@tanstack/react-router"

import {
  getSessionGoogleCredentials,
  useStillroomSession,
} from "@/server/auth/session.server"
import {
  createDriveMediaRequestHeaders,
  createMediaProxyResponse,
  createThumbnailProxyResponse,
} from "@/server/drive/media-proxy.server"
import {
  fetchDriveThumbnail,
  verifyDriveThumbnailToken,
} from "@/server/drive/drive-thumbnail.server"
import { createDriveClient } from "@/server/drive/drive.server"

export const Route = createFileRoute("/api/media/$fileId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!process.env.SESSION_SECRET) {
          return new Response("Library access is not available.", {
            status: 401,
          })
        }

        const session = await useStillroomSession()
        if (!session.data.googleRefreshToken) {
          return new Response("Library access is required.", { status: 401 })
        }

        const credentials = await getSessionGoogleCredentials(session)

        if (!credentials) {
          return new Response("Library access expired.", { status: 401 })
        }

        const previewToken = new URL(request.url).searchParams.get("preview")
        if (previewToken) {
          let thumbnailPayload: ReturnType<typeof verifyDriveThumbnailToken>

          try {
            thumbnailPayload = verifyDriveThumbnailToken(previewToken, {
              secret: process.env.SESSION_SECRET,
            })
          } catch {
            return new Response("Media could not be loaded.", { status: 400 })
          }

          if (thumbnailPayload.fileId !== params.fileId) {
            return new Response("Media could not be loaded.", { status: 400 })
          }

          let thumbnailResponse = await fetchDriveThumbnail(
            thumbnailPayload.thumbnailUrl,
            credentials.accessToken,
            request.headers
          )

          if ([401, 403, 404].includes(thumbnailResponse.status)) {
            const drive = createDriveClient(credentials)
            const refreshedFile = await drive.files.get({
              fields: "thumbnailLink",
              fileId: params.fileId,
            })

            if (refreshedFile.data.thumbnailLink) {
              thumbnailResponse = await fetchDriveThumbnail(
                refreshedFile.data.thumbnailLink,
                credentials.accessToken,
                request.headers
              )
            }
          }

          if (!thumbnailResponse.ok && thumbnailResponse.status !== 304) {
            return new Response("Media could not be loaded.", {
              status: thumbnailResponse.status,
            })
          }

          return createThumbnailProxyResponse(thumbnailResponse)
        }

        const driveResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(params.fileId)}?alt=media`,
          {
            signal: request.signal,
            headers: createDriveMediaRequestHeaders(
              request.headers,
              credentials.accessToken
            ),
          }
        )

        if (!driveResponse.ok && ![304, 416].includes(driveResponse.status)) {
          return new Response("Media could not be loaded.", {
            status: driveResponse.status,
          })
        }

        return createMediaProxyResponse(driveResponse)
      },
    },
  },
})
