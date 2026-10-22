import { useEffect } from "react"
import { ArrowRightIcon, GithubLogoIcon } from "@phosphor-icons/react"
import { Button, Link, Typography } from "@heroui/react"

import { AkashaBrand } from "@/components/stillroom/brand"
import { useTheme } from "@/features/theme/use-theme"

type AuthLandingProps = {
  connectionFailed?: boolean
}

export function AuthLanding({ connectionFailed = false }: AuthLandingProps) {
  const { toggleTheme } = useTheme()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return
      }

      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") ||
          target.isContentEditable ||
          Boolean(target.closest('[contenteditable="true"]')))
      ) {
        return
      }

      if (event.key.toLowerCase() === "d") {
        event.preventDefault()
        toggleTheme()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [toggleTheme])
  return (
    <div className="flex min-h-dvh flex-col items-center bg-background px-4 py-6 text-foreground sm:px-8 md:px-12">
      <header className="fixed top-4 z-50 flex w-full max-w-2xl items-center justify-between rounded-full border border-[color-mix(in_oklch,var(--foreground)_15%,transparent)] bg-[color-mix(in_oklch,var(--foreground)_92%,var(--surface))] px-1.5 py-1.5 text-white dark:text-black">
        <AkashaBrand className="text-muted-foreground px-2" showIcon={false} />
        <Link
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-100 dark:bg-black dark:text-white dark:hover:bg-neutral-900"
          href="https://github.com/PURPLE-ORCA/AKASHA"
          rel="noopener noreferrer"
          target="_blank"
        >
          <GithubLogoIcon aria-hidden="true" weight="bold" />
          GitHub
        </Link>
      </header>

      <main
        className="flex w-full max-w-7xl flex-col gap-12 pt-20"
        id="main-content"
      >
        <section aria-label="Product preview" className="w-full">
          <div className="relative w-full overflow-hidden rounded-2xl border border-border bg-[color-mix(in_oklch,var(--accent)_6%,var(--surface))] dark:border-[color-mix(in_oklch,var(--border)_60%,transparent)] dark:bg-[color-mix(in_oklch,var(--accent)_12%,var(--background))]">
            <img
              alt="Engraved illustration of the grand reading room"
              className="pointer-events-none block aspect-16/7 max-h-[465px] w-full object-cover object-center select-none"
              decoding="async"
              fetchPriority="high"
              src="/landing/grand-reading-room.webp"
            />
          </div>
        </section>

        <section className="flex w-full flex-col justify-between gap-8 md:flex-row md:items-end">
          <div className="max-w-xl">
            <Typography
              className="max-w-3xl text-3xl sm:text-4xl md:text-5xl"
              type="h1"
            >
              Keep the ideas worth returning to.
            </Typography>
            <Typography
              className="mt-3 text-lg sm:text-lg"
              color="muted"
              type="body"
            >
              Collect images and visual references in one calm, private space.
            </Typography>
            {connectionFailed ? (
              <div className="mt-3">
                <Typography color="muted" role="alert" type="body-sm">
                  Akasha couldn’t connect your library. Try again.
                </Typography>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <form action="/api/auth/google" method="get">
              <Button size="lg" type="submit" variant="primary">
                Get started
                <ArrowRightIcon aria-hidden="true" weight="bold" />
              </Button>
            </form>
            <Link
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-5 py-3 text-base font-semibold text-foreground transition-colors hover:bg-default"
              href="https://github.com/PURPLE-ORCA/AKASHA"
              rel="noopener noreferrer"
              target="_blank"
            >
              <GithubLogoIcon aria-hidden="true" weight="bold" />
              GitHub
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
