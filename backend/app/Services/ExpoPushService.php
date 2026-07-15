<?php

namespace App\Services;

use App\Models\DeviceToken;
use Illuminate\Support\Facades\Log;

class ExpoPushService
{
    private const PUSH_URL = 'https://exp.host/--/api/v2/push/send';
    private const MAX_BATCH = 100;

    public function sendToUsers(iterable $users, string $title, string $body, array $data = []): void
    {
        $userIds = is_array($users) ? $users : iterator_to_array($users);
        if (empty($userIds)) {
            Log::info('Expo push skipped: empty user ids');
            return;
        }

        Log::info('Expo push sending to users', ['user_ids' => $userIds, 'title' => $title]);

        $tokens = DeviceToken::whereIn('user_id', $userIds)->pluck('token')->all();
        if (empty($tokens)) {
            Log::info('Expo push skipped: no device tokens for users', ['user_ids' => $userIds]);
            return;
        }

        $messages = array_map(function (string $token) use ($title, $body, $data) {
            $msg = [
                'to' => $token,
                'sound' => 'default',
                'title' => $title,
                'body' => $body,
            ];
            if (!empty($data)) {
                $msg['data'] = $data;
            }
            return $msg;
        }, $tokens);

        foreach (array_chunk($messages, self::MAX_BATCH) as $chunk) {
            $this->sendBatch($chunk);
        }
    }

    private function sendBatch(array $messages): void
    {
        $json = json_encode($messages);
        if ($json === false) {
            Log::error('Expo push JSON encode failed');
            return;
        }

        try {
            $ch = curl_init(self::PUSH_URL);
            $options = [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $json,
                CURLOPT_HTTPHEADER => [
                    'Content-Type: application/json',
                    'Accept: application/json',
                    'Content-Length: ' . strlen($json),
                ],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 15,
                CURLOPT_CONNECTTIMEOUT => 5,
            ];

            // Only disable SSL verification for local Windows dev (curl CA bundle
            // issues) — never in production. Mirrors OAuthController's handling.
            if (app()->environment('local') && strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
                $options[CURLOPT_SSL_VERIFYPEER] = false;
                $options[CURLOPT_SSL_VERIFYHOST] = 0;
            }

            curl_setopt_array($ch, $options);

            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $error = curl_error($ch);

            if ($error) {
                Log::error('Expo push curl error', ['error' => $error]);
                return;
            }

            if ($httpCode < 200 || $httpCode >= 300) {
                Log::warning('Expo push HTTP error', [
                    'status' => $httpCode,
                    'body' => $response,
                ]);
                return;
            }

            Log::info('Expo push sent successfully', ['http' => $httpCode]);

            $body = json_decode($response, true);
            if (is_array($body)) {
                if (isset($body['errors'])) {
                    Log::warning('Expo push API errors', ['errors' => $body['errors']]);
                }
                $data = $body['data'] ?? [];
                foreach ($data as $i => $ticket) {
                    if (($ticket['status'] ?? '') === 'error') {
                        Log::warning('Expo push ticket error', [
                            'index' => $i,
                            'message' => $ticket['message'] ?? 'unknown',
                            'details' => $ticket['details'] ?? null,
                        ]);
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::error('Expo push exception', ['message' => $e->getMessage()]);
        }
    }
}
