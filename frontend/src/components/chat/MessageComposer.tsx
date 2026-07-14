import { ClipboardEvent, useRef } from 'react';
import { Send, Paperclip, X, Image as ImageIcon } from 'lucide-react';

const MAX_CHAT_ATTACHMENT_BYTES = 200 * 1024 * 1024;

const getFileExtension = (filename?: string) => {
  if (!filename) return '?';
  const parts = filename.split('.');
  const ext = parts.length > 1 ? parts.pop() : '';
  return ext ? ext.substring(0, 4).toUpperCase() : '?';
};

const formatBytes = (size?: number) => {
  if (!size || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

interface MessageComposerProps {
  messageText: string;
  onMessageChange: (value: string) => void;
  onSendMessage: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  attachmentFiles: File[];
  onAddAttachments: (files: FileList | null) => void;
  onRemoveAttachment: (index: number) => void;
  disabled: boolean;
  placeholder?: string;
  getFilePreviewUrl: (file: File) => string | null;
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export default function MessageComposer({
  messageText,
  onMessageChange,
  onSendMessage,
  onKeyDown,
  attachmentFiles,
  onAddAttachments,
  onRemoveAttachment,
  disabled,
  placeholder = 'Type a message...',
  getFilePreviewUrl,
  onPaste,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: MessageComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSendMessage(); }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="border-t border-gray-200 p-3"
    >
      <div className="space-y-3">
        {attachmentFiles.length > 0 && (
          <div className="space-y-2">
            {attachmentFiles.map((file, fileIndex) => {
              const previewUrl = getFilePreviewUrl(file);
              return (
                <div key={`${file.name}-${file.size}-${fileIndex}`} className="rounded-xl border border-gray-200 bg-white p-2">
                  <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    {previewUrl ? (
                      <img src={previewUrl} alt={file.name} className="max-h-40 w-full object-contain" />
                    ) : (
                      <div className="flex h-12 items-center gap-2 px-3 text-xs text-gray-500">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-100 text-[10px] font-bold text-primary-700">
                          {getFileExtension(file.name)}
                        </span>
                        <span className="truncate">{file.name}</span>
                        {file.size ? <span className="shrink-0 text-gray-400">({formatBytes(file.size)})</span> : null}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(fileIndex)}
                      className="absolute right-2 top-2 rounded-full bg-black/65 px-2 py-1 text-xs font-medium text-white hover:bg-black/75"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gray-300 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50"
            title="Attach file"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <textarea
            value={messageText}
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="min-h-[44px] w-full resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm transition-colors focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-300 disabled:bg-gray-100"
          />
          <button
            type="submit"
            disabled={disabled || (!messageText.trim() && attachmentFiles.length === 0)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
            aria-label="Send message"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          disabled={disabled}
          onChange={(e) => onAddAttachments(e.target.files)}
          className="hidden"
        />
      </div>
    </form>
  );
}
