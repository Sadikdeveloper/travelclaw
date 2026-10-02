import type { MessageAttachment } from '@travelclaw/shared';
import { FileText, ImageIcon, X } from 'lucide-react';
import { formatBytes } from '../attachments';

/**
 * One attached file, as it appears while composing and in a sent message. Images
 * show the thumbnail rendered on this device; documents show a type icon. The
 * gateway only ever stored this much — see src/attachments.ts.
 */
export function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: MessageAttachment;
  onRemove?: () => void;
}) {
  const isImage = attachment.kind === 'image' && attachment.thumb;
  return (
    <span
      className="attach-chip"
      title={`${attachment.name} · ${formatBytes(attachment.size)}`}
    >
      {isImage ? (
        <img src={attachment.thumb ?? ''} alt="" className="attach-thumb" loading="lazy" />
      ) : (
        <span className="attach-icon" aria-hidden="true">
          {attachment.kind === 'image' ? <ImageIcon size={15} /> : <FileText size={15} />}
        </span>
      )}
      <span className="attach-name">{attachment.name}</span>
      <span className="attach-size">{formatBytes(attachment.size)}</span>
      {onRemove ? (
        <button
          type="button"
          className="attach-remove"
          aria-label={`Remove ${attachment.name}`}
          onClick={onRemove}
        >
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
