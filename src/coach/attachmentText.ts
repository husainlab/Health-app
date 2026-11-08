// Pure helper functions for encoding and decoding attachment text and data URLs across environments.

/** Known extensions to mime type. */
export function mimeTypeFor(name: string, fallbackMime?: string | null): string {
  if (fallbackMime && fallbackMime !== "*/*" && fallbackMime !== "application/octet-stream") {
    return fallbackMime;
  }
  const ext = name.toLowerCase().split(".").pop();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "pdf":
      return "application/pdf";
    case "txt":
    case "log":
      return "text/plain";
    case "csv":
      return "text/csv";
    case "json":
      return "application/json";
    case "md":
      return "text/markdown";
    default:
      return fallbackMime || "application/octet-stream";
  }
}

/** Encodes a UTF-8 string to base64 safely in all environments (Hermes, Node, Web). */
export function utf8ToBase64(str: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf8").toString("base64");
  }
  if (typeof btoa === "function") {
    const encoded = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16)));
    return btoa(encoded);
  }
  return "";
}

/** Decodes a base64 string to a UTF-8 string safely in all environments. */
export function base64ToUtf8(b64: string): string {
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(b64, "base64").toString("utf8");
    }
    if (typeof atob === "function") {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder("utf-8").decode(bytes);
    }
  } catch {
    try {
      if (typeof atob === "function") return atob(b64);
    } catch {}
  }
  return "";
}

/** Decodes a base64 data URL to text if possible. */
export function decodeDataUrlToText(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const b64 = dataUrl.slice(comma + 1);
  const text = base64ToUtf8(b64);
  return text || null;
}
