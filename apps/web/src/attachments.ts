import type { MessageAttachment } from '@travelclaw/shared';

/**
 * Attachments stay light on purpose: the gateway is told what arrived (name, kind,
 * size) plus, for images, a small inline thumbnail rendered from the file on this
 * device. The bytes themselves never leave the browser — document reading is a
 * later step on the roadmap, so the desk acknowledges files, it does not open them.
 */

export const MAX_ATTACHMENTS = 4;
export const MAX_FILE_BYTES = 12 * 1024 * 1024;
/** Largest thumbnail we will inline or persist, matching the shared schema cap. */
const MAX_THUMB_CHARS = 170_000;
const THUMB_EDGE = 384;

export const ATTACH_ACCEPT = [
  'image/*',
  '.pdf',
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
].join(',');

export const IMAGE_ACCEPT = 'image/*';

const DOCUMENT_EXTENSIONS = new Set([
  'pdf',
  'txt',
  'md',
  'csv',
  'json',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
]);

export function isImage(file: File): boolean {
  return file.type.startsWith('image/');
}

/** True when the picker should take the file: an image, or a known document type. */
export function isAcceptable(file: File): boolean {
  if (isImage(file)) return true;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return file.type === 'text/plain' || DOCUMENT_EXTENSIONS.has(extension);
}

export function kindFor(file: File): MessageAttachment['kind'] {
  return isImage(file) ? 'image' : 'document';
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Builds the wire shape for one file. Images get a thumbnail drawn on a canvas —
 * a quick downscale, not a re-encode of the original, and skipped entirely if the
 * result would be too large to carry.
 */
export async function toAttachment(file: File): Promise<MessageAttachment> {
  const base: MessageAttachment = {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    kind: kindFor(file),
  };
  if (!isImage(file)) return base;
  try {
    const thumb = await renderThumb(file);
    return thumb ? { ...base, thumb } : base;
  } catch {
    // A file the browser cannot decode still arrives as a named attachment.
    return base;
  }
}

function renderThumb(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, THUMB_EDGE / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
        resolve(dataUrl.length <= MAX_THUMB_CHARS ? dataUrl : null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}
