import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractMarkdownImages,
  stripMarkdownImages,
  resolveImagePath,
} from "@my-agent/channel-whatsapp";

describe("WhatsApp outbound images", () => {
  // ── extractMarkdownImages ──

  describe("extractMarkdownImages", () => {
    it("extracts a single markdown image", () => {
      const text =
        "Here is a screenshot: ![dashboard](/api/assets/screenshots/ss-abc.png)";
      const images = extractMarkdownImages(text);
      expect(images).toEqual([
        { alt: "dashboard", url: "/api/assets/screenshots/ss-abc.png" },
      ]);
    });

    it("extracts multiple markdown images", () => {
      const text = [
        "Before: ![before](/api/assets/screenshots/ss-001.png)",
        "After: ![after](/api/assets/screenshots/ss-002.png)",
      ].join("\n");
      const images = extractMarkdownImages(text);
      expect(images).toHaveLength(2);
      expect(images[0]).toEqual({
        alt: "before",
        url: "/api/assets/screenshots/ss-001.png",
      });
      expect(images[1]).toEqual({
        alt: "after",
        url: "/api/assets/screenshots/ss-002.png",
      });
    });

    it("returns empty array for text with no images", () => {
      const text = "Just a regular message with no images.";
      const images = extractMarkdownImages(text);
      expect(images).toEqual([]);
    });

    it("handles empty alt text", () => {
      const text = "![](/api/assets/screenshots/ss-xyz.png)";
      const images = extractMarkdownImages(text);
      expect(images).toEqual([
        { alt: "", url: "/api/assets/screenshots/ss-xyz.png" },
      ]);
    });
  });

  // ── stripMarkdownImages ──

  describe("stripMarkdownImages", () => {
    it("strips image syntax and trims result", () => {
      const text =
        "Here is a screenshot: ![dashboard](/api/assets/screenshots/ss-abc.png)";
      const stripped = stripMarkdownImages(text);
      expect(stripped).toBe("Here is a screenshot:");
    });

    it("strips multiple images", () => {
      const text = [
        "Before: ![before](/api/assets/screenshots/ss-001.png)",
        "Middle text",
        "After: ![after](/api/assets/screenshots/ss-002.png)",
      ].join("\n");
      const stripped = stripMarkdownImages(text);
      // Trailing space after "Before:" is expected (space before the image ref remains)
      expect(stripped).toBe("Before:\nMiddle text\nAfter:");
    });

    it("returns original text when no images present", () => {
      const text = "Just a regular message.";
      const stripped = stripMarkdownImages(text);
      expect(stripped).toBe("Just a regular message.");
    });

    it("collapses excessive newlines after stripping", () => {
      const text =
        "Line 1\n\n![img](/api/assets/screenshots/ss.png)\n\n\n\nLine 2";
      const stripped = stripMarkdownImages(text);
      expect(stripped).not.toMatch(/\n{3,}/);
    });
  });

  // ── resolveImagePath ──

  describe("resolveImagePath", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "wa-images-"));
      mkdirSync(join(tempDir, "screenshots"), { recursive: true });
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("resolves a valid screenshot path", () => {
      const filename = "ss-abc123.png";
      writeFileSync(join(tempDir, "screenshots", filename), "fake-png");

      const result = resolveImagePath(
        `/api/assets/screenshots/${filename}`,
        tempDir,
      );
      expect(result).toBe(join(tempDir, "screenshots", filename));
    });

    it("returns null for missing files (graceful degradation)", () => {
      const result = resolveImagePath(
        "/api/assets/screenshots/nonexistent.png",
        tempDir,
      );
      expect(result).toBeNull();
    });

    it("extracts filename from full URL path", () => {
      const filename = "ss-deep-path.png";
      writeFileSync(join(tempDir, "screenshots", filename), "fake-png");

      const result = resolveImagePath(
        `/api/assets/screenshots/${filename}`,
        tempDir,
      );
      expect(result).toBe(join(tempDir, "screenshots", filename));
    });

    it("does not throw on missing files", () => {
      expect(() =>
        resolveImagePath("/api/assets/screenshots/gone.png", tempDir),
      ).not.toThrow();
    });
  });
});
