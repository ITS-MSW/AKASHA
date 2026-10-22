import { describe, expect, it } from "vitest"

import { isGoogleRefreshTokenRejected } from "./google-oauth.server"

describe("isGoogleRefreshTokenRejected", () => {
  it("recognizes a revoked Google grant without masking other errors", () => {
    expect(
      isGoogleRefreshTokenRejected({
        response: { data: { error: "invalid_grant" } },
      })
    ).toBe(true)
    expect(
      isGoogleRefreshTokenRejected({
        response: { data: { error: "rate_limit_exceeded" } },
      })
    ).toBe(false)
    expect(isGoogleRefreshTokenRejected(new Error("Network error"))).toBe(false)
  })
})
