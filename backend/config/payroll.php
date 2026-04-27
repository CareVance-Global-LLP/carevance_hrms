<?php

return [
    'mode' => env('PAYROLL_MODE', 'mock'), // mock | stripe_test | stripe_live
    'default_currency' => env('PAYROLL_DEFAULT_CURRENCY', 'INR'),
    'stripe_return_url' => env('PAYROLL_STRIPE_RETURN_URL', 'http://localhost:5173/payroll'),
    'stripe_success_url' => env('PAYROLL_STRIPE_SUCCESS_URL', 'http://localhost:5173/payroll?payment=success'),
    'stripe_cancel_url' => env('PAYROLL_STRIPE_CANCEL_URL', 'http://localhost:5173/payroll?payment=cancelled'),
];
