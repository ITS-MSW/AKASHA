import { useCallback, useEffect, useRef, useState } from "react"

type LocalStorageOptions<T> = {
  parse: (value: unknown) => T
  migrateFromSession?: boolean
  onError: () => void
}

// Adapted from ORCAFORGE's useLocalStorage hook. Read after hydration and
// keep pending functional updates together before React renders again.
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  { parse, migrateFromSession = false, onError }: LocalStorageOptions<T>
): [T, (value: T | ((current: T) => T)) => void] {
  const [snapshot, setSnapshot] = useState({ key: "", value: initialValue })
  const current = useRef(snapshot)

  const readValue = useCallback(() => {
    function readLegacy(persist: boolean) {
      if (!migrateFromSession) return initialValue
      try {
        const legacy = window.sessionStorage.getItem(key)
        if (legacy === null) return initialValue
        const value = parse(JSON.parse(legacy))
        if (persist) {
          try {
            window.localStorage.setItem(key, JSON.stringify(value))
            window.sessionStorage.removeItem(key)
          } catch {
            onError()
          }
        }
        return value
      } catch {
        onError()
        return initialValue
      }
    }
    let saved: string | null
    try {
      saved = window.localStorage.getItem(key)
    } catch {
      onError()
      // Preserve the legacy pool in memory without overwriting unreadable data.
      return readLegacy(false)
    }
    if (saved === null) return readLegacy(true)
    try {
      return parse(JSON.parse(saved))
    } catch {
      onError()
      return initialValue
    }
  }, [key, initialValue, parse, migrateFromSession, onError])

  useEffect(() => {
    function update(value: T) {
      current.current = { key, value }
      setSnapshot(current.current)
    }
    update(readValue())
    function onStorage(event: StorageEvent) {
      if (event.key !== key && event.key !== null) return
      try {
        if (event.storageArea !== window.localStorage) return
        update(
          event.newValue === null
            ? initialValue
            : parse(JSON.parse(event.newValue))
        )
      } catch {
        onError()
        update(initialValue)
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [key, initialValue, parse, readValue, onError])

  const setValue = useCallback(
    (value: T | ((previous: T) => T)) => {
      const previous =
        current.current.key === key ? current.current.value : readValue()
      const next = value instanceof Function ? value(previous) : value
      current.current = { key, value: next }
      setSnapshot(current.current)
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        onError()
      }
    },
    [key, readValue, onError]
  )

  return [snapshot.key === key ? snapshot.value : initialValue, setValue]
}
