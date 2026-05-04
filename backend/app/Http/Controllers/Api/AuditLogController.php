<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithApiResponses;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use Illuminate\Http\Request;

class AuditLogController extends Controller
{
    use InteractsWithApiResponses;

    public function index(Request $request)
    {
        $request->validate([
            'action' => 'nullable|string|max:120',
            'actor_user_id' => 'nullable|integer',
            'target_type' => 'nullable|string|max:120',
            'target_id' => 'nullable|integer',
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date',
            'per_page' => 'nullable|integer|min:1|max:10',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return $this->successResponse([
                'data' => [],
                'pagination' => null,
            ]);
        }

        $logs = AuditLog::query()
            ->with(['actor:id,name,email,role'])
            ->where('organization_id', $currentUser->organization_id)
            ->when($request->filled('action'), fn ($query) => $query->where('action', (string) $request->string('action')))
            ->when($request->filled('actor_user_id'), fn ($query) => $query->where('actor_user_id', (int) $request->integer('actor_user_id')))
            ->when($request->filled('target_type'), fn ($query) => $query->where('target_type', (string) $request->string('target_type')))
            ->when($request->filled('target_id'), fn ($query) => $query->where('target_id', (int) $request->integer('target_id')))
            ->when($request->filled('date_from'), fn ($query) => $query->whereDate('created_at', '>=', $request->date('date_from')))
            ->when($request->filled('date_to'), fn ($query) => $query->whereDate('created_at', '<=', $request->date('date_to')))
            ->orderByDesc('created_at')
            ->paginate((int) $request->integer('per_page', 10));

        return $this->successResponse([
            'data' => $logs->items(),
            'pagination' => [
                'current_page' => $logs->currentPage(),
                'last_page' => $logs->lastPage(),
                'per_page' => $logs->perPage(),
                'total' => $logs->total(),
            ],
        ]);
    }
}
