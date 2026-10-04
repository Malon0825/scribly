import { invoke, isTauri } from "@tauri-apps/api/core";
import { availableAttachment, displayImageSource, storeAttachment } from "./attachments";
import { MAX_IMAGE_BYTES, rasterType, safeInlineImageSource } from "./rasterImages";
export { MAX_IMAGE_BYTES } from "./rasterImages";
export const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif";
export type ImageAttrs = { src: string; alt: string; title: string; width: number; align: string; caption: string };
export const isImageFile = (file: Pick<File, "name" | "type">) => /^image\//i.test(file.type) || /\.(png|jpe?g|webp|gif|bmp|svg|heic|avif)$/i.test(file.name);
// Imported HTML cannot fetch remote images; references resolve only inside the notebook.
export function safeImageSource(value: unknown): value is string {
  return availableAttachment(value) || safeInlineImageSource(value);
}
export async function readImage(file: File): Promise<ImageAttrs> {
  if (file.size > MAX_IMAGE_BYTES) throw Error("Image exceeds 5 MB. Use a smaller copy.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = rasterType(bytes);
  if (!type) throw Error("Use a PNG, JPEG, WebP or GIF image.");
  const url = URL.createObjectURL(new Blob([bytes], { type: `image/${type}` }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 25_000_000)
      throw Error("Image exceeds 25 million pixels. Use a smaller copy.");
  } catch (error) {
    if ((error as Error).message.includes("25 million")) throw error;
    throw Error("This image could not be read. Try another copy.");
  } finally { URL.revokeObjectURL(url); }
  const src = isTauri() ? await storeAttachment(bytes) : await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(Error("This image could not be read."));
    reader.readAsDataURL(new Blob([bytes], { type: `image/${type}` }));
  });
  return { src, alt: file.name.slice(0, 300), title: file.name.slice(0, 300), width: 100, align: "center", caption: "" };
}
export async function downloadImage(src: string, name: string) {
  if (!safeImageSource(src)) return;
  const link = document.createElement("a");
  link.href = displayImageSource(src);
  const ext = src.match(/^data:image\/(\w+)/)?.[1] || src.split(".").at(-1) || "png";
  const filename = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100) || "image";
  link.download = /\.(png|jpe?g|gif|webp)$/i.test(filename) ? filename : `${filename}.${ext}`;
  if (availableAttachment(src)) {
    await invoke("export_attachment", { id: src.slice("notify-attachment:".length), fileName: link.download });
    return;
  }
  link.click();
}
