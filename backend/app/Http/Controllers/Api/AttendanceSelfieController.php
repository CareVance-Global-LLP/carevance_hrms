<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceSelfie;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Throwable;

class AttendanceSelfieController extends Controller
{
    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'image' => 'required|string',
            'latitude' => 'nullable|numeric|between:-90,90',
            'longitude' => 'nullable|numeric|between:-180,180',
            'accuracy' => 'nullable|numeric|min:0',
        ]);

        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $today = now()->toDateString();

        $existing = AttendanceSelfie::where('user_id', $user->id)
            ->whereDate('attendance_date', $today)
            ->first();

        if ($existing) {
            return response()->json([
                'message' => 'Selfie already uploaded today',
                'selfie' => [
                    'id' => $existing->id,
                    'image_url' => $existing->image_url,
                    'created_at' => $existing->created_at,
                ],
            ]);
        }

        $imageData = $request->image;
        if (preg_match('/^data:image\/(\w+);base64,/', $imageData, $matches)) {
            $extension = $matches[1] === 'jpeg' ? 'jpg' : $matches[1];
            $imageData = substr($imageData, strpos($imageData, ',') + 1);
        } else {
            return response()->json(['message' => 'Invalid image format'], 422);
        }

        $imageData = base64_decode($imageData);
        if ($imageData === false) {
            return response()->json(['message' => 'Invalid image data'], 422);
        }

        $maxSize = 5 * 1024 * 1024;
        if (strlen($imageData) > $maxSize) {
            return response()->json(['message' => 'Image too large (max 5MB)'], 422);
        }

        $filename = sprintf('selfies/%d/%s-%s.%s', $user->id, $today, now()->format('His'), $extension);
        Storage::disk('public')->put($filename, $imageData);

        $selfie = AttendanceSelfie::create([
            'user_id' => $user->id,
            'attendance_date' => $today,
            'image_path' => $filename,
            'latitude' => $request->filled('latitude') ? (float) $request->latitude : null,
            'longitude' => $request->filled('longitude') ? (float) $request->longitude : null,
            'accuracy_meters' => $request->filled('accuracy') ? (int) $request->accuracy : null,
        ]);

        return response()->json([
            'message' => 'Selfie uploaded',
            'selfie' => [
                'id' => $selfie->id,
                'image_url' => $selfie->image_url,
                'created_at' => $selfie->created_at,
            ],
        ], 201);
    }

    public function todayStatus(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['uploaded' => false]);
        }

        $selfie = AttendanceSelfie::where('user_id', $user->id)
            ->whereDate('attendance_date', now()->toDateString())
            ->first();

        if (!$selfie) {
            return response()->json(['uploaded' => false]);
        }

        return response()->json([
            'uploaded' => true,
            'selfie' => [
                'id' => $selfie->id,
                'image_url' => $selfie->image_url,
                'created_at' => $selfie->created_at,
            ],
        ]);
    }

    public function mapData(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['data' => []]);
        }

        $startDate = $request->get('start_date', now()->startOfMonth()->toDateString());
        $endDate = $request->get('end_date', now()->toDateString());

        $query = AttendanceSelfie::with('user:id,name,email')
            ->whereHas('user', function ($q) use ($user) {
                $q->where('organization_id', $user->organization_id);
            })
            ->whereBetween('attendance_date', [$startDate, $endDate]);

        if ($request->filled('user_id')) {
            $query->where('user_id', (int) $request->user_id);
        }

        $selfies = $query->orderByDesc('attendance_date')
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (AttendanceSelfie $s) => [
                'id' => $s->id,
                'user' => $s->user ? ['id' => $s->user->id, 'name' => $s->user->name] : null,
                'image_url' => $s->image_url,
                'latitude' => $s->latitude,
                'longitude' => $s->longitude,
                'accuracy_meters' => $s->accuracy_meters,
                'attendance_date' => Carbon::parse($s->attendance_date)->toDateString(),
                'created_at' => $s->created_at,
            ]);

        return response()->json(['data' => $selfies]);
    }
}
