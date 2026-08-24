<?php

namespace App\Services\Ai;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The one place a query is built.
 *
 * Everything runs through Eloquent so BelongsToOrganization's global scope is
 * applied structurally rather than remembered. Raw SQL would bypass it, which
 * would make a wrong query a cross-tenant leak rather than merely a wrong
 * answer — that is why the model plans and this class executes.
 */
class QueryPlanExecutor
{
    public function execute(array $plan): array
    {
        $entity = SemanticLayer::entity($plan['entity']);
        $metric = SemanticLayer::metric($plan['entity'], $plan['metric']);
        $dimension = $plan['group_by'] !== null
            ? SemanticLayer::dimension($plan['entity'], $plan['group_by'])
            : null;

        /** @var Builder $query */
        $query = $entity['model']::query();

        $this->applyEntityJoins($query, $plan['entity']);

        if ($dimension !== null && $dimension['join'] !== null) {
            [$table, $first, $operator, $second] = $dimension['join'];
            $query->leftJoin($table, $first, $operator, $second);
        }

        foreach ($metric['where'] as [$column, $operator, $value]) {
            $query->where($column, $operator, $value);
        }

        foreach ($plan['filters'] as $key => $value) {
            $filterDimension = SemanticLayer::dimension($plan['entity'], $key);
            $query->where($filterDimension['select'], '=', $value);
        }

        $aggregate = $this->aggregateExpression($metric);
        $columns = [];

        if ($dimension !== null) {
            // cast(... as text), not Postgres's `::text`. The app runs on
            // PostgreSQL but the whole suite runs on SQLite, which does not
            // parse `::` at all — and the cast is not optional either way: a
            // dimension over a date or a numeric column cannot be coalesced
            // with a string label without one.
            $query->select([
                DB::raw("coalesce(cast({$dimension['select']} as text), '{$dimension['null_label']}') as dimension"),
                DB::raw("{$aggregate} as metric"),
            ])->groupBy(DB::raw($dimension['select']));

            $columns[] = ['key' => $plan['group_by'], 'label' => $dimension['label'], 'type' => 'text'];
        } else {
            $query->select([DB::raw("{$aggregate} as metric")]);
        }

        $columns[] = ['key' => $plan['metric'], 'label' => $metric['label'], 'type' => $metric['type']];

        if ($plan['sort'] !== null) {
            $query->orderBy('metric', $plan['sort'] === 'metric_asc' ? 'asc' : 'desc');
        }

        // Fetch one more than asked so truncation is a fact, not a guess.
        $records = $query->limit($plan['limit'] + 1)->get();
        $truncated = $records->count() > $plan['limit'];
        $records = $records->take($plan['limit']);

        $rows = [];
        foreach ($records as $record) {
            $row = [];
            if ($dimension !== null) {
                $row[$plan['group_by']] = $record->dimension;
            }
            $row[$plan['metric']] = $record->metric;
            $rows[] = $row;
        }

        // An aggregate with no grouping returns one row even over zero records;
        // a null metric there means "nothing matched", which must not render as 0.
        if ($dimension === null && count($rows) === 1 && $rows[0][$plan['metric']] === null) {
            $rows = [];
        }

        $notes = [];
        if (! empty($metric['note'])) {
            $notes[] = $metric['note'];
        }

        return ['columns' => $columns, 'rows' => $rows, 'notes' => $notes, 'truncated' => $truncated];
    }

    /**
     * Entities whose dimensions live on a joined table need that join before
     * any dimension join is added.
     */
    private function applyEntityJoins(Builder $query, string $entityKey): void
    {
        if ($entityKey === 'employees') {
            $query->join('employee_work_infos', 'employee_work_infos.user_id', '=', 'users.id');
        }
    }

    private function aggregateExpression(array $metric): string
    {
        return match ($metric['aggregate']) {
            'count' => 'count(*)',
            'sum' => "sum({$metric['column']})",
            'avg' => "avg({$metric['column']})",
        };
    }
}
