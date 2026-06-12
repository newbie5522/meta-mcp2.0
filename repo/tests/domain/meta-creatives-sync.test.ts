import { describe, expect, it } from "vitest";
import { extractCreativeLinkUrl } from "../../src/domain/meta-creatives-sync.js";

describe("meta creative snapshot helpers", () => {
  it("extracts link URLs from link creatives", () => {
    expect(extractCreativeLinkUrl({
      id: "creative_1",
      object_story_spec: {
        link_data: {
          link: "https://store.example/products/a",
        },
      },
    })).toBe("https://store.example/products/a");
  });

  it("extracts link URLs from video call-to-action creatives", () => {
    expect(extractCreativeLinkUrl({
      id: "creative_2",
      object_story_spec: {
        video_data: {
          call_to_action: {
            value: {
              link: "https://store.example/products/b",
            },
          },
        },
      },
    })).toBe("https://store.example/products/b");
  });
});
