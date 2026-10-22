// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { AuthLanding } from "./auth-landing"

afterEach(cleanup)

describe("AuthLanding", () => {
  it("offers one clear Google authentication action", () => {
    render(<AuthLanding />)

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Keep the ideas worth returning to.",
      })
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Get started" })).toBeTruthy()
    expect(screen.getAllByText("GitHub").length).toBeGreaterThan(0)
    expect(screen.getByText("AKASHA")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("shows an actionable connection error", () => {
    render(<AuthLanding connectionFailed />)

    expect(screen.getByRole("alert").textContent).toContain("couldn’t connect")
  })

  it("toggles theme on 'd' key shortcut", () => {
    render(<AuthLanding />)
    const initialIsDark = document.documentElement.classList.contains("dark")

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "d" })
      )
    })

    expect(document.documentElement.classList.contains("dark")).toBe(
      !initialIsDark
    )
  })
})
