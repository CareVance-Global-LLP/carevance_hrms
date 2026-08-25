<?php

namespace App\Services\Chat;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Small square previews for image attachments.
 *
 * Exists so a notification can show what was sent rather than the word
 * "attachment". Deliberately tiny: this is decoration on a toast, not a
 * viewer — the full image is already reachable through the attachment route.
 *
 * Uses GD, which is already available, rather than adding an image library for
 * one 96px square.
 */
class ThumbnailGenerator
{
    /** Square edge, in pixels. Large enough for a toast on a HiDPI screen. */
    public const SIZE = 192;

    private const DISK = 'chat_attachments';

    /**
     * Refuse anything whose decoded size would threaten memory_limit.
     *
     * GD decodes to roughly width × height × 4 bytes REGARDLESS of how small
     * the compressed file is — a 3 MB JPEG at 12000×9000 needs ~430 MB. With
     * memory_limit at 128M that is a fatal error, not an exception, so it
     * cannot be caught and would take the whole request down. Checking the
     * dimensions from the header first is the only way to decline safely.
     */
    private const MAX_DECODED_BYTES = 48 * 1024 * 1024;

    /**
     * Path on the attachments disk holding the thumbnail, or null when one
     * cannot be produced.
     *
     * Generated once and cached. Callers treat null as "no preview available"
     * and fall back to an icon — never as an error, because a notification
     * that fails to send because a thumbnail could not be built would be a far
     * worse outcome than a notification without a picture.
     */
    public function forAttachment(?string $attachmentPath, ?string $mime): ?string
    {
        if (! $attachmentPath || ! str_starts_with(strtolower((string) $mime), 'image/')) {
            return null;
        }

        $disk = Storage::disk(self::DISK);
        $safePath = basename($attachmentPath);
        $thumbnailPath = 'thumbnails/'.$safePath.'.jpg';

        if ($disk->exists($thumbnailPath)) {
            return $thumbnailPath;
        }

        if (! $disk->exists($safePath)) {
            return null;
        }

        try {
            $sourcePath = $disk->path($safePath);
            $encoded = $this->render($sourcePath);

            if ($encoded === null) {
                return null;
            }

            $disk->put($thumbnailPath, $encoded);

            return $thumbnailPath;
        } catch (\Throwable $exception) {
            // A preview is a nicety. Losing it must never cost the message.
            Log::warning('Chat thumbnail generation failed; falling back to an icon.', [
                'attachment' => $attachmentPath,
                'mime' => $mime,
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Centre-cropped square JPEG, or null if the image cannot be handled.
     */
    private function render(string $sourcePath): ?string
    {
        $info = @getimagesize($sourcePath);
        if ($info === false) {
            return null;
        }

        [$width, $height] = $info;
        if ($width < 1 || $height < 1) {
            return null;
        }

        if (($width * $height * 4) > self::MAX_DECODED_BYTES) {
            Log::info('Chat thumbnail skipped: image too large to decode safely.', [
                'width' => $width,
                'height' => $height,
            ]);

            return null;
        }

        $source = match ($info[2]) {
            IMAGETYPE_JPEG => @imagecreatefromjpeg($sourcePath),
            IMAGETYPE_PNG => @imagecreatefrompng($sourcePath),
            IMAGETYPE_WEBP => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($sourcePath) : false,
            IMAGETYPE_GIF => @imagecreatefromgif($sourcePath),
            default => false,
        };

        if (! $source) {
            return null;
        }

        try {
            // Centre crop to a square first, then scale. Squashing to a square
            // instead would distort faces, which is the one thing a preview of
            // a photo must not do.
            $edge = min($width, $height);
            $sourceX = (int) (($width - $edge) / 2);
            $sourceY = (int) (($height - $edge) / 2);

            $canvas = imagecreatetruecolor(self::SIZE, self::SIZE);
            if (! $canvas) {
                return null;
            }

            try {
                // Transparent PNGs would otherwise composite onto black, which
                // looks like a broken image rather than a preview.
                $white = imagecolorallocate($canvas, 255, 255, 255);
                imagefilledrectangle($canvas, 0, 0, self::SIZE, self::SIZE, $white);

                imagecopyresampled(
                    $canvas, $source,
                    0, 0,
                    $sourceX, $sourceY,
                    self::SIZE, self::SIZE,
                    $edge, $edge
                );

                ob_start();
                imagejpeg($canvas, null, 78);

                return (string) ob_get_clean();
            } finally {
                imagedestroy($canvas);
            }
        } finally {
            imagedestroy($source);
        }
    }
}
