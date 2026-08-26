<?php

namespace App\Services\Ai;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * The one way a planner talks to a model.
 *
 * Lifted out of `QueryPlanner` when a SECOND planner appeared. There is nothing
 * clever in here — a provider list, a fallback loop, three settings and a JSON
 * extractor — and that is precisely why it must exist once. A copy of it beside
 * `ActionPlanner` would drift the first time anything about providers changed:
 * a new fallback model, a different timeout, a header the vendor started
 * requiring. The read path would get the fix and the write path would keep the
 * old behaviour, silently, in the half nobody exercises until somebody asks for
 * a change.
 *
 * WHAT A PLANNING CALL IS ALLOWED TO SEE
 *
 * A question and a catalogue of NAMES. No rows, no employees, no figures. That
 * is what makes it safe to run on `stealth/ox-alpha`, a cloaked pre-release
 * model whose traffic reaches the originating lab, and it is why the secondary
 * provider is tried FIRST here while the summariser — which does see rows —
 * runs on the primary. Anything that would put data in a prompt does not belong
 * on this client.
 *
 * THE THREE SETTINGS, AND WHAT EACH ONE COST TO LEARN
 *
 *  - `temperature: 0` — a plan is a translation, not a composition.
 *  - `reasoning: {effort: low}` — ox-alpha's reasoning is mandatory and
 *    defaults to "max", which measured 6.6s against ~3s pinned low.
 *  - RAW JSON, with a fenced fallback — `response_format: json_schema` is
 *    advertised and NOT honoured; a strict run came back fenced with keys
 *    absent from the schema.
 */
class PlanningClient
{
    /** Whether any provider is configured at all. */
    public function configured(): bool
    {
        return $this->providers() !== [];
    }

    /**
     * Ask every configured provider, in order, for one JSON object.
     *
     * Returns the first parseable object, or null when nothing answered — a
     * null is a REFUSAL for the caller to phrase, never a default plan. A
     * planner that fills in a guess when the model said nothing usable writes
     * to a row nobody asked about.
     *
     * @param  int  $maxTokens  the answer budget; a plan truncated mid-object is unparseable, and unparseable is a refusal for want of budget rather than for anything about the question
     * @param  string  $label  what to call this in the log when an attempt fails
     * @return array<string, mixed>|null
     */
    public function json(string $systemPrompt, string $question, int $maxTokens, string $label): ?array
    {
        foreach ($this->providers() as $provider) {
            foreach ($provider['models'] as $model) {
                $content = $this->attempt($provider, $model, $systemPrompt, $question, $maxTokens, $label);

                if ($content === null) {
                    continue;
                }

                $parsed = $this->extractJson($content);

                if ($parsed !== null) {
                    return $parsed;
                }
            }
        }

        return null;
    }

    private function attempt(
        array $provider,
        string $model,
        string $systemPrompt,
        string $question,
        int $maxTokens,
        string $label,
    ): ?string {
        try {
            $response = Http::withToken($provider['api_key'])
                ->withHeaders([
                    'HTTP-Referer' => config('services.ai.site_url'),
                    'X-Title' => config('services.ai.app_name'),
                ])
                ->timeout(20)
                ->post(rtrim($provider['base_url'], '/').'/chat/completions', [
                    'model' => $model,
                    'temperature' => 0,
                    'max_tokens' => $maxTokens,
                    'reasoning' => ['effort' => 'low'],
                    'messages' => [
                        ['role' => 'system', 'content' => $systemPrompt],
                        ['role' => 'user', 'content' => $question],
                    ],
                ]);

            if (! $response->successful()) {
                return null;
            }

            return data_get($response->json(), 'choices.0.message.content');
        } catch (\Throwable $e) {
            Log::warning('AI mode '.$label.' attempt failed', ['model' => $model, 'error' => $e->getMessage()]);

            return null;
        }
    }

    /**
     * Raw JSON first, then a fenced block, then the first brace-to-brace run.
     *
     * @return array<string, mixed>|null
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
     * Secondary first: a planning call sees no employee data, so the free
     * cloaked model is the right default here and the paid primary is the
     * fallback.
     *
     * @return list<array{base_url: string, api_key: string, models: list<string>}>
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
