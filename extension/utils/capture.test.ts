import { describe, expect, it } from "vitest"

import { createCaptureDraft } from "./capture"

describe("createCaptureDraft", () => {
  it("creates an image draft from a context-menu capture", () => {
    const draft = createCaptureDraft(
      {
        mediaType: "image",
        pageUrl: "https://example.com/inspiration",
        srcUrl: "https://example.com/image.jpg",
      },
      "A useful composition"
    )

    expect(draft).toMatchObject({
      kind: "image",
      title: "A useful composition",
      thumbnailUrl: "https://example.com/image.jpg",
    })
  })

  it("ignores captures without a usable media URL", () => {
    expect(createCaptureDraft({ pageUrl: "https://example.com" }, "Missing media")).toBeNull()
  })

  it("creates a binary video draft from a direct media URL", () => {
    expect(
      createCaptureDraft(
        {
          mediaType: "video",
          pageUrl: "https://example.com/showcase",
          srcUrl: "https://cdn.example.com/micro-interaction.mp4",
        },
        "Micro interaction"
      )
    ).toMatchObject({ kind: "video", storageMode: "binary", thumbnailUrl: undefined })
  })
})
