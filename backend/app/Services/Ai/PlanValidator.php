<?php

namespace App\Services\Ai;

/**
 * Everything the model returns is untrusted input. Nothing reaches the query
 * builder without being matched against SemanticLayer by exact key — no fuzzy
 * matching, no nearest neighbour, no defaults that quietly substitute a
 * different number than the one asked for.
 */
class PlanValidator
{
    private const MAX_LIMIT = 500;
    private const DEFAULT_LIMIT = 20;

    public function validate(array $plan): array
    {
        if (isset($plan['error']) && is_string($plan['error'])) {
            throw new UnsupportedQuestionException($plan['error']);
        }

        $entityKey = is_string($plan['entity'] ?? null) ? $plan['entity'] : '';
        $entity = SemanticLayer::entity($entityKey);

        if ($entity === null) {
            throw new UnsupportedQuestionException(
                sprintf("There is no '%s' data in this system.", $entityKey !== '' ? $entityKey : 'unknown')
            );
        }

        $metricKey = is_string($plan['metric'] ?? null) ? $plan['metric'] : '';

        if (SemanticLayer::metric($entityKey, $metricKey) === null) {
            throw new UnsupportedQuestionException(
                sprintf("'%s' is not something that can be measured on %s.", $metricKey !== '' ? $metricKey : 'unknown', $entityKey)
            );
        }

        $groupBy = is_string($plan['group_by'] ?? null) && $plan['group_by'] !== '' ? $plan['group_by'] : null;

        if ($groupBy !== null && SemanticLayer::dimension($entityKey, $groupBy) === null) {
            throw new UnsupportedQuestionException(
                sprintf("%s cannot be grouped by '%s'.", $entityKey, $groupBy)
            );
        }

        $filters = is_array($plan['filters'] ?? null) ? $plan['filters'] : [];

        foreach (array_keys($filters) as $filterKey) {
            if (! is_string($filterKey) || SemanticLayer::dimension($entityKey, $filterKey) === null) {
                throw new UnsupportedQuestionException(
                    sprintf("'%s' is not a field that can be filtered on %s.", (string) $filterKey, $entityKey)
                );
            }
        }

        $sort = in_array($plan['sort'] ?? null, ['metric_asc', 'metric_desc'], true) ? $plan['sort'] : null;

        /*
         * A model that omits the limit sends null; one that means "no limit"
         * sends 0. `??` only catches the first, so 0 fell through and clamped
         * to 1 — "headcount by department" came back as a single arbitrary row
         * and read like the org had one department. Both mean "use the
         * default", and only a positive number is a real limit.
         */
        $requested = (int) ($plan['limit'] ?? 0);
        $limit = $requested > 0 ? min(self::MAX_LIMIT, $requested) : self::DEFAULT_LIMIT;

        return [
            'entity' => $entityKey,
            'metric' => $metricKey,
            'group_by' => $groupBy,
            'filters' => $filters,
            'sort' => $sort,
            'limit' => $limit,
        ];
    }
}
