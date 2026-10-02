import type { MessageAttachment } from '@travelclaw/shared';
import { Paperclip, Send, Sparkles, Square } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  ATTACH_ACCEPT,
  formatBytes,
  isAcceptable,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  toAttachment,
} from '../attachments';
import { AttachmentChip } from './AttachmentChip';

/**
 * The one composer, on the landing hero and inside a thread. It carries the whole
 * ask: attach a file, write, send with one tap, and stop waiting when the desk is
 * slow. The "Agent mode" tag lives here, next to where the traveler writes, so the
 * mode is visible while typing rather than in a header badge.
 */
export function Composer({
  variant,
  draft,
  onDraftChange,
  attachments,
  onAttachmentsChange,
  sending,
  onSend,
  onStop,
}: {
  variant: 'hero' | 'thread';
  draft: string;
  onDraftChange: (value: string) => void;
  attachments: MessageAttachment[];
  onAttachmentsChange: (value: MessageAttachment[]) => void;
  sending: boolean;
  onSend: (text: string, attachments: MessageAttachment[]) => void;
  onStop: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [notice, setNotice] = useState('');
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Grow with the draft, up to a ceiling; a long paste should not push the thread off screen.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const busy = sending || reading;
  const hasSubstance = draft.trim().length > 0 || attachments.length > 0;

  async function addFiles(list: FileList | File[] | null) {
    if (!list || busy) return;
    const incoming = Array.from(list);
    if (!incoming.length) return;
    setReading(true);
    const accepted: MessageAttachment[] = [];
    const problems: string[] = [];
    for (const file of incoming) {
      if (attachments.length + accepted.length >= MAX_ATTACHMENTS) {
        problems.push(`at most ${MAX_ATTACHMENTS} files per message`);
        break;
      }
      if (file.size > MAX_FILE_BYTES) {
        problems.push(`${file.name} is over ${formatBytes(MAX_FILE_BYTES)}`);
        continue;
      }
      if (!isAcceptable(file)) {
        problems.push(`${file.name} is not an image or document`);
        continue;
      }
      accepted.push(await toAttachment(file));
    }
    if (accepted.length) {
      onAttachmentsChange([...attachments, ...accepted]);
      textarea.current?.focus();
    }
    setNotice(problems.length ? problems.join(' · ') : '');
    setReading(false);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    void addFiles(event.target.files);
    // Reset so picking the same file again still fires a change event.
    event.target.value = '';
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = event.clipboardData?.files;
    if (files?.length) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  function onDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer?.files ?? null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return; // mid-IME Enter selects a candidate, not send
    event.preventDefault();
    if (!busy && hasSubstance) onSend(draft, attachments);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && hasSubstance) onSend(draft, attachments);
  }

  return (
    <form
      className={variant === 'hero' ? 'composer hero-composer' : 'composer'}
      onSubmit={submit}
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {attachments.length || notice ? (
        <div className="composer-row composer-files" aria-live="polite">
          {attachments.map((attachment, index) => (
            <AttachmentChip
              key={`${attachment.name}-${index}`}
              attachment={attachment}
              onRemove={
                busy
                  ? undefined
                  : () => onAttachmentsChange(attachments.filter((_, at) => at !== index))
              }
            />
          ))}
          {notice ? <span className="attach-notice">{notice}</span> : null}
        </div>
      ) : null}
      <div className={dragging ? 'composer-main dragging' : 'composer-main'}>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          onChange={onFileChange}
          hidden
        />
        <button
          type="button"
          className="composer-tool"
          aria-label="Attach an image or document"
          title="Attach an image or document"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip size={17} aria-hidden="true" />
        </button>
        <label className="sr-only" htmlFor={`draft-${variant}`}>
          Message
        </label>
        <textarea
          id={`draft-${variant}`}
          ref={textarea}
          rows={1}
          value={draft}
          placeholder={
            variant === 'hero' ? 'A flight, a hotel, or both' : 'Reply to the desk…'
          }
          autoFocus={variant === 'hero'}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        {sending ? (
          <button
            type="button"
            className="send-btn stop"
            aria-label="Stop the desk and show me where it got to"
            title="Stop waiting — the desk stops asking its tools"
            onClick={onStop}
          >
            <Square size={14} fill="currentColor" aria-hidden="true" />
          </button>
        ) : (
          <button
            className="send-btn"
            type="submit"
            aria-label="Send"
            title="Send"
            disabled={!hasSubstance}
          >
            <Send size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="composer-row composer-meta">
        <span
          className="mode-chip"
          title="The desk runs tools and checks with you before anything is booked"
        >
          <Sparkles size={12} aria-hidden="true" />
          Agent mode
        </span>
        <span className="composer-hint">
          {sending
            ? 'The desk is working — you can stop it'
            : 'Enter to send · Shift+Enter for a new line · drop or paste a file to attach'}
        </span>
      </div>
    </form>
  );
}
