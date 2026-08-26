<?php

return [
    'frontend_url' => rtrim((string) env('FRONTEND_APP_URL', env('FRONTEND_URL', env('APP_URL', 'http://localhost:5173'))), '/'),

    'trial_days' => (int) env('SAAS_TRIAL_DAYS', 14),

    'default_plan' => (string) env('SAAS_DEFAULT_PLAN', 'basic_tracking'),

    'default_billing_cycle' => (string) env('SAAS_DEFAULT_BILLING_CYCLE', 'monthly'),

    'invitation_expiration_hours' => (int) env('INVITATION_EXPIRATION_HOURS', 72),

    'manager_can_invite_employees' => filter_var(
        env('MANAGER_CAN_INVITE_EMPLOYEES', true),
        FILTER_VALIDATE_BOOL
    ),

    'sales_email' => (string) env('SALES_CONTACT_EMAIL', 'aayushborwal.carevanceglobal@gmail.com'),

    // NOTE: .env.example line 129 spells this "mavliribaz" while this default
    // and the working local .env both spell it "mavliirbaz". One of the two is
    // a transposition and nobody can tell which from the repo alone — left
    // matching the value that is actually in use until someone confirms.
    'support_email' => (string) env('SUPPORT_CONTACT_EMAIL', 'mavliirbaz.carevanceglobal@gmail.com'),

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

    // `min_seats` is the lowest cap a workspace on the plan may REDUCE to, and
    // is read by SeatGuard::minimumAllowedSeats(). It was absent from every
    // plan, so that method fell through to invented defaults of 50 (payroll)
    // and 10 (tracking) written inside the class — a floor nobody could find
    // by reading this file. The values below are those defaults, unchanged, so
    // nothing a customer can do costs a different amount today.
    //
    // TWO THINGS HERE STILL NEED A HUMAN, and neither is safe to guess at:
    //
    //  - BillingController::upgradePlan floors a *purchase* at a hardcoded 5
    //    (converting trial) or 10 (paid), which is not this number. Since an
    //    upgrade can no longer lower a cap, the two now govern different acts
    //    — the least you may buy, and the least you may shrink to — but 50 and
    //    10 disagreeing on the same payroll plan is still a pricing decision
    //    somebody has to make deliberately.
    //  - `max_seats: 50` plus `extra_seat_price` on the payroll plans reads as
    //    a bundle (₹3999 for up to 50 people, then ₹79 each), while every code
    //    path prices `monthly_price × seats`. `extra_seat_price` has no reader
    //    at all. One of the two is wrong and it is worth real money.
    'plans' => [
        // Tracking Plans
        'basic_tracking' => [
            'label' => 'Basic Tracking',
            'description' => 'Essential time tracking and HR features for growing teams.',
            'monthly_price' => 399,
            'yearly_price' => 359,
            'trial_available' => true,
            'contact_sales_only' => false,
            'max_seats' => -1, // Unlimited
            'min_seats' => 10,
            'type' => 'tracking',
        ],
        'advance_tracking' => [
            'label' => 'Advance Tracking',
            'description' => 'Full tracking with screenshots, automation, and advanced productivity features.',
            'monthly_price' => 599,
            'yearly_price' => 539,
            'trial_available' => false,
            'contact_sales_only' => false,
            'max_seats' => -1, // Unlimited
            'min_seats' => 10,
            'type' => 'tracking',
        ],
        
        // Payroll Plans
        'basic_payroll' => [
            'label' => 'Basic Payroll',
            'description' => 'Complete HR + Payroll automation with compliance for teams.',
            'monthly_price' => 3999,
            'yearly_price' => 43189, // 10% discount
            'trial_available' => true,
            'contact_sales_only' => false,
            'max_seats' => 50,
            'extra_seat_price' => 79,
            'min_seats' => 50,
            'type' => 'payroll',
        ],
        'professional_payroll' => [
            'label' => 'Professional Payroll',
            'description' => 'Full suite with advanced HRMS, analytics, and dedicated support.',
            'monthly_price' => 5999,
            'yearly_price' => 64789, // 10% discount
            'trial_available' => false,
            'contact_sales_only' => false,
            'max_seats' => 50,
            'extra_seat_price' => 119,
            'min_seats' => 50,
            'type' => 'payroll',
        ],
        
        // Enterprise
        'enterprise' => [
            'label' => 'Enterprise',
            'description' => 'Custom solution with dedicated support, SLA, and white-label options.',
            'monthly_price' => 0,
            'yearly_price' => 0,
            'trial_available' => false,
            'contact_sales_only' => true,
            'max_seats' => -1, // Unlimited
            // `type: payroll`, so this was already 50 through the class-level
            // fallback. Written down rather than changed.
            'min_seats' => 50,
            'type' => 'payroll',
        ],
    ],
];
