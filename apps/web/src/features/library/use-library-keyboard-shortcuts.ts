import { useEffect } from "react"

type LibraryView = "all" | "folders"

type LibraryKeyboardShortcutOptions = {
  activeView: LibraryView
  canGoToParent: boolean
  hasItems: boolean
  isSelectionMode: boolean
  onCommandPaletteToggle: () => void
  onExitSelection: () => void
  onGoToParent: () => void
  onMediaFilterCycle: () => void
  onSelectionModeToggle: () => void
  onThemeToggle: () => void
  onUpload: () => void
  onViewToggle: () => void
}

type ShortcutHandler = (
  event: KeyboardEvent,
  options: LibraryKeyboardShortcutOptions
) => void

const shortcutHandlers: Partial<Record<string, ShortcutHandler>> = {
  arrowdown: goToParent,
  d: toggleTheme,
  escape: exitSelection,
  f: cycleMediaFilter,
  m: toggleSelectionMode,
  s: toggleView,
  u: openUpload,
}

export function useLibraryKeyboardShortcuts(
  options: LibraryKeyboardShortcutOptions
) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleKeyDown(event, options)
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [options])
}

function handleKeyDown(
  event: KeyboardEvent,
  options: LibraryKeyboardShortcutOptions
) {
  if (shouldSkipKeyboardEvent(event)) return

  if (isCommandPaletteShortcut(event)) {
    event.preventDefault()
    options.onCommandPaletteToggle()
    return
  }

  if (shouldIgnoreLibraryShortcut(event)) return
  runShortcutHandler(event, options)
}

function runShortcutHandler(
  event: KeyboardEvent,
  options: LibraryKeyboardShortcutOptions
) {
  const handler = shortcutHandlers[event.key.toLowerCase()]
  if (handler) handler(event, options)
}

function exitSelection(
  event: KeyboardEvent,
  options: LibraryKeyboardShortcutOptions
) {
  if (!options.isSelectionMode || isDialogOpen()) return
  event.preventDefault()
  options.onExitSelection()
}

function goToParent(
  event: KeyboardEvent,
  options: LibraryKeyboardShortcutOptions
) {
  if (!options.canGoToParent || isInsideDialog(event.target)) return
  event.preventDefault()
  options.onGoToParent()
}

function toggleTheme(
  event: KeyboardEvent,
  options: LibraryKeyboardShortcutOptions
) {
  event.preventDefault()
  options.onThemeToggle()
}

function cycleMediaFilter(
  event: KeyboardEvent,
  options: LibraryKeyboardShortcutOptions
) {
  if (options.activeView !== "all") return
  event.preventDefault()
  options.onMediaFilterCycle()
}

function toggleView(
  event: KeyboardEvent,
  options: LibraryKeyboardShortcutOptions
) {
  event.preventDefault()
  options.onViewToggle()
}

function toggleSelectionMode(
  event: KeyboardEvent,
  options: LibraryKeyboardShortcutOptions
) {
  if (options.activeView !== "all") return
  if (!options.hasItems || isDialogOpen()) return
  event.preventDefault()
  options.onSelectionModeToggle()
}

function openUpload(
  event: KeyboardEvent,
  options: LibraryKeyboardShortcutOptions
) {
  if (isInsideDialog(event.target)) return
  event.preventDefault()
  options.onUpload()
}

function isCommandPaletteShortcut(event: KeyboardEvent) {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    event.key.toLowerCase() === "k"
  )
}

export function shouldSkipKeyboardEvent(event: KeyboardEvent) {
  return event.defaultPrevented || event.repeat || event.isComposing
}

function shouldIgnoreLibraryShortcut(event: KeyboardEvent) {
  return isEditingTarget(event.target) || hasCommandModifier(event)
}

function hasCommandModifier(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey || event.altKey
}

export function isEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  return (
    target.matches("input, textarea, select") ||
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"]'))
  )
}

function isDialogOpen() {
  return Boolean(document.querySelector('[role="dialog"]'))
}

function isInsideDialog(target: EventTarget | null) {
  return (
    target instanceof HTMLElement && Boolean(target.closest('[role="dialog"]'))
  )
}
