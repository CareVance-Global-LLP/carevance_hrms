<?php

namespace App\Services\Ai;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * One sentence over the rows that were just fetched.
 *
 * This is the only step that sees real employee data, so it runs ONLY on the
 * configured primary provider — a paid key, not the cloaked stealth model whose
 * traffic reaches an unnamed lab. With no primary configured there is no
 * summary, and the table stands on its own.
 */
class AnswerSummariser
{
    public function summarise(string $question, array $columns, array $rows): ?string
    {
        if (empty($rows)) {
            return null;
        }

        $apiKey = config('services.ai.api_key');

        if (empty($apiKey)) {
            return null;
        }

        try {
            $response = Http::withToken($apiKey)
                ->timeout(20)
                ->post(rtrim((string) config('services.ai.base_url'), '/') . '/chat/completions', [
                    'model' => config('services.ai.model'),
                    'temperature' => 0.2,
                    // gemini-flash-latest reasons before it writes. At 120 it
                    // spent the whole budget thinking and returned nothing.
                    'max_tokens' => 800,
                    'messages' => [
                        ['role' => 'system', 'content' => $this->systemPrompt()],
                        ['role' => 'user', 'content' => $this->userPrompt($question, $columns, $rows)],
                    ],
                ]);

            if (! $response->successful()) {
                return null;
            }

            $content = trim((string) data_get($response->json(), 'choices.0.message.content', ''));

            return $content !== '' ? $content : null;
        } catch (\Throwable $e) {
            Log::warning('AI mode summary failed', ['error' => $e->getMessage()]);

            return null;
        }
    }

    private function systemPrompt(): string
    {
        return implode(' ', [
            'Summarise this HR data table in ONE sentence for an admin.',
            'State only what the rows show. Do not speculate about causes.',
            'Amounts are Indian rupees: write them with the ₹ symbol and Indian digit grouping.',
            'No preamble, no markdown, no bullet points.',
        ]);
    }

    private function userPrompt(string $question, array $columns, array $rows): string
    {
        return 'Question: ' . $question . "\n"
            . 'Columns: ' . json_encode($columns) . "\n"
            . 'Rows: ' . json_encode($rows);
    }
}
