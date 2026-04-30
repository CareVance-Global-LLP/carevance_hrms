<?php

return [
    'frontend_url' => rtrim((string) env('FRONTEND_APP_URL', env('FRONTEND_URL', env('APP_URL', 'http://localhost:5173'))), '/'),

    'trial_days' => (int) env('SAAS_TRIAL_DAYS', 14),

    'default_plan' => (string) env('SAAS_DEFAULT_PLAN', 'starter'),

    'default_billing_cycle' => (string) env('SAAS_DEFAULT_BILLING_CYCLE', 'monthly'),

    'invitation_expiration_hours' => (int) env('INVITATION_EXPIRATION_HOURS', 72),

    'manager_can_invite_employees' => filter_var(
        env('MANAGER_CAN_INVITE_EMPLOYEES', true),
        FILTER_VALIDATE_BOOL
    ),

    'sales_email' => (string) env('SALES_CONTACT_EMAIL', 'sales@carevance.example'),

    'support_email' => (string) env('SUPPORT_CONTACT_EMAIL', 'support@carevance.example'),

    'auth' => [
        'email_verification_expire_minutes' => (int) env('AUTH_EMAIL_VERIFICATION_EXPIRE_MINUTES', 1440),
        'api_auth_cookie' => [
            'name' => (string) env('API_AUTH_COOKIE_NAME', 'carevance_api_token'),
            'minutes' => (int) env('API_AUTH_COOKIE_MINUTES', (int) env('AUTH_API_TOKEN_TTL_MINUTES', 10080)),
            'session_token_minutes' => (int) env('API_AUTH_SESSION_TOKEN_TTL_MINUTES', 720),
            'path' => (string) env('API_AUTH_COOKIE_PATH', '/'),
            'domain' => env('API_AUTH_COOKIE_DOMAIN'),
            'secure' => filter_var(
                env('API_AUTH_COOKIE_SECURE', env('APP_ENV', 'production') === 'production'),
                FILTER_VALIDATE_BOOL
            ),
            'same_site' => (string) env(
                'API_AUTH_COOKIE_SAME_SITE',
                env('APP_ENV', 'production') === 'production' ? 'none' : 'lax'
            ),
        ],
    ],

    'oauth' => [
        'google' => [
            'enabled' => filter_var(env('GOOGLE_OAUTH_ENABLED', false), FILTER_VALIDATE_BOOL),
        ],
    ],

    'plans' => [
        'starter' => [
            'label' => 'Starter',
            'description' => 'For smaller teams rolling out structured HR and operations workflows.',
            'trial_available' => true,
            'contact_sales_only' => false,
        ],
        'growth' => [
            'label' => 'Growth',
            'description' => 'For scaling teams that need stronger reporting, approvals, and controls.',
            'trial_available' => true,
            'contact_sales_only' => false,
        ],
        'enterprise' => [
            'label' => 'Enterprise',
            'description' => 'For larger organizations that want custom rollout, controls, and support.',
            'trial_available' => false,
            'contact_sales_only' => true,
        ],
    ],
];
