<?php

namespace App\Http\Requests\Api\Chat;

use App\Http\Requests\Api\ApiFormRequest;
use App\Services\Uploads\ChunkedUploadService;

class SendChatMessageRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'body' => 'nullable|string|max:4000',

            /*
             * The DIRECT path, for files small enough to ride along with the
             * message. Anything larger arrives as a chunked upload and is
             * quoted by `upload_key` instead.
             *
             * The size limit is computed from this server's own php.ini rather
             * than hardcoded. It used to read `max:204800` — 200 MB — which was
             * unreachable and therefore actively misleading: PHP discards a
             * body over upload_max_filesize BEFORE Laravel runs, so a 50 MB
             * file never reached this rule at all. The request arrived with an
             * empty files array and the user was told "no attachment" for a
             * file they had visibly attached. A limit that cannot fire is worse
             * than no limit, because it reads like a guarantee.
             */
            'attachment' => [
                'nullable',
                'file',
                'max:'.$this->directAttachmentMaxKilobytes(),
                'mimetypes:'.implode(',', ChunkedUploadService::ALLOWED_MIMES),
            ],

            // A completed chunked upload, claimed exactly once. Validated as a
            // plain string here; whether it exists, belongs to this caller and
            // has not already been attached is decided in the service, where
            // the claim can be made atomically.
            'upload_key' => 'nullable|string|max:64',
        ];
    }

    /**
     * What a single request can genuinely carry on this machine, in KB.
     *
     * Uses the same figure the chunked uploader negotiates with clients, so
     * the two paths agree about where the boundary is instead of disagreeing
     * by an environment-dependent margin.
     */
    private function directAttachmentMaxKilobytes(): int
    {
        return max(1, (int) floor(app(ChunkedUploadService::class)->chunkSizeBytes() / 1024));
    }
}
