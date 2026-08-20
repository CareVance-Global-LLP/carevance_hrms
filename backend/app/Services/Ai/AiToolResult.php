<?php

namespace App\Services\Ai;

/**
 * What one assistant tool hands back: the data the model reasons over, and the
 * places in the app where a human can go and see the same records.
 *
 * The sources are collected by AiChatService and returned to the client
 * alongside the reply, rather than being formatted into the prose by the model.
 * That is deliberate: a citation the model writes is a citation the model can
 * hallucinate. These come from the code path that actually ran.
 */
final class AiToolResult
{
    /**
     * @param  array<string, mixed>  $data
     * @param  list<array{label: string, route: string}>  $sources
     */
    public function __construct(
        public readonly array $data,
        public readonly array $sources = [],
    ) {
    }

    public static function error(string $message): self
    {
        return new self(['error' => $message], []);
    }

    public function toJson(): string
    {
        return (string) json_encode($this->data);
    }
}
