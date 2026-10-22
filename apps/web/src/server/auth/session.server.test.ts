import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createServerEntry,
  getResponseHeaders,
  setCookie,
} from "@tanstack/react-start/server"
import { H3Event, useSession } from "h3"

import { useStillroomSession } from "./session.server"

const password = "test-session-secret-with-at-least-32-characters"
const maxAge = 90 * 24 * 60 * 60

async function legacyCookie() {
  const event = new H3Event(new Request("https://akasha.example/"))
  const session = await useSession(event, {
    name: "stillroom-session",
    password,
    maxAge,
  })
  await session.update({ googleRefreshToken: "test-refresh-".repeat(400) })
  return event.res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")
}

function request(cookie: string, path = "/") {
  return new Request(`https://akasha.example${path}`, { headers: { cookie } })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe("Start session compatibility", () => {
  it("restores existing chunked cookies, saves before redirects, and clears on logout", async () => {
    vi.stubEnv("SESSION_SECRET", password)
    vi.stubEnv("NODE_ENV", "production")
    const entry = createServerEntry({
      fetch: async (req) => {
        const session = await useStillroomSession()
        if (new URL(req.url).pathname === "/logout") {
          await session.clear()
          return new Response(null, {
            status: 303,
            headers: [...getResponseHeaders(), ["Location", "/"]],
          })
        }
        if (new URL(req.url).pathname === "/refresh") {
          await session.update({ googleAccessToken: "refreshed-test-token" })
          const sameRequest = await useStillroomSession()
          expect(sameRequest.data.googleAccessToken).toBe(
            "refreshed-test-token"
          )
          return new Response(null, {
            status: 303,
            headers: [...getResponseHeaders(), ["Location", "/"]],
          })
        }
        return Response.json(session.data, { headers: [...getResponseHeaders()] })
      },
    })
    const cookie = await legacyCookie()
    const restored = await entry.fetch(request(cookie))
    expect((await restored.json()).googleRefreshToken).toBe(
      "test-refresh-".repeat(400)
    )
    const refreshed = await entry.fetch(request(cookie, "/refresh"))
    expect(refreshed.status).toBe(303)
    expect(refreshed.headers.get("location")).toBe("/")
    const saved = refreshed.headers.getSetCookie()
    expect(saved.length).toBeGreaterThan(1)
    for (const value of saved) {
      expect(value).toContain("HttpOnly")
      expect(value).toContain("Secure")
      expect(value).toContain("SameSite=Lax")
    }
    const refreshedCookie = saved.map((value) => value.split(";")[0]).join("; ")
    const roundTrip = await entry.fetch(request(refreshedCookie))
    expect((await roundTrip.json()).googleAccessToken).toBe(
      "refreshed-test-token"
    )
    const logout = await entry.fetch(request(refreshedCookie, "/logout"))
    expect(logout.status).toBe(303)
    expect(logout.headers.getSetCookie().length).toBeGreaterThan(1)
    for (const value of logout.headers.getSetCookie())
      expect(value).toContain("Max-Age=0")
  })

  it("rejects tampered and expired cookies without losing unrelated response cookies", async () => {
    vi.stubEnv("SESSION_SECRET", password)
    vi.useFakeTimers({ toFake: ["Date"] })
    const now = Date.now()
    vi.setSystemTime(now - (maxAge + 120) * 1000)
    const expired = await legacyCookie()
    vi.setSystemTime(now)
    const entry = createServerEntry({
      fetch: async () => {
        setCookie("unrelated", "retained", { httpOnly: true })
        const session = await useStillroomSession()
        await session.update({ oauthState: "test-oauth-state" })
        return Response.json(session.data, { headers: [...getResponseHeaders()] })
      },
    })
    for (const cookie of ["stillroom-session=invalid", expired]) {
      const response = await entry.fetch(request(cookie))
      expect(await response.json()).toEqual({ oauthState: "test-oauth-state" })
      expect(
        response.headers
          .getSetCookie()
          .some((value) => value.startsWith("unrelated=retained;"))
      ).toBe(true)
      expect(
        response.headers
          .getSetCookie()
          .some((value) => value.startsWith("stillroom-session="))
      ).toBe(true)
    }
  })
})
