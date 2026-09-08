<?php

namespace App\Services\Ai;

use Illuminate\Support\Facades\Cache;

/**
 * Short-term memory for the data-path assistant.
 *
 * Stores the last few question→answer pairs per user so follow-up questions
 * like "and last month?" or "what about my team?" can resolve against prior
 * context. Memory is CACHE-BASED, not database-backed — it lives for 30
 * minutes and is destroyed on session expiry or cache flush.
 *
 * CRITICAL SAFETY PROPERTY:
 *
 * Memory is used ONLY to INTERPRET what the user is asking (resolve
 * pronouns, follow-ups, context). It is NEVER used as a source of factual
 * data. Every answer still comes from a fresh, verified database query.
 *
 * If data changed between two questions in the same conversation, the second
 * question returns the NEW correct data, not a stale cached answer — because
 * the answer is always computed by QueryPlanExecutor against the live
 * database, never read from this store.
 */
class ConversationMemory
{
    /**
     * Maximum number of Q&A turns to remember.
     *
     * Chosen to balance context window size against token cost. The
     * QueryPlanner prompt already uses ~1200 tokens for the catalogue; adding
     * 5 turns of ~100 tokens each is ~500 more — within budget.
     */
    private const MAX_TURNS = 5;

    /**
     * TTL in minutes. After this, the conversation is forgotten.
     *
     * 30 minutes covers a realistic "ask a question, think, ask another"
     * cycle. Short enough to limit memory bloat; long enough that an admin
     * who steps away to check something does not lose context.
     */
    private const TTL_MINUTES = 30;

    /**
     * Cache key prefix. Scoped to user so different admins cannot read each
     * other's conversation history.
     */
    private const CACHE_PREFIX = 'ai_chat_context:';

    /**
     * Store one question→answer pair.
     *
     * @param  int  $userId
     * @param  string  $question  the user's question, verbatim
     * @param  string  $answerSummary  a brief summary of what was returned (NOT the full data — just enough context for the planner to resolve follow-ups)
     */
    public function remember(int $userId, string $question, string $answerSummary): void
    {
        $key = self::CACHE_PREFIX . $userId;
        $turns = Cache::get($key, []);

        $turns[] = [
            'question' => $question,
            'answer' => $answerSummary,
        ];

        // Keep only the last N turns.
        if (count($turns) > self::MAX_TURNS) {
            $turns = array_slice($turns, -self::MAX_TURNS);
        }

        Cache::put($key, $turns, now()->addMinutes(self::TTL_MINUTES));
    }

    /**
     * Retrieve recent conversation turns for context.
     *
     * @param  int  $userId
     * @return list<array{question: string, answer: string}>
     */
    public function recentTurns(int $userId): array
    {
        $key = self::CACHE_PREFIX . $userId;

        return Cache::get($key, []);
    }

    /**
     * Build a context block for the planner prompt.
     *
     * Returns an empty string when there is no memory, so callers can always
     * use it without a null check.
     *
     * @param  int  $userId
     * @return string
     */
    public function contextBlock(int $userId): string
    {
        $turns = $this->recentTurns($userId);

        if ($turns === []) {
            return '';
        }

        $lines = ["Recent conversation (for resolving follow-ups only — always query fresh data):"];

        foreach ($turns as $turn) {
            $lines[] = "Q: {$turn['question']}";
            $lines[] = "A: {$turn['answer']}";
        }

        return implode("\n", $lines);
    }

    /**
     * Build a brief summary of what the answer contained, for storage.
     *
     * This is NOT the full data — just enough context for the planner to
     * resolve follow-ups. For a table answer, it names the entity and
     * metric. For a prose answer, it's a one-line summary.
     *
     * @param  array<string, mixed>  $plan  the validated query plan
     * @param  list<array<string, mixed>>  $rows  the result rows
     * @return string
     */
    public static function summarizeAnswer(array $plan, array $rows): string
    {
        $entity = $plan['entity'] ?? 'unknown';
        $metric = implode(', ', $plan['metrics'] ?? []);
        $mode = $plan['mode'] ?? 'aggregate';
        $count = count($rows);

        if ($mode === 'list') {
            $columns = implode(', ', $plan['columns'] ?? []);
            return "Listed {$count} rows from {$entity} (columns: {$columns})";
        }

        if ($metric !== '') {
            return "Computed {$metric} from {$entity} ({$count} rows)";
        }

        return "Queried {$entity} ({$count} rows)";
    }

    /**
     * Clear memory for a user (e.g., on explicit reset or logout).
     *
     * @param  int  $userId
     */
    public function clear(int $userId): void
    {
        Cache::forget(self::CACHE_PREFIX . $userId);
    }
}
