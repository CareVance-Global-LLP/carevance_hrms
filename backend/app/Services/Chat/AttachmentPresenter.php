<?php

namespace App\Services\Chat;

/**
 * How an attachment describes itself in a notification.
 *
 * Chat notifications said `Sent an attachment` for everything — a photo, a
 * payslip PDF and a 40 MB zip were indistinguishable, so the only way to learn
 * what somebody had sent was to open the app. That is the opposite of what a
 * notification is for.
 *
 * The vocabulary here is deliberately WhatsApp's, because it is the one people
 * already read fluently: a kind for a media file ("Photo"), the file's own name
 * for a document, and the caption in place of either when one was written —
 * a caption is what the sender chose to say, and it always outranks a label we
 * generated.
 */
class AttachmentPresenter
{
    public const KIND_PHOTO = 'photo';
    public const KIND_VIDEO = 'video';
    public const KIND_AUDIO = 'audio';
    public const KIND_ARCHIVE = 'archive';
    public const KIND_DOCUMENT = 'document';

    /**
     * Which broad family a mime type belongs to.
     *
     * Grouped rather than listed exhaustively: the point is choosing an icon
     * and a noun, and a caller does not need to know that `image/webp` and
     * `image/jpeg` are different things.
     */
    public function kind(?string $mime): string
    {
        $normalized = strtolower(trim((string) $mime));

        if (str_starts_with($normalized, 'image/')) {
            return self::KIND_PHOTO;
        }

        if (str_starts_with($normalized, 'video/')) {
            return self::KIND_VIDEO;
        }

        if (str_starts_with($normalized, 'audio/')) {
            return self::KIND_AUDIO;
        }

        $archives = [
            'application/zip',
            'application/x-zip-compressed',
            'application/x-rar-compressed',
            'application/vnd.rar',
            'application/x-tar',
            'application/gzip',
        ];

        if (in_array($normalized, $archives, true)) {
            return self::KIND_ARCHIVE;
        }

        return self::KIND_DOCUMENT;
    }

    /** Only images get a rendered preview; everything else shows its icon. */
    public function hasThumbnail(?string $mime): bool
    {
        return $this->kind($mime) === self::KIND_PHOTO;
    }

    /**
     * The single line a notification shows.
     *
     * Three rules, in order:
     *
     * 1. A caption wins. If the sender typed something, that is the message and
     *    the attachment is decoration — showing "Photo" instead of what they
     *    wrote would discard the actual content.
     * 2. A document is named. "invoice-March.pdf" tells you whether to open it;
     *    "Document" does not.
     * 3. Media is labelled, not named. Camera filenames (IMG_20260824_113045)
     *    carry no information, so "Photo" is genuinely more useful.
     */
    public function summary(?string $body, ?string $name, ?string $mime): string
    {
        $caption = trim((string) $body);
        $icon = $this->icon($mime);

        if ($caption !== '') {
            return $icon.' '.$caption;
        }

        $kind = $this->kind($mime);

        if (in_array($kind, [self::KIND_PHOTO, self::KIND_VIDEO, self::KIND_AUDIO], true)) {
            return $icon.' '.$this->label($kind);
        }

        $filename = trim((string) $name);

        return $filename !== ''
            ? $icon.' '.$filename
            : $icon.' '.$this->label($kind);
    }

    public function icon(?string $mime): string
    {
        return match ($this->kind($mime)) {
            self::KIND_PHOTO => '📷',
            self::KIND_VIDEO => '🎥',
            self::KIND_AUDIO => '🎵',
            self::KIND_ARCHIVE => '🗜️',
            default => '📄',
        };
    }

    public function label(string $kind): string
    {
        return match ($kind) {
            self::KIND_PHOTO => 'Photo',
            self::KIND_VIDEO => 'Video',
            self::KIND_AUDIO => 'Audio',
            self::KIND_ARCHIVE => 'Archive',
            default => 'Document',
        };
    }

    /**
     * What travels on the notification so a client can render a preview.
     *
     * `thread` and `message_id` are here because the thumbnail is fetched
     * through the authenticated attachment route, and direct and group
     * messages live at different paths.
     *
     * @return array<string, mixed>
     */
    public function meta(int $messageId, string $thread, ?string $name, ?string $mime, ?int $size): array
    {
        return [
            'message_id' => $messageId,
            'thread' => $thread,
            'kind' => $this->kind($mime),
            'name' => $name,
            'mime' => $mime,
            'size' => $size,
            'has_thumbnail' => $this->hasThumbnail($mime),
        ];
    }
}
