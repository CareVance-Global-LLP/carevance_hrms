<?php

namespace App\Http\Requests\Api\Chat;

use App\Http\Requests\Api\ApiFormRequest;

class SendChatMessageRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'body' => 'nullable|string|max:4000',
            'attachment' => [
                'nullable',
                'file',
                'max:204800',
                'mimetypes:application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png,image/webp,application/zip,application/x-zip-compressed,application/x-rar-compressed,application/x-tar,application/gzip,application/vnd.rar',
            ],
        ];
    }
}
