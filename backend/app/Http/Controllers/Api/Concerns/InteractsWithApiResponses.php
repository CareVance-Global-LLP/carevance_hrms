<?php

namespace App\Http\Controllers\Api\Concerns;

use Illuminate\Contracts\Support\Arrayable;
use Illuminate\Http\JsonResponse;

trait InteractsWithApiResponses
{
    protected function successResponse(mixed $payload = [], ?string $message = null, int $status = 200): JsonResponse
    {
        if ($payload instanceof Arrayable) {
            $payload = $payload->toArray();
        }

        if (is_array($payload) && array_is_list($payload)) {
            return response()->json($payload, $status);
        }

        if (!is_array($payload)) {
            $payload = ['data' => $payload];
        }

        return response()->json(array_merge([
            'success' => true,
        ], $message !== null ? ['message' => $message] : [], $payload), $status);
    }

    protected function createdResponse(mixed $payload = [], ?string $message = 'Created successfully.'): JsonResponse
    {
        return $this->successResponse($payload, $message, 201);
    }

    protected function updatedResponse(mixed $payload = [], ?string $message = 'Updated successfully.'): JsonResponse
    {
        return $this->successResponse($payload, $message);
    }

    protected function deletedResponse(?string $message = 'Deleted successfully.', array $payload = []): JsonResponse
    {
        return $this->successResponse($payload, $message);
    }

    protected function errorResponse(string $message, int $status = 400): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => $message,
        ], $status);
    }
}
