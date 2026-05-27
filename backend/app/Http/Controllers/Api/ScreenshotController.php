<?php

namespace App\Http\Controllers\Api;

use Closure;
use App\Http\Controllers\Controller;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Audit\AuditLogService;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Throwable;

class ScreenshotController extends Controller
{
    private const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    private const MAX_DATA_URL_CHARS = 14 * 1024 * 1024;

    public function __construct(private readonly AuditLogService $auditLogService)
    {
    }

    private function canViewAll(?User $user): bool
    {
        return $user && $user->getHierarchyLevel() < 100;
    }

    private function canDeleteScreenshots(?User $user): bool
    {
        return $user?->getHierarchyLevel() <= 10;
    }

    private function restrictMonitoringToEmployees(?User $user): bool
    {
        $level = $user?->getHierarchyLevel() ?? 999;
        return $level > 10 && $level < 100;
    }

    private function managerGroupIds(User $user): array
    {
        return $user->groups()
            ->pluck('groups.id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        try {
            $user = $request->user();
            if (!$user) {
                return response()->json(['data' => []]);
            }

            // Limit per_page to prevent memory issues
            $perPage = max(1, min((int) $request->get('per_page', 10), 50));
            
            // Add max date range to prevent loading too much data
            $startDate = $request->filled('start_date')
                ? Carbon::parse((string) $request->start_date)->startOfDay()
                : now()->subDays(30)->startOfDay(); // Default to last 30 days
            $endDate = $request->filled('end_date')
                ? Carbon::parse((string) $request->end_date)->endOfDay()
                : now()->endOfDay();
                
            // Limit date range to 90 days max
            if ($startDate->diffInDays($endDate) > 90) {
                $startDate = $endDate->copy()->subDays(90);
            }

            $screenshots = $this->scopedScreenshotsQuery($request, $user, $startDate, $endDate)
                ->orderBy('created_at', 'desc')
                ->paginate($perPage);

            return response()->json($screenshots);
        } catch (Throwable $e) {
            Log::error('Screenshot index error', [
                'error' => $e->getMessage(),
                'user_id' => $request->user()?->id,
                'trace' => $e->getTraceAsString()
            ]);
            return response()->json([
                'data' => [],
                'message' => 'Failed to load screenshots',
                'error' => 'Server error'
            ], 500);
        }
    }

    public function bulkDestroy(Request $request)
    {
        try {
            $validated = $request->validate([
                'screenshot_ids' => 'nullable|array',
                'screenshot_ids.*' => 'integer',
                'user_id' => 'nullable|integer',
                'time_entry_id' => 'nullable|integer',
                'start_date' => 'nullable|date',
                'end_date' => 'nullable|date',
                'delete_all_in_range' => 'nullable|boolean',
            ]);

            $user = $request->user();
            if (!$user) {
                return response()->json(['message' => 'Unauthenticated.'], 401);
            }
            if (!$this->canDeleteScreenshots($user)) {
                return response()->json(['message' => 'Forbidden'], 403);
            }

            $selectedIds = collect($validated['screenshot_ids'] ?? [])
                ->map(fn ($id) => (int) $id)
                ->filter(fn ($id) => $id > 0)
                ->unique()
                ->values();
            $deleteAllInRange = (bool) ($validated['delete_all_in_range'] ?? false);

            if ($selectedIds->isEmpty() && !$deleteAllInRange) {
                return response()->json(['message' => 'Select screenshots to delete or request range deletion.'], 422);
            }

            if ($deleteAllInRange && !$request->filled('user_id') && !$request->filled('time_entry_id') && !$request->filled('start_date') && !$request->filled('end_date')) {
                return response()->json(['message' => 'Range deletion requires at least one filter.'], 422);
            }

            $query = $this->scopedScreenshotsQuery($request, $user)->orderBy('created_at', 'desc');

            if ($selectedIds->isNotEmpty()) {
                $query->whereIn('id', $selectedIds);
            }

            $screenshots = $query->limit(1000)->get(); // Limit bulk delete to 1000 records
            if ($screenshots->isEmpty()) {
                return response()->json([
                    'message' => 'No screenshots matched the deletion request.',
                    'deleted_count' => 0,
                ]);
            }

            $deletedIds = [];
            $deletedUserIds = [];

            foreach ($screenshots as $screenshot) {
                $screenshot->loadMissing('timeEntry.user');
                $deletedIds[] = (int) $screenshot->id;
                if ($screenshot->timeEntry?->user_id) {
                    $deletedUserIds[] = (int) $screenshot->timeEntry->user_id;
                }

                Storage::disk('screenshots')->delete(basename((string) $screenshot->filename));
                $screenshot->delete();
            }

            $this->auditLogService->log(
                action: 'screenshot.bulk_deleted',
                actor: $user,
                target: 'Screenshot',
                metadata: [
                    'deleted_count' => count($deletedIds),
                    'screenshot_ids' => $deletedIds,
                    'user_ids' => array_values(array_unique($deletedUserIds)),
                    'delete_all_in_range' => $deleteAllInRange,
                    'filters' => [
                        'user_id' => $validated['user_id'] ?? null,
                        'time_entry_id' => $validated['time_entry_id'] ?? null,
                        'start_date' => $validated['start_date'] ?? null,
                        'end_date' => $validated['end_date'] ?? null,
                    ],
                ],
                request: $request
            );

            return response()->json([
                'message' => count($deletedIds) === 1 ? 'Screenshot deleted successfully.' : 'Screenshots deleted successfully.',
                'deleted_count' => count($deletedIds),
            ]);
        } catch (Throwable $e) {
            Log::error('Screenshot bulk delete error', ['error' => $e->getMessage()]);
            return response()->json(['message' => 'Failed to delete screenshots', 'error' => 'Server error'], 500);
        }
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        try {
            $validated = $request->validate([
                'time_entry_id' => 'required|exists:time_entries,id',
                'image' => [
                    'nullable',
                    'file',
                    'max:10240',
                    function (string $attribute, mixed $value, Closure $fail): void {
                        if (! $value instanceof UploadedFile) {
                            return;
                        }

                        $clientMime = strtolower((string) $value->getClientMimeType());
                        $serverMime = strtolower((string) $value->getMimeType());
                        $clientExtension = strtolower((string) $value->getClientOriginalExtension());
                        $allowedExtensions = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'];

                        $looksLikeImage = Str::startsWith($clientMime, 'image/')
                            || Str::startsWith($serverMime, 'image/')
                            || in_array($clientExtension, $allowedExtensions, true);

                        if (! $looksLikeImage) {
                            $fail('The image field must be an image.');
                        }
                    },
                ],
                'image_data_url' => 'nullable|string|max:'.self::MAX_DATA_URL_CHARS,
                'filename' => 'nullable|string|max:255',
                'thumbnail' => 'nullable|string|max:65535',
                'blurred' => 'nullable|boolean',
            ]);

            $user = $request->user();
            if (!$user) {
                return response()->json(['message' => 'Unauthenticated.'], 401);
            }
            $timeEntry = TimeEntry::with('user')->find($validated['time_entry_id']);
            if (!$timeEntry || !$timeEntry->user || $timeEntry->user->organization_id !== $user->organization_id) {
                return response()->json(['message' => 'Forbidden'], 403);
            }
            if (!$this->canViewAll($user) && $timeEntry->user_id !== $user->id) {
                return response()->json(['message' => 'Forbidden'], 403);
            }

            $filename = $validated['filename'] ?? null;
            if ($request->hasFile('image')) {
                $uploadedImage = $request->file('image');

                Log::info('Screenshot upload received.', [
                    'time_entry_id' => (int) $validated['time_entry_id'],
                    'user_id' => (int) $user->id,
                    'client_mime_type' => $uploadedImage?->getClientMimeType(),
                    'server_mime_type' => $uploadedImage?->getMimeType(),
                    'client_extension' => $uploadedImage?->getClientOriginalExtension(),
                    'file_size_bytes' => $uploadedImage?->getSize(),
                ]);

                $path = $uploadedImage->store('', 'screenshots');
                $filename = basename($path);
            } elseif (! empty($validated['image_data_url'])) {
                $decodedImage = $this->decodeImageDataUrl((string) $validated['image_data_url']);

                if (! $decodedImage) {
                    return response()->json(['message' => 'Screenshot image data is invalid.'], 422);
                }

                $extension = $decodedImage['extension'];
                $storedFilename = $filename
                    ? pathinfo($filename, PATHINFO_FILENAME).'.'.$extension
                    : (string) Str::uuid().'.'.$extension;

                Log::info('Screenshot upload received.', [
                    'time_entry_id' => (int) $validated['time_entry_id'],
                    'user_id' => (int) $user->id,
                    'client_mime_type' => $decodedImage['mime_type'],
                    'server_mime_type' => $decodedImage['mime_type'],
                    'client_extension' => $extension,
                    'file_size_bytes' => strlen($decodedImage['binary']),
                    'source' => 'data_url',
                ]);

                Storage::disk('screenshots')->put($storedFilename, $decodedImage['binary']);
                $filename = $storedFilename;
            }

            $filename = $filename ? basename($filename) : null;

            if (!$filename) {
                return response()->json(['message' => 'Screenshot image or filename is required.'], 422);
            }

            $screenshot = Screenshot::create([
                'time_entry_id' => $validated['time_entry_id'],
                'filename' => $filename,
                'thumbnail' => $validated['thumbnail'] ?? null,
                'blurred' => (bool)($validated['blurred'] ?? false),
            ]);

            $screenshot->loadMissing('timeEntry.user');

            Log::info('Screenshot uploaded successfully.', [
                'screenshot_id' => (int) $screenshot->id,
                'time_entry_id' => (int) $screenshot->time_entry_id,
                'user_id' => (int) $timeEntry->user_id,
                'organization_id' => (int) $timeEntry->user->organization_id,
                'filename' => $filename,
                'mime_type' => $request->file('image')?->getMimeType(),
                'file_size_bytes' => $request->file('image')?->getSize(),
                'blurred' => (bool) ($validated['blurred'] ?? false),
                'recorded_at' => $screenshot->created_at?->toIso8601String(),
            ]);

            return response()->json($screenshot, 201);
        } catch (Throwable $e) {
            Log::error('Screenshot store error', ['error' => $e->getMessage(), 'user_id' => $request->user()?->id]);
            return response()->json(['message' => 'Failed to save screenshot', 'error' => 'Server error'], 500);
        }
    }

    private function decodeImageDataUrl(string $dataUrl): ?array
    {
        if (strlen($dataUrl) > self::MAX_DATA_URL_CHARS) {
            return null;
        }

        $separatorPosition = strpos($dataUrl, ',');
        if ($separatorPosition === false) {
            return null;
        }

        $metadata = substr($dataUrl, 0, $separatorPosition);
        if (! preg_match('/^data:(image\/[a-zA-Z0-9.+-]+);base64$/', $metadata, $matches)) {
            return null;
        }

        $mimeType = strtolower($matches[1]);
        $rawPayloadLength = strlen($dataUrl) - $separatorPosition - 1;
        if ($rawPayloadLength <= 0) {
            return null;
        }

        $rawPaddingBytes = substr_count(substr($dataUrl, -2), '=');
        $rawEstimatedBytes = (int) floor(($rawPayloadLength * 3) / 4) - $rawPaddingBytes;
        if ($rawEstimatedBytes > self::MAX_IMAGE_BYTES) {
            return null;
        }

        $rawPayload = substr($dataUrl, $separatorPosition + 1);
        $encodedPayload = preg_replace('/\s+/', '', $rawPayload);
        if (! is_string($encodedPayload) || $encodedPayload === '') {
            return null;
        }

        $paddingBytes = substr_count(substr($encodedPayload, -2), '=');
        $estimatedBytes = (int) floor((strlen($encodedPayload) * 3) / 4) - $paddingBytes;
        if ($estimatedBytes > self::MAX_IMAGE_BYTES) {
            return null;
        }

        $binary = base64_decode($encodedPayload, true);
        if ($binary === false || $binary === '') {
            return null;
        }

        if (strlen($binary) > self::MAX_IMAGE_BYTES) {
            return null;
        }

        $extension = match ($mimeType) {
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/gif' => 'gif',
            'image/bmp' => 'bmp',
            'image/webp' => 'webp',
            default => null,
        };

        if (! $extension) {
            return null;
        }

        return [
            'mime_type' => $mimeType,
            'extension' => $extension,
            'binary' => $binary,
        ];
    }

    public function file(Request $request, Screenshot $screenshot): BinaryFileResponse|\Illuminate\Http\JsonResponse
    {
        try {
            $path = basename((string) $screenshot->filename);

            if ($path === '' || !Storage::disk('screenshots')->exists($path)) {
                return response()->json(['message' => 'Screenshot not found'], 404);
            }

            $extension = pathinfo($path, PATHINFO_EXTENSION);
            $downloadName = Str::slug(pathinfo($path, PATHINFO_FILENAME) ?: 'screenshot').($extension ? '.'.$extension : '');

            return response()->file(Storage::disk('screenshots')->path($path), [
                'Content-Type' => Storage::disk('screenshots')->mimeType($path) ?: 'image/png',
                'Content-Disposition' => 'inline; filename="'.$downloadName.'"',
                'Cache-Control' => 'private, max-age=300',
                'X-Content-Type-Options' => 'nosniff',
            ]);
        } catch (Throwable $e) {
            Log::error('Screenshot file error', ['error' => $e->getMessage(), 'screenshot_id' => $screenshot->id]);
            return response()->json(['message' => 'Failed to load screenshot', 'error' => 'Server error'], 500);
        }
    }

    /**
     * Display the specified resource.
     */
    public function show(Screenshot $screenshot)
    {
        try {
            if (!$this->canAccessScreenshot($screenshot)) {
                return response()->json(['message' => 'Forbidden'], 403);
            }

            $screenshot->loadMissing('timeEntry.user');

            return response()->json($screenshot);
        } catch (Throwable $e) {
            Log::error('Screenshot show error', ['error' => $e->getMessage()]);
            return response()->json(['message' => 'Failed to load screenshot', 'error' => 'Server error'], 500);
        }
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, Screenshot $screenshot)
    {
        try {
            if (!$this->canAccessScreenshot($screenshot)) {
                return response()->json(['message' => 'Forbidden'], 403);
            }

            $validated = $request->validate([
                'thumbnail' => 'nullable|string',
                'blurred' => 'nullable|boolean',
            ]);

            $screenshot->update($validated);
            $screenshot->loadMissing('timeEntry.user');

            return response()->json($screenshot);
        } catch (Throwable $e) {
            Log::error('Screenshot update error', ['error' => $e->getMessage()]);
            return response()->json(['message' => 'Failed to update screenshot', 'error' => 'Server error'], 500);
        }
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Screenshot $screenshot)
    {
        try {
            if (!$this->canDeleteScreenshots(request()->user())) {
                return response()->json(['message' => 'Forbidden'], 403);
            }

            if (!$this->canAccessScreenshot($screenshot)) {
                return response()->json(['message' => 'Forbidden'], 403);
            }

            $screenshot->loadMissing('timeEntry.user');
            $this->auditLogService->log(
                action: 'screenshot.deleted',
                actor: request()->user(),
                target: $screenshot,
                metadata: [
                    'time_entry_id' => $screenshot->time_entry_id,
                    'user_id' => $screenshot->timeEntry?->user_id,
                    'recorded_at' => (string) $screenshot->created_at,
                ],
                request: request()
            );

            Storage::disk('screenshots')->delete(basename((string) $screenshot->filename));
            $screenshot->delete();

            return response()->json(['message' => 'Screenshot deleted successfully']);
        } catch (Throwable $e) {
            Log::error('Screenshot delete error', ['error' => $e->getMessage()]);
            return response()->json(['message' => 'Failed to delete screenshot', 'error' => 'Server error'], 500);
        }
    }

    private function canAccessScreenshot(Screenshot $screenshot): bool
    {
        $user = request()->user();
        if (!$user) {
            return false;
        }

        $screenshot->loadMissing('timeEntry.user');
        if (!$screenshot->timeEntry || !$screenshot->timeEntry->user) {
            return false;
        }
        if (!$this->canMonitorUser($user, $screenshot->timeEntry->user)) {
            return false;
        }
        if ($this->canViewAll($user)) {
            return true;
        }
        return $screenshot->timeEntry->user_id === $user->id;
    }

    private function canMonitorUser(User $viewer, User $subject): bool
    {
        if ((int) $viewer->organization_id !== (int) $subject->organization_id) {
            return false;
        }

        $viewerLevel = $viewer->getHierarchyLevel();
        $subjectLevel = $subject->getHierarchyLevel();

        if ($viewerLevel <= 10) {
            return true;
        }

        if ($viewerLevel < 100) {
            if ($subjectLevel <= $viewerLevel) {
                return false;
            }

            $visibleGroupIds = $this->managerGroupIds($viewer);
            if (empty($visibleGroupIds)) {
                return false;
            }

            return $subject->groups()
                ->whereIn('groups.id', $visibleGroupIds)
                ->exists();
        }

        return (int) $viewer->id === (int) $subject->id;
    }

    private function scopedScreenshotsQuery(Request $request, User $user, ?Carbon $startDate = null, ?Carbon $endDate = null): Builder
    {
        if (!$startDate) {
            $startDate = $request->filled('start_date')
                ? Carbon::parse((string) $request->start_date)->startOfDay()
                : null;
        }
        if (!$endDate) {
            $endDate = $request->filled('end_date')
                ? Carbon::parse((string) $request->end_date)->endOfDay()
                : null;
        }

        return Screenshot::query()
            ->select(['id', 'time_entry_id', 'filename', 'thumbnail', 'blurred', 'created_at'])
            ->with(['timeEntry.user:id,name,email,role'])
            ->whereHas('timeEntry.user', function ($query) use ($user) {
                $query->where('organization_id', $user->organization_id);
                if ($this->restrictMonitoringToEmployees($user)) {
                    $visibleGroupIds = $this->managerGroupIds($user);
                    $userLevel = $user->getHierarchyLevel();
                    if (empty($visibleGroupIds)) {
                        $query->whereRaw('1 = 0');
                        return;
                    }

                    $query->where(function ($q) use ($userLevel) {
                            $q->whereHas('customRole', fn ($q2) => $q2->where('hierarchy_level', '>', $userLevel))
                                ->orWhere(fn ($q2) => $q2->whereNull('role_id')
                                    ->whereRaw("CASE role WHEN 'admin' THEN 10 WHEN 'manager' THEN 50 WHEN 'employee' THEN 100 ELSE 999 END > ?", [$userLevel]));
                        })
                        ->whereHas('groups', fn ($groupQuery) => $groupQuery->whereIn('groups.id', $visibleGroupIds));
                }
            })
            ->when(!$this->canViewAll($user), function ($query) use ($user) {
                $query->whereHas('timeEntry', function ($timeEntryQuery) use ($user) {
                    $timeEntryQuery->where('user_id', $user->id);
                });
            })
            ->when($this->canViewAll($user) && $request->filled('user_id'), function ($query) use ($request) {
                $userId = (int) $request->user_id;
                $query->whereHas('timeEntry', function ($timeEntryQuery) use ($userId) {
                    $timeEntryQuery->where('user_id', $userId);
                });
            })
            ->when($request->filled('time_entry_id'), function ($query) use ($request) {
                $query->where('time_entry_id', (int) $request->time_entry_id);
            })
            ->when($startDate, function ($query) use ($startDate) {
                $query->where('created_at', '>=', $startDate);
            })
            ->when($endDate, function ($query) use ($endDate) {
                $query->where('created_at', '<=', $endDate);
            });
    }
}
