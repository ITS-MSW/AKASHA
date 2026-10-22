# Akasha implementation tickets

Spec prepared 2026-10-22. Requested deliverable is this root document, replacing issue-tracker publication. Features below are specified, not implemented. Existing working changes committed separately as `a4dca27`.

Test boundaries confirmed by user: reuse gallery/library interaction tests for zoom and pool, capture/API tests for batch and video, and Brave QA through computer use. The user explicitly authorizes running dev servers during implementation and verification of these tickets, overriding the repository's no-dev-server restriction for this work. Use Bun. No new test framework. Add at most one main-path and one critical-failure test per ticket where existing coverage is insufficient.

Use current product vocabulary: library, folder, asset, preview, pool, capture, saved, already saved. No dedicated glossary or ADR documents found during repository inspection. Preserve private Google Drive storage, existing assets, credentials, and folder relationships. Use HeroUI/HeroUI Pro for new controls, without component class overrides. No eyebrows, redundant descriptions, internal tooling labels, or development notes in product UI.

## Ticket 1: Restore cursor-following zoom after preview navigation

### Problem Statement

Cursor-following zoom works on the first image but stops following the pointer after navigating to another image with arrow keys.

### Solution

Every image supports the same pointer-centered inspection zoom, including immediately after keyboard navigation.

### User Stories

1. As a library user, I want zoom to follow my cursor on every image, so that I can inspect details consistently.
2. As a library user, I want to navigate while my cursor stays over the preview, so that I do not need to leave and re-enter the image.
3. As a library user, I want Alt and Shift inspection to work after navigation, so that existing shortcuts remain useful.
4. As a library user, I want portrait and landscape images to zoom around their own bounds, so that inspection stays accurate.
5. As a library user, I want releasing the modifier or leaving the preview to end inspection, so that zoom does not get stuck.
6. As a library user, I want existing zoom buttons and reset behavior preserved, so that keyboard navigation does not change familiar controls.

### Implementation Decisions

- Existing owners are MediaLightbox and ProgressiveImage. ProgressiveImage remounts for each asset; bounds initialize only on pointer entry. Pointer movement skips origin updates when those bounds are absent. This is a code-supported failure mechanism, not a browser-confirmed diagnosis.
- Initialize or refresh unscaled image bounds when required after mount, navigation, layout change, or image load. Do not depend on a fresh pointer-enter event. Avoid measuring already transformed geometry as the unscaled frame.
- Keep pointer/modifier information at the smallest owner that survives image changes when needed. Handle navigation while a modifier remains held and navigation followed by a new modifier press.
- Preserve clamped origins, zero-size guards, existing scale reset on navigation, blur cleanup, reduced motion, loading/error behavior, and video controls.

### Testing Decisions

- Prefer existing media-gallery interaction tests. Assert visible zoom behavior after moving from first to second image without another pointer-enter event; avoid assertions about private refs.
- Cover modifier release or missing geometry as the critical failure path. Reuse existing navigation and zoom tests where possible.
- Brave acceptance: first/second/third images, both navigation directions, stationary pointer during navigation, portrait/landscape sizes, image load/resize, Alt/Shift release, and zoom buttons. No passing unit test substitutes for geometry checks in browser.

### Out of Scope

New gesture libraries, touch pinch zoom, gallery layout redesign, or changed zoom semantics.

### Further Notes

Independent of remaining tickets. Browser reproduction remains outstanding.

## Ticket 2: Persist pool across browser sessions

### Problem Statement

The pool currently uses sessionStorage and is tied to a tab session. Users need saved membership when they return later.

### Solution

Persist pool membership locally per library while preserving collapse, reopen, and dismiss behavior.

### User Stories

1. As a library user, I want my pool restored after restarting the browser, so that collected assets remain available.
2. As a library user, I want my current pool retained during migration, so that this update does not discard selections.
3. As a library user, I want separate pools for separate libraries, so that assets never leak between accounts.
4. As a library user, I want collapsing the pool to preserve membership, so that I can regain screen space safely.
5. As a library user, I want dismissing the pool to clear persisted membership, so that it stays dismissed when I return.
6. As a library user, I want rapid additions to retain every asset, so that repeated actions do not overwrite each other.
7. As a library user, I want the pool usable when browser storage fails, so that I can finish the current session.
8. As a library user, I want deleted or inaccessible assets omitted safely, so that stale identifiers cannot break the pool.

### Implementation Decisions

- Reuse useTemporaryPool as the product owner. Import a local copy of the supplied ORCAFORGE useLocalStorage hook, adapting it for this app rather than introducing a package dependency.
- The supplied hook has browser guards and JSON error handling, but its initializer can differ between server rendering and hydration, its setter captures an old value, and changing keys does not reload state. Address these issues in the adaptation.
- Retain the library-root-scoped key and serialized string identifiers. Validate parsed data, deduplicate IDs, and preserve null versus empty-array semantics for inactive versus active-empty pools. Do not store credentials, full assets, or media bytes.
- Hydrate safely before writing defaults. On library-key changes, never render or persist the previous library's IDs under the new key. Functional updates must compose correctly.
- Migrate the current sessionStorage value only when localStorage has no value for that library. Remove legacy data only after a successful write. Preserve an explicitly dismissed local value so migration cannot resurrect an old pool.
- Collapse changes visibility only; dismiss persists inactive state. Keep unavailable storage usable in memory with one concise actionable warning.
- Synchronize storage events across tabs. Concurrent writes may use last-write-wins; cross-tab transactional merging is not required. Do not prune IDs solely because a temporary or incomplete library snapshot omits them.

### Testing Decisions

- Use existing library-page tests at the rendered pool boundary. Main path covers migration, reload, add, collapse, reopen, and dismiss persistence.
- Critical failure path covers malformed or unavailable storage without data crossing library keys. Reuse existing isolation assertions; add only missing behavior coverage within the agreed test limit.
- Brave acceptance: reload and browser restart, another tab, account/library change, empty pool, bulk-add and individual controls. Confirm server-rendered page hydrates without mismatched content.

### Out of Scope

Cloud sync, shared pools, media caching, renaming the pool, or a new state-management library.

### Further Notes

Requested source hook: `/Users/purpleorca/Documents/DEV/PARTIALS/ORCAFORGE/packages/react/src/hooks/useLocalStorage.ts`. Source inspected for this spec. Copy and adapt during implementation; do not change ORCAFORGE.

## Ticket 3: Add preview-to-pool keyboard shortcut

### Problem Statement

Users inspecting assets need to add the current asset to the pool without leaving preview.

### Solution

Press P in preview to add the active asset. Show the shortcut in existing shortcut help and expose an accessible preview action.

### User Stories

1. As a library user, I want P to add the previewed asset, so that I can collect references while browsing.
2. As a library user, I want repeated P presses to leave an existing member in the pool, so that adding never accidentally removes it.
3. As a library user, I want navigation followed by P to add the newly visible asset, so that the correct reference is saved.
4. As a keyboard user, I want shortcut help and a named action, so that this feature is discoverable.
5. As a library user, I want typing and modified shortcuts left alone, so that pool actions do not interrupt other controls.
6. As a library user, I want preview to remain open after adding, so that I can continue browsing.

### Implementation Decisions

- Route an idempotent add action from useTemporaryPool through MediaGallery to MediaLightbox. Reuse addItems; do not use toggleItem for an add-only shortcut.
- Apply to previews launched from both the main gallery and pool gallery, including supported videos. Already-pooled assets remain unchanged.
- Handle plain P only with an active preview. Ignore repeated/default-prevented events, editable targets, composition, modifier combinations, and other active dialogs. Preserve arrow navigation and Escape behavior.
- Use existing HeroUI Button/Kbd controls and shortcut-help owner. Present concise Add to pool/Added state without closing preview or stealing focus. No extra descriptive paragraph.

### Testing Decisions

- Extend existing gallery/library interaction coverage for navigating then adding and persisting the active asset.
- Critical failure path checks editable targets or already-pooled assets produce no unintended mutation. Reuse keyboard guards where applicable.
- Brave acceptance includes help, action focus/name, P, repeat, typing, both gallery entry points, empty pool, and video playback controls.

### Out of Scope

Global P shortcut outside preview, configurable keybindings, or shortcut-driven removal.

### Further Notes

Depends on pool owner behavior from Ticket 2; may be developed separately against existing addItems.

## Ticket 4: Update TanStack Start to current stable release

### Problem Statement

The app is behind the package registry's current Start release.

### Solution

Upgrade Start and required compatible TanStack dependencies while preserving authentication, navigation, server operations, and deployment behavior.

### User Stories

1. As a library user, I want the updated app to open my library normally, so that a framework update does not interrupt access.
2. As a library user, I want sign-in and session restoration preserved, so that my account remains usable.
3. As a library user, I want folder navigation and direct links preserved, so that existing workflows still work.
4. As an extension user, I want capture and credential refresh preserved, so that saving continues after the upgrade.
5. As a maintainer, I want compatible pinned packages and a reproducible lockfile, so that production uses the verified dependency set.

### Implementation Decisions

- Manifest currently pins react-start 1.168.46. Bun registry lookup during specification returned 1.169.3. Recheck latest stable at implementation time; do not treat this recorded value as permanently current.
- Review official release notes and peer requirements. Update Router, router-plugin, SSR integration, and devtools only where compatibility requires; package versions need not share identical numbers.
- Preserve Vite/Nitro deployment, route generation, lazy library loading, SSR hydration, server-only boundaries, auth cookies, private media proxy, and extension CORS behavior.
- Use Bun to update manifest and lockfile. No unrelated dependency sweep or experimental release adoption.

### Testing Decisions

- Run existing web tests, typecheck, lint, and production build. Run contracts/extension checks if shared dependencies change.
- Brave acceptance through computer use against the upgraded app, using an authorized local dev server or an upgraded build: signed-out page, sign-in, restored session, folders, preview, uploads, and extension capture. Existing deployed build cannot prove upgrade behavior. Dev-server QA does not replace the production build check.
- No new framework-specific test infrastructure. Existing behavioral tests provide regression coverage.

### Out of Scope

Framework migration, new framework features, unrelated dependency upgrades, deployment or push without separate instruction.

### Further Notes

Review [official Start changelog](https://github.com/TanStack/router/blob/main/packages/react-start/CHANGELOG.md) and [Start overview](https://tanstack.com/start/latest/docs/framework/react/overview). Record final resolved versions and actual checks during implementation.

## Ticket 5: Save multiple images from one X post

### Problem Statement

Posts can contain several images, but capture currently accepts one draft and requires repeated saves.

### Solution

For a targeted multi-image X post, show its images in the existing capture panel, select them together, choose one folder, and save the selection in one action.

### User Stories

1. As an extension user, I want all images from the targeted post offered together, so that I can save a complete reference set.
2. As an extension user, I want to deselect individual images, so that I save only useful references.
3. As an extension user, I want one destination folder for the selection, so that I avoid repeated folder selection.
4. As an extension user, I want adjacent posts, avatars, and quoted-post media excluded, so that unrelated images are never saved.
5. As an extension user, I want single-image capture to stay simple, so that batching does not add steps to ordinary saves.
6. As an extension user, I want already-saved images recognized, so that retrying a post does not create duplicates.
7. As an extension user, I want successful saves retained when another image fails, so that partial failure does not waste work.
8. As an extension user, I want failed items retried without resaving successful items, so that recovery is predictable.
9. As an extension user, I want queued saves to survive panel closure and worker restart, so that saving is reliable.
10. As a library user, I want each saved image to retain its source post, so that I can revisit the reference.

### Implementation Decisions

- Current capture draft, panel, messaging, and enqueue operation are single-item. Extend those owners to accept an ordered selection, then enqueue one existing capture job per image.
- Keep the existing authenticated single-capture endpoint and per-item captureId, deduplication, retry, and saved/already_saved outcomes. A batch HTTP endpoint or new job system is unnecessary for this scope.
- Scope discovery to the clicked post and canonical status URL. Inspect that post's image elements, exclude avatars/icons/quoted posts, normalize image URLs using existing media helpers, deduplicate responsive variants, and retain attachment order. Never scan the whole feed as one batch.
- Default all discovered post images selected. Use compact thumbnail selection, one folder picker, and Save N images. Disable save for zero selection; keep single-image panel behavior when no siblings are found.
- Persist the selected jobs before acknowledging queue acceptance. Report queued versus saved accurately. Group completion counts and failures without generating one disruptive notification per image. Keep recoverable failed selections and existing reconnect behavior.
- Reuse serialized outbox mutations and bounded processing. Keep successful items when another fails. Preserve each captureId across retries.
- No X API credential or paid API dependency by default. DOM discovery feasibility must be verified against current X post markup in Brave. If post ownership cannot be established, retain single-item capture rather than silently collecting unrelated images.

### Testing Decisions

- Use existing capture, media, outbox, and API tests. Prefer the observable capture-selection-to-job boundary over testing selectors in isolation.
- Main path: one post with multiple images creates distinct ordered jobs in the chosen folder. Critical failure: partial success and retry preserve successful outcomes and exclude adjacent-post media.
- Brave acceptance on real single/multi-image X posts: feed and post view, quoted post, selection, empty selection, folder choice, panel close, failed item recovery, duplicate save, and worker restart.

### Out of Scope

Bulk feed scraping, account crawling, albums spanning posts, a paid X API integration, or media from unrelated platforms without verified post grouping.

### Further Notes

Independent of video support. Batch video/mixed-media selection can reuse this model after Ticket 6, but is not required to deliver multi-image post saving. Live X discovery remains unverified; do not claim universal extraction support from static code inspection.

## Ticket 6: Enable durable video capture and upload

### Problem Statement

Users can save images but cannot reliably store videos. Video types and several helpers exist, yet extension draft creation, background saving, API client, and capture route explicitly reject videos. Web upload accepts only image formats.

### Solution

Save ordinary X post videos and local MP4/WebM files into the library and play their stored bytes. Match the selected post, including quoted-post ownership. Keep thumbnails still and start playback only on user input. Report unsupported sources honestly.

### User Stories

1. As an extension user, I want to save a downloadable video, so that my reference survives changes to the source page.
2. As a library user, I want to upload a local video, so that my own references live beside saved images.
3. As a library user, I want videos to play and seek in preview, so that I can inspect the saved content.
4. As a library user, I want recognizable thumbnails or a usable video fallback, so that missing posters do not hide an asset.
5. As a library user, I want video filtering, folders, pool actions, rename, move, download, and delete to work, so that video behaves like other assets.
6. As an extension user, I want the selected video's source retained, so that I can revisit its post.
7. As an extension user, I want clear rejection of unsupported or oversized files, so that I know when nothing was saved.
8. As an extension user, I want retries to avoid duplicate videos, so that unreliable connections do not clutter my library.
9. As a library user, I want private playback, so that saved videos remain accessible only through authorized library access.
10. As an extension user, I want unavailable stream-only sources identified correctly, so that a saved link is never mistaken for stored video.

### Implementation Decisions

- Reuse existing video contract, downloadable-source resolver, binary save helpers, signature validation, content hashing, poster support, Drive metadata mapping, and range-aware private media proxy. Do not build a second media backend.
- Existing backend supports MP4/WebM and a 50 MiB video cap. Retain that cap initially, subject to verified deployment transport limits; existing image cap remains 20 MiB. Validate advertised and actual streamed size and content signature.
- Enable video only through a complete path: targeted element discovery, draft, panel, messaging, background queue, API client, authenticated capture route, storage, library listing, playback, and download. Remove superseded rejection branches within those owners.
- Prefer server streaming from a public downloadable HTTPS media URL. Preserve safe remote-source checks on every redirect, destination authorization, timeouts, credentials, and private response caching. Never pass arbitrary page cookies to a remote host.
- Resolve ordinary X videos from the post response already loaded by X. Match both selected status ID and poster; retain only media metadata, never credentials or account data. Other sites use the selected video and its source elements. Remove page-wide candidate collection. Never store a blob URL or HLS manifest as video.
- Choose the highest-bitrate attributed X MP4 whose actual bytes fit 50 MiB. The remote capture path buffers at most one bounded candidate before the existing Drive save path; this permits actual-size validation before selecting a lower variant. Deployment memory and duration at the cap still need verification.
- Local uploads use encrypted, account-bound, file-specific sessions and 1 MiB chunks. Persist session metadata only. After reload, reselect the same file, verified by size, MIME, and SHA-256, to resume. A lost completion response must recover both saved and duplicate outcomes.
- Extend local upload validation, file picker/drop acceptance, progress/errors, and save dispatch to supported video types. Reuse the existing binary-video storage owner instead of duplicating validation.
- Verify hosting body-size and request-duration limits before choosing local-upload transport. If they prevent the supported cap, use an authorized, file-specific resumable Drive upload session with server-owned credentials and completion validation. Do not expose refresh tokens or upload all video bytes through a known incompatible request path.
- Reuse existing playback and Range/If-Range handling; confirm 206/416, seeking, content type, cancellation, and privacy. Extend image-specific download filenames and upload labels where videos now work.
- Keep reference-mode legacy records readable. New successful video saves require stored bytes. Missing or invalid posters must not discard a valid saved video.

### Testing Decisions

- Reuse capture/API, Drive stream, dedupe, upload destination, media proxy, and gallery suites. Main path follows a valid supported video from capture/upload through stored metadata and playback response.
- Critical failure covers unsupported content or source access failure without a false success or duplicate stored item. Reuse existing byte-limit, redirect, auth, destination, signature, and range tests; extend missing assertions rather than adding infrastructure.
- Brave acceptance: direct MP4/WebM capture, local upload, representative X video with a verified direct variant, unsupported stream-only source, playback/seek, poster fallback, duplicate/retry, folder/pool/filter/download/delete, and worker restart.
- Validate deployment limits and large-transfer behavior on the actual deployment target. Unit tests do not establish provider delivery or serverless capacity.

### Out of Scope

DRM bypass, HLS/DASH assembly, transcoding, arbitrary codec guarantees, external download services, credential scraping, and storing video bytes in localStorage.

### Further Notes

[Google Drive upload guidance](https://developers.google.com/workspace/drive/api/guides/manage-uploads) recommends resumable transfers for larger files and interrupted uploads. This supports reusing Drive rather than adding a video service; exact transport choice still depends on deployment evidence.

[Chrome service-worker lifecycle guidance](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) documents worker termination and fetch-response limits. Persist jobs before transfer and make retries idempotent; do not rely on long-lived in-memory worker state.

Implementation QA, 2026-10-22: a real 5,191,819-byte MP4 uploaded to private Drive through the local app, recovered after interrupted transfers and reload/reselection, and playback and seeking worked within the 39.5-second preview. Preview opens paused; video filtering and pool add/remove passed in Brave. Download verification reached Brave’s native Save dialog, whose Save action remained disabled; the dialog was cancelled and no completed download is claimed. X blob players are supported only when their exact post response supplies a direct MP4 variant. Helium resolved the Google X post to matching MP4 variants, opened the correct capture panel, and persisted video jobs. Real extension transfers hit retryable timeouts; end-to-end extension delivery is not yet a pass. WebM, quoted-post UI attribution, worker-restart completion, download, and deployment near the 50 MiB cap remain acceptance checks, not claimed passes. Asset rename is not an existing gallery action; this change preserves that baseline. Follow-up fixes require exact canonical X post URL equality for observer responses and share modern/legacy X media identity validation across discovery and backend. Existing tests cover legacy paths and wrong host, author, path, and scheme; independent standards recheck found no remaining blocker in these fixes. Failure notifications use media-neutral wording. The user approved publication with X delivery explicitly unverified; no successful end-to-end X transfer is claimed. Independent review also identified the existing shared content-hash finalization race between separately started concurrent uploads; same-session retry recovery is covered, but cross-session atomic deduplication is not claimed. No deployment is authorized by implementation alone.

## Delivery order and verification record

1. Fix zoom independently.
2. Persist pool, then add preview shortcut.
3. Upgrade Start in a separate change so regressions remain attributable.
4. Deliver multi-image capture using existing queue.
5. Enable video through all named consumers after transfer limits and source attribution are verified.

Before this spec, commit `a4dca27` captured two existing extension folder-picker files and the existing deletion of the old plans README. Extension typecheck passed; all 30 extension tests passed. Biome reported three accessibility errors in the custom listbox/options and one formatting error. Those existing changes were preserved as requested; commit is not a claim of clean lint or browser QA.

This document introduces no runtime changes. Feature acceptance checks above remain pending implementation. No issue was published, no dependency upgraded, no dev server started, and no remote push or deployment performed.
