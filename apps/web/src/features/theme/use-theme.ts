import { useCallback, useEffect, useState } from "react"
import { applyTheme, isThemePreference, resolveTheme } from "./theme"
import type { ThemePreference } from "./theme"

export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>("system")

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("stillroom-theme")
    if (isThemePreference(savedTheme)) setTheme(savedTheme)
  }, [])

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => applyTheme(theme, media.matches)
    apply()
    media.addEventListener("change", apply)
    window.localStorage.setItem("stillroom-theme", theme)
    return () => media.removeEventListener("change", apply)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) =>
      resolveTheme(current) === "dark" ? "light" : "dark"
    )
  }, [])

  return { setTheme, theme, toggleTheme }
}
