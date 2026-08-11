import { useId, useRef, useState, type DragEvent } from 'react';
import { Camera } from 'lucide-react';
import { cn } from '@/utils/cn';

interface ImageDropzoneProps {
  preview?: string;
  /** Shown when there is no image — an initial for a person, a word for a logo. */
  fallback: string;
  onFile: (file: File | null) => void;
  shape?: 'circle' | 'rounded';
  disabled?: boolean;
  label: string;
  hint?: string;
}

/**
 * Replaces `<input type="file">`, whose native "Choose File / No file chosen"
 * chrome was the least finished control on the settings page and sat at the top
 * of the first tab. The input is still there — it is just no longer the target.
 */
export default function ImageDropzone({
  preview,
  fallback,
  onFile,
  shape = 'circle',
  disabled,
  label,
  hint,
}: ImageDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const open = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) {
      return;
    }
    const file = event.dataTransfer.files?.[0] || null;
    onFile(file);
  };

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={open}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) {
            setIsDragging(true);
          }
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        disabled={disabled}
        aria-label={label}
        className={cn(
          'group relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden border-2 border-dashed transition',
          shape === 'circle' ? 'rounded-full' : 'rounded-2xl',
          isDragging ? 'border-solid border-sky-400 bg-sky-50' : 'border-blue-300 bg-blue-50',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-solid hover:border-sky-400',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2'
        )}
      >
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <span
            className={cn(
              'font-bold text-blue-700',
              shape === 'circle' ? 'text-2xl' : 'text-[10px] uppercase tracking-[0.14em]'
            )}
          >
            {fallback}
          </span>
        )}
        {!disabled ? (
          <span className="absolute inset-x-0 bottom-0 flex h-6 items-center justify-center bg-surface-inverse/75 text-on-inverse opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            <Camera className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </button>

      <div className="min-w-0">
        <label htmlFor={inputId} className="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          {label}
        </label>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          {hint || 'Click or drop an image here. PNG or JPG, up to 2MB.'}
        </p>
        {preview && !disabled ? (
          <button
            type="button"
            onClick={() => {
              onFile(null);
              if (inputRef.current) {
                inputRef.current.value = '';
              }
            }}
            className="mt-1 text-xs font-semibold text-slate-600 underline-offset-2 hover:text-red-600 hover:underline"
          >
            Remove
          </button>
        ) : null}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => onFile(event.target.files?.[0] || null)}
        />
      </div>
    </div>
  );
}
