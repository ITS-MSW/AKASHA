const FORWARDED_REQUEST_HEADERS = [
  "If-None-Match",
  "If-Range",
  "Range",
] as const
const FORWARDED_RESPONSE_HEADERS = [
  "Accept-Ranges",
  "Content-Length",
  "Content-Range",
  "ETag",
  "Last-Modified",
] as const

export function createDriveMediaRequestHeaders(
  requestHeaders: Headers,
  accessToken: string
) {
  const headers = new Headers({ Authorization: `Bearer ${accessToken}` })

  for (const name of FORWARDED_REQUEST_HEADERS) {
    copyHeader(requestHeaders, headers, name)
  }

  return headers
}

export function createMediaProxyResponse(driveResponse: Response) {
  return createProxyResponse(driveResponse, "private, max-age=86400, immutable")
}

export function createThumbnailProxyResponse(driveResponse: Response) {
  return createProxyResponse(driveResponse, "private, max-age=86400, immutable")
}

function createProxyResponse(
  driveResponse: Response,
  cacheControl: string,
  variesBySession = true
) {
  const responseHeaders = new Headers({
    "Cache-Control": cacheControl,
    "Content-Type":
      driveResponse.headers.get("Content-Type") ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  })

  if (variesBySession) {
    responseHeaders.set("Vary", "Cookie, Authorization, Range")
  }

  for (const name of FORWARDED_RESPONSE_HEADERS) {
    copyHeader(driveResponse.headers, responseHeaders, name)
  }

  const body = [204, 304].includes(driveResponse.status)
    ? null
    : driveResponse.body

  return new Response(body, {
    headers: responseHeaders,
    status: driveResponse.status,
    statusText: driveResponse.statusText,
  })
}

function copyHeader(source: Headers, destination: Headers, name: string) {
  const value = source.get(name)
  if (value) destination.set(name, value)
}
