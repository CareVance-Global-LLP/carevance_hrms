<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'stripe' => [
        'secret' => env('STRIPE_SECRET_KEY'),
        'webhook_secret' => env('STRIPE_WEBHOOK_SECRET'),
    ],

    'razorpay' => [
        'key_id' => env('RAZORPAY_KEY_ID'),
        'key_secret' => env('RAZORPAY_KEY_SECRET'),
        'webhook_secret' => env('RAZORPAY_WEBHOOK_SECRET'),
    ],

    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect' => env('GOOGLE_REDIRECT_URI'),
    ],

    'desktop' => [
        'windows_download_url' => env('DESKTOP_WINDOWS_DOWNLOAD_URL'),
    ],

    'ai' => [
        'base_url' => env('AI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai'),
        'api_key' => env('AI_API_KEY'),
        'model' => env('AI_MODEL', 'gemini-flash-latest'),
        'fallback_models' => env('AI_FALLBACK_MODELS', 'gemini-flash-lite-latest'),
        'site_url' => env('AI_SITE_URL', 'https://carevance.com'),
        'app_name' => env('AI_APP_NAME', 'CareVance HRMS'),
        // Overall time budget (seconds) across all provider/model attempts for one chat request.
        'total_timeout' => env('AI_TOTAL_TIMEOUT', 24),

        // Optional secondary/backup provider (tried if the primary provider fails)
        'secondary_base_url' => env('AI_SECONDARY_BASE_URL', 'https://openrouter.ai/api/v1'),
        'secondary_api_key' => env('AI_SECONDARY_API_KEY'),
        'secondary_models' => env('AI_SECONDARY_MODELS', 'nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-31b-it:free'),
    ],
];
