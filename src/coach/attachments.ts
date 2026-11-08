// Attachments for the coach: camera shots, gallery photos, and documents/files (PDFs, text files).
// Images are scaled down to MAX_SIDE (1536 px) and compressed as JPEG so they are fast to send and
// fit comfortably within AI provider context limits.
import { File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { utf8ToBase64, mimeTypeFor } from "./attachmentText";

export { utf8ToBase64, base64ToUtf8, decodeDataUrlToText, mimeTypeFor } from "./attachmentText";

export type CoachAttachment = {
  type: "file";
  mediaType: string;
  filename: string;
  url: string; // Data URL: data:<mediaType>;base64,<base64>
  size?: number;
};

export type AttachmentResult =
  | { ok: true; attachment: CoachAttachment }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "denied"; canAskAgain: boolean }
  | { ok: false; reason: "too_large" }
  | { ok: false; reason: "unsupported" }
  | { ok: false; reason: "failed" };

export const MAX_IMAGE_SIDE = 1536;
export const IMAGE_QUALITY = 0.75;
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** Discards a temporary file created in the app cache. */
function discard(uri: string | null | undefined) {
  if (!uri || !uri.startsWith(Paths.cache.uri)) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Cache is cleared by system anyway.
  }
}

/** Resizes an image asset to MAX_IMAGE_SIDE and encodes it as a JPEG base64 data URL. */
async function processImage(asset: ImagePicker.ImagePickerAsset | { uri: string; width?: number; height?: number; fileName?: string | null }): Promise<CoachAttachment> {
  const ctx = ImageManipulator.manipulate(asset.uri);
  let savedUri: string | null = null;
  try {
    const width = asset.width ?? 0;
    const height = asset.height ?? 0;
    const long = Math.max(width, height);
    if (long > MAX_IMAGE_SIDE) {
      ctx.resize(width >= height ? { width: MAX_IMAGE_SIDE } : { height: MAX_IMAGE_SIDE });
    }
    const rendered = await ctx.renderAsync();
    try {
      const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: IMAGE_QUALITY, base64: true });
      savedUri = out.uri;
      if (!out.base64) throw new Error("No image data returned");
      const filename = asset.fileName || `photo_${Date.now()}.jpg`;
      return {
        type: "file",
        mediaType: "image/jpeg",
        filename,
        url: `data:image/jpeg;base64,${out.base64}`,
      };
    } finally {
      rendered.release();
    }
  } finally {
    ctx.release();
    discard(savedUri);
    discard(asset.uri);
  }
}

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  quality: 1,
  exif: false,
  base64: false,
  allowsEditing: false,
};

/** Captures a photo using the device camera. */
export async function takeCoachPhoto(): Promise<AttachmentResult> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      return { ok: false, reason: "denied", canAskAgain: perm.canAskAgain };
    }
    const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
    if (result.canceled || !result.assets?.[0]) return { ok: false, reason: "cancelled" };
    const attachment = await processImage(result.assets[0]);
    return { ok: true, attachment };
  } catch (e) {
    console.warn(`[coach] camera photo failed: ${e instanceof Error ? e.name : "error"}`);
    return { ok: false, reason: "failed" };
  }
}

/** Picks a photo from the device photo library. */
export async function pickCoachGalleryImage(): Promise<AttachmentResult> {
  try {
    const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
    if (result.canceled || !result.assets?.[0]) return { ok: false, reason: "cancelled" };
    const attachment = await processImage(result.assets[0]);
    return { ok: true, attachment };
  } catch (e) {
    console.warn(`[coach] gallery image failed: ${e instanceof Error ? e.name : "error"}`);
    return { ok: false, reason: "failed" };
  }
}

/** Known extensions to mime type. */

/** Picks a document or file using the system document picker. */
export async function pickCoachDocument(options: { supportsPdf?: boolean } = {}): Promise<AttachmentResult> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.[0]) return { ok: false, reason: "cancelled" };
    const asset = result.assets[0];

    if (asset.size && asset.size > MAX_FILE_SIZE) {
      discard(asset.uri);
      return { ok: false, reason: "too_large" };
    }

    const mime = mimeTypeFor(asset.name, asset.mimeType);

    // If an image was picked via document picker, compress/resize it as usual
    if (mime.startsWith("image/")) {
      const attachment = await processImage({ uri: asset.uri, fileName: asset.name });
      return { ok: true, attachment };
    }

    // PDF documents
    if (mime === "application/pdf") {
      if (options.supportsPdf === false) {
        discard(asset.uri);
        return { ok: false, reason: "unsupported" };
      }
      const f = new File(asset.uri);
      const base64 = await f.base64();
      discard(asset.uri);
      return {
        ok: true,
        attachment: {
          type: "file",
          mediaType: "application/pdf",
          filename: asset.name,
          url: `data:application/pdf;base64,${base64}`,
          size: asset.size,
        },
      };
    }

    // Text / CSV / JSON / Markdown documents
    const f = new File(asset.uri);
    const textContent = await f.text();
    discard(asset.uri);
    const base64 = utf8ToBase64(textContent);
    return {
      ok: true,
      attachment: {
        type: "file",
        mediaType: mime.startsWith("text/") || mime === "application/json" ? mime : "text/plain",
        filename: asset.name,
        url: `data:${mime};base64,${base64}`,
        size: asset.size,
      },
    };
  } catch (e) {
    console.warn(`[coach] document picker failed: ${e instanceof Error ? e.name : "error"}`);
    return { ok: false, reason: "failed" };
  }
}
