<?php

namespace App\Services\Ai;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Turns a question into a query plan.
 *
 * This step deliberately sees NO employee data — only the question and the
 * catalogue of entity/metric/dimension names. That is what makes it safe to run
 * on `stealth/ox-alpha`, a cloaked pre-release model whose traffic reaches the
 * originating lab. Rows never come here; they go to the summariser, which runs
 * on the primary provider.
 */
class QueryPlanner
{
    public function plan(string $question): array
    {
        $providers = $this->providers();

        if (empty($providers)) {
            throw new UnsupportedQuestionException('The AI service is not configured.');
        }

        foreach ($providers as $provider) {
            foreach ($provider['models'] as $model) {
                $content = $this->attempt($provider, $model, $question);

                if ($content === null) {
                    continue;
                }

                $parsed = $this->extractJson($content);

                if ($parsed !== null) {
                    return $parsed;
                }
            }
        }

        throw new UnsupportedQuestionException("I couldn't turn that into a data question.");
    }

    private function attempt(array $provider, string $model, string $question): ?string
    {
        try {
            $response = Http::withToken($provider['api_key'])
                ->withHeaders([
                    'HTTP-Referer' => config('services.ai.site_url'),
                    'X-Title' => config('services.ai.app_name'),
                ])
                ->timeout(20)
                ->post(rtrim($provider['base_url'], '/') . '/chat/completions', [
                    'model' => $model,
                    'temperature' => 0,
                    'max_tokens' => 700,
                    // ox-alpha's reasoning is mandatory and defaults to "max",
                    // which costs 6.6s. Pinned to low it answers in ~3s.
                    'reasoning' => ['effort' => 'low'],
                    'messages' => [
                        ['role' => 'system', 'content' => $this->systemPrompt()],
                        ['role' => 'user', 'content' => $question],
                    ],
                ]);

            if (! $response->successful()) {
                return null;
            }

            return data_get($response->json(), 'choices.0.message.content');
        } catch (\Throwable $e) {
            Log::warning('AI mode planner attempt failed', ['model' => $model, 'error' => $e->getMessage()]);

            return null;
        }
    }

    private function systemPrompt(): string
    {
        return <<<PROMPT
        You translate an HR admin's question into ONE query plan for CareVance HRMS.

        Today is {$this->today()}. Resolve relative dates against it.

        Respond with RAW JSON only. No markdown fence, no prose, no explanation.

        Shape:
        {"entity":string,"metric":string,"group_by":string|null,"filters":object,"sort":"metric_desc"|"metric_asc"|null,"limit":number}

        You may only use these entities, metrics and group_by dimensions:
        {$this->catalogue()}

        If the question cannot be answered from exactly these, return:
        {"error":"<one sentence saying what is missing>"}

        Never invent an entity, metric or dimension that is not listed above.
        PROMPT;
    }

    private function today(): string
    {
        return now()->toDateString();
    }

    private function catalogue(): string
    {
        return SemanticLayer::promptCatalogue();
    }

    /**
     * ox-alpha returns raw JSON when told to, but `response_format:
     * json_schema` is advertised and NOT honoured — a strict run came back
     * fenced with keys absent from the schema. So parse, then fall back.
     */
    private function extractJson(string $content): ?array
    {
        $content = trim($content);

        $direct = json_decode($content, true);
        if (is_array($direct)) {
            return $direct;
        }

        if (preg_match('/```(?:json)?\s*([\s\S]*?)```/', $content, $matches)) {
            $fenced = json_decode(trim($matches[1]), true);
            if (is_array($fenced)) {
                return $fenced;
            }
        }

        if (preg_match('/(\{[\s\S]*\})/', $content, $matches)) {
            $loose = json_decode($matches[1], true);
            if (is_array($loose)) {
                return $loose;
            }
        }

        return null;
    }

    /**
     * Secondary first: the planner sees no employee data, so the free cloaked
     * model is the right default here and the paid primary is the fallback.
     */
    private function providers(): array
    {
        $providers = [];

        $secondaryKey = config('services.ai.secondary_api_key');
        if (! empty($secondaryKey)) {
            $providers[] = [
                'base_url' => config('services.ai.secondary_base_url'),
                'api_key' => $secondaryKey,
                'models' => array_filter(array_map('trim', explode(',', (string) config('services.ai.secondary_models')))),
            ];
        }

        $primaryKey = config('services.ai.api_key');
        if (! empty($primaryKey)) {
            $providers[] = [
                'base_url' => config('services.ai.base_url'),
                'api_key' => $primaryKey,
                'models' => [config('services.ai.model')],
            ];
        }

        return $providers;
    }
}
