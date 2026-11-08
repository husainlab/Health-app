import { describe, expect, it } from "vitest";
import { base64ToUtf8, decodeDataUrlToText, mimeTypeFor, utf8ToBase64 } from "./attachmentText";
import { titleOf } from "./chats";
import type { UIMessage } from "ai";

describe("attachmentText", () => {
  it("encodes and decodes utf8 strings to/from base64 roundtrip", () => {
    const original = "Nutrition log: 2 eggs (140 kcal), 1 toast (80 kcal)";
    const b64 = utf8ToBase64(original);
    expect(typeof b64).toBe("string");
    expect(b64.length).toBeGreaterThan(0);
    expect(base64ToUtf8(b64)).toBe(original);
  });

  it("decodes base64 data URLs to text", () => {
    const text = "Calories: 500 kcal, Protein: 40g";
    const dataUrl = `data:text/plain;base64,${utf8ToBase64(text)}`;
    expect(decodeDataUrlToText(dataUrl)).toBe(text);
    expect(decodeDataUrlToText("invalid-data-url")).toBeNull();
  });

  it("determines mime types by extension and fallback", () => {
    expect(mimeTypeFor("photo.jpg")).toBe("image/jpeg");
    expect(mimeTypeFor("scan.png")).toBe("image/png");
    expect(mimeTypeFor("doc.pdf")).toBe("application/pdf");
    expect(mimeTypeFor("log.txt")).toBe("text/plain");
    expect(mimeTypeFor("data.csv")).toBe("text/csv");
    expect(mimeTypeFor("report.json")).toBe("application/json");
    expect(mimeTypeFor("unknown.xyz", "custom/mime")).toBe("custom/mime");
  });
});

describe("titleOf with attachments", () => {
  it("returns text when text is present", () => {
    const msgs: UIMessage[] = [
      {
        id: "1",
        role: "user",
        parts: [
          { type: "file", mediaType: "image/jpeg", filename: "lunch.jpg", url: "data:..." },
          { type: "text", text: "How many calories is in this lunch?" },
        ],
      },
    ];
    expect(titleOf(msgs)).toBe("How many calories is in this lunch?");
  });

  it("uses filename or media type when text is empty", () => {
    const msgsWithFilename: UIMessage[] = [
      {
        id: "1",
        role: "user",
        parts: [{ type: "file", mediaType: "image/jpeg", filename: "my_meal.jpg", url: "data:..." }],
      },
    ];
    expect(titleOf(msgsWithFilename)).toBe("my_meal.jpg");

    const msgsPhoto: UIMessage[] = [
      {
        id: "2",
        role: "user",
        parts: [{ type: "file", mediaType: "image/jpeg", url: "data:..." }],
      },
    ];
    expect(titleOf(msgsPhoto)).toBe("Photo");

    const msgsDoc: UIMessage[] = [
      {
        id: "3",
        role: "user",
        parts: [{ type: "file", mediaType: "application/pdf", url: "data:..." }],
      },
    ];
    expect(titleOf(msgsDoc)).toBe("Attachment");
  });
});

