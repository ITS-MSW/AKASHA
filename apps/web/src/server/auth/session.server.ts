import { appendResponseHeader, getRequest } from "@tanstack/react-start/server"
import { H3Event, useSession } from "h3"

import { getSessionSecret } from "../env.server"
import { getGoogleAccessToken } from "./google-oauth.server"

export type StillroomSessionData = {
  extensionRedirectUri?: string
  googleAccessToken?: string
  googleAccessTokenExpiresAt?: number
  googleRefreshToken?: string
  oauthState?: string
}

// Keep the existing H3 cookie format when upgrading past Start's session API.
const sessionEvents = new WeakMap<Request, H3Event>()

export async function useStillroomSession() {
  const request = getRequest()
  const event = sessionEvents.get(request) ?? new H3Event(request)
  sessionEvents.set(request, event)
  const session = await useSession<StillroomSessionData>(event, {
    maxAge: 90 * 24 * 60 * 60,
    name: "stillroom-session",
    password: getSessionSecret(),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })

  function flushCookies() {
    for (const cookie of event.res.headers.getSetCookie()) {
      appendResponseHeader("set-cookie", cookie)
    }
    event.res.headers.delete("set-cookie")
  }

  flushCookies()
  return {
    get data() {
      return session.data
    },
    async update(data: StillroomSessionData) {
      await session.update(data)
      flushCookies()
    },
    async clear() {
      await session.clear()
      flushCookies()
    },
  }
}

export async function getSessionGoogleCredentials(
  session: Awaited<ReturnType<typeof useStillroomSession>>
) {
  const refreshToken = session.data.googleRefreshToken
  if (!refreshToken) return null

  const activeToken = await getGoogleAccessToken({
    accessToken: session.data.googleAccessToken,
    accessTokenExpiresAt: session.data.googleAccessTokenExpiresAt,
    refreshToken,
  })
  if (!activeToken) return null

  if (
    activeToken.accessToken !== session.data.googleAccessToken ||
    activeToken.accessTokenExpiresAt !== session.data.googleAccessTokenExpiresAt
  ) {
    await session.update({
      ...session.data,
      googleAccessToken: activeToken.accessToken,
      googleAccessTokenExpiresAt: activeToken.accessTokenExpiresAt,
    })
  }

  return { ...activeToken, refreshToken }
}
