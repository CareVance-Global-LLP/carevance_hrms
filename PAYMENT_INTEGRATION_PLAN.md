# Payment Integration Plan - CareVance HRMS

---

## 📋 PHASE 1: Subscription Plans & Pricing Strategy

### Plan Structure (How Other Companies Do It)

| Plan | Price/Month | Users | Features |
|------|-------------|-------|----------|
| **Starter** | $29/mo | Up to 10 | Basic HR, Attendance |
| **Professional** | $79/mo | Up to 50 | + Payroll, Monitoring |
| **Enterprise** | $199/mo | Unlimited | + Custom integrations, Priority support |
| **Custom** | Contact Sales | Unlimited | White-label, Dedicated support |

### Key Pricing Concepts

1. **Per-User Pricing** - Common (e.g., $5/user/month)
2. **Tier-Based Pricing** - Plan tiers with features (what we chose)
3. **Usage-Based** - Pay for active users only
4. **Freemium** - Free tier with limited features

### Implementation Steps

```php
// Database: plans table
Schema::create('plans', function (Blueprint $table) {
    $table->id();
    $table->string('name');           // Starter, Professional, Enterprise
    $table->string('slug');            // starter, professional, enterprise
    $table->decimal('price', 10, 2); // 29.00, 79.00, 199.00
    $table->string('billing_cycle');  // monthly, yearly
    $table->integer('max_users');     // 10, 50, unlimited (-1)
    $table->text('features');          // JSON: ['attendance', 'payroll']
    $table->boolean('is_active')->default(true);
    $table->timestamps();
});
```

---

## 📋 PHASE 2: Payment Gateway Integration

### Best Payment Processors for SaaS

| Provider | Best For | Fees | 
|----------|----------|------|
| **Stripe** | SaaS subscriptions | 2.9% + 30¢ |
| **Paddle** | SaaS (handles tax) | 5% + 50¢ |
| **Razorpay** | India market | 2% |
| **PayPal** | Multiple options | 2.99% + fixed |

### Recommended: Stripe (Industry Standard)

**Why Stripe?**
- ✅ Excellent subscription API
- ✅ Webhooks for automatic updates
- ✅ Works in 135+ countries
- ✅ Great dashboard for PM
- ✅ Handles trial periods
- ✅ Invoice generation

### Stripe Integration Flow

```
User selects plan
       ↓
Stripe Checkout (hosted page)
       ↓
Payment processed by Stripe
       ↓
Stripe Webhook → Your Backend
       ↓
Update organization subscription
```

---

## 📋 PHASE 3: Database Schema Changes

### New Tables Required

```php
// 1. Subscription Plans
plans
├── id, name, slug, price, billing_cycle
├── max_users, features (JSON)
├── trial_days, is_active
└── timestamps

// 2. Organization Subscriptions
organization_subscriptions
├── id
├── organization_id (FK)
├── plan_id (FK)
├── status (active, canceled, past_due, trialing)
├── stripe_subscription_id
├── stripe_customer_id
├── current_period_start
├── current_period_end
├── canceled_at
└── timestamps

// 3. Subscription Features (for enabling/disabling)
subscription_features
├── id
├── organization_id (FK)
├── feature_name (e.g., 'payroll', 'monitoring')
├── is_enabled
└── timestamps
```

---

## 📋 PHASE 4: Backend Implementation

### Step 1: Create Models

```php
// app/Models/Plan.php
class Plan extends Model {
    protected $fillable = ['name', 'slug', 'price', 'billing_cycle', 'max_users', 'features', 'is_active'];
    
    protected $casts = [
        'features' => 'array',
        'price' => 'decimal:2',
    ];
    
    public function subscriptions() {
        return $this->hasMany(OrganizationSubscription::class);
    }
}

// app/Models/OrganizationSubscription.php
class OrganizationSubscription extends Model {
    protected $fillable = [
        'organization_id', 'plan_id', 'status',
        'stripe_subscription_id', 'stripe_customer_id',
        'current_period_start', 'current_period_end'
    ];
    
    public function plan() {
        return $this->belongsTo(Plan::class);
    }
    
    public function organization() {
        return $this->belongsTo(Organization::class);
    }
}
```

### Step 2: Create Subscription Service

```php
// app/Services/Payment/StripeService.php
namespace App\Services\Payment;

use Stripe\Stripe;
use Stripe\Customer;
use Stripe\Subscription;
use Stripe\Checkout\Session;

class StripeService {
    public function __construct() {
        Stripe::setApiKey(config('services.stripe.secret'));
    }
    
    // Create customer in Stripe
    public function createCustomer(Organization $organization) {
        return Customer::create([
            'email' => $organization->owner->email,
            'name' => $organization->name,
            'metadata' => [
                'organization_id' => $organization->id
            ]
        ]);
    }
    
    // Create checkout session for subscription
    public function createCheckoutSession(Plan $plan, Organization $organization) {
        return Session::create([
            'payment_method_types' => ['card'],
            'line_items' => [[
                'price_data' => [
                    'currency' => 'usd',
                    'product_data' => [
                        'name' => $plan->name . ' Plan'
                    ],
                    'unit_amount' => $plan->price * 100, // Stripe uses cents
                    'recurring' => [
                        'interval' => $plan->billing_cycle ?? 'month'
                    ]
                ],
                'quantity' => 1
            ]],
            'mode' => 'subscription',
            'success_url' => config('app.url') . '/settings/billing?success=true',
            'cancel_url' => config('app.url') . '/settings/billing?canceled=true',
            'client_reference_id' => $organization->id,
            'metadata' => [
                'organization_id' => $organization->id,
                'plan_id' => $plan->id
            ]
        ]);
    }
    
    // Handle webhook events
    public function handleWebhook($payload, $signature) {
        $event = \Stripe\Webhook::constructEvent(
            $payload, 
            $signature, 
            config('services.stripe.webhook_secret')
        );
        
        switch ($event->type) {
            case 'customer.subscription.created':
                $this->handleSubscriptionCreated($event->data->object);
                break;
            case 'customer.subscription.updated':
                $this->handleSubscriptionUpdated($event->data->object);
                break;
            case 'customer.subscription.deleted':
                $this->handleSubscriptionDeleted($event->data->object);
                break;
            case 'invoice.payment_succeeded':
                $this->handlePaymentSucceeded($event->data->object);
                break;
            case 'invoice.payment_failed':
                $this->handlePaymentFailed($event->data->object);
                break;
        }
    }
}
```

### Step 3: Create Controller

```php
// app/Http/Controllers/Api/BillingController.php
namespace App\Http\Controllers\Api;

use App\Models\Plan;
use App\Models\Organization;
use App\Services\Payment\StripeService;
use Illuminate\Http\Request;

class BillingController extends Controller {
    private $stripeService;
    
    public function __construct(StripeService $stripeService) {
        $this->stripeService = $stripeService;
    }
    
    // Get available plans
    public function plans() {
        return response()->json(Plan::where('is_active', true)->get());
    }
    
    // Get current subscription
    public function currentSubscription(Request $request) {
        $organization = $request->user()->organization;
        $subscription = $organization->subscription;
        
        return response()->json([
            'plan' => $subscription?->plan,
            'status' => $subscription?->status,
            'current_period_end' => $subscription?->current_period_end,
            'cancel_at_period_end' => $subscription?->canceled_at
        ]);
    }
    
    // Create checkout session
    public function checkout(Request $request, Plan $plan) {
        $organization = $request->user()->organization;
        
        $checkoutSession = $this->stripeService->createCheckoutSession(
            $plan, 
            $organization
        );
        
        return response()->json([
            'checkout_url' => $checkoutSession->url
        ]);
    }
    
    // Cancel subscription
    public function cancel(Request $request) {
        $organization = $request->user()->organization;
        $subscription = $organization->subscription;
        
        if ($subscription && $subscription->stripe_subscription_id) {
            \Stripe\Subscription::update($subscription->stripe_subscription_id, [
                'cancel_at_period_end' => true
            ]);
        }
        
        return response()->json(['message' => 'Subscription will cancel at period end']);
    }
}
```

### Step 4: Webhook Handler Route

```php
// routes/api.php
Route::post('/webhooks/stripe', [BillingController::class, 'handleWebhook']);
```

---

## 📋 PHASE 5: Frontend Implementation

### Billing Page Components

```tsx
// src/pages/BillingSettings.tsx (simplified)
export default function BillingSettings() {
  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: () => billingApi.getPlans() });
  const { data: subscription } = useQuery({ queryKey: ['subscription'], queryFn: () => billingApi.getSubscription() });
  
  return (
    <div className="billing-page">
      {/* Current Plan */}
      <Card>
        <h2>Current Plan</h2>
        {subscription ? (
          <div>
            <p>{subscription.plan.name}</p>
            <p>Status: {subscription.status}</p>
            <p>Renews: {subscription.current_period_end}</p>
          </div>
        ) : (
          <p>No active subscription</p>
        )}
      </Card>
      
      {/* Plan Selection */}
      <div className="plans-grid">
        {plans?.map(plan => (
          <Card key={plan.id}>
            <h3>{plan.name}</h3>
            <p>${plan.price}/month</p>
            <ul>
              {plan.features.map(f => <li key={f}>{f}</li>)}
            </ul>
            <Button onClick={() => handleCheckout(plan)}>
              {subscription ? 'Upgrade' : 'Subscribe'}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

---

## 📋 PHASE 6: Feature Gating

### How to Enable/Disable Features Based on Plan

```php
// Middleware: CheckFeatureAccess.php
class CheckFeatureAccess {
    public function handle($request, $next, $feature) {
        $organization = $request->user()->organization;
        
        if (!$organization->hasFeature($feature)) {
            return response()->json([
                'message' => 'Upgrade to access this feature',
                'error_code' => 'FEATURE_NOT_INCLUDED',
                'upgrade_url' => '/settings/billing'
            ], 403);
        }
        
        return $next($request);
    }
}

// In routes/web.php
Route::middleware(['auth:sanctum', 'feature:payroll'])->group(function () {
    Route::get('/payroll/run', [PayrollController::class, 'run']);
});

// Organization model
class Organization extends Model {
    public function hasFeature(string $feature): bool {
        // Check subscription status
        if (!$this->subscription || $this->subscription->status !== 'active') {
            return false;
        }
        
        // Get plan features
        $planFeatures = $this->subscription->plan->features ?? [];
        
        // Super admins always have all features
        return in_array('super_admin', [$this->owner?->role]) 
            || in_array($feature, $planFeatures);
    }
}
```

---

## 📋 PHASE 7: Handling Edge Cases

### 1. Trial Periods
```php
// When creating subscription
'subscription_data' => [
    'trial_period_days' => $plan->trial_days ?? 14
]
```

### 2. Upgrading/Downgrading
```php
// Handle upgrade - charge proration
$subscription = \Stripe\Subscriptions::retrieve($stripeSubscriptionId);
\Stripe\Subscriptions::update($stripeSubscriptionId, [
    'items' => [
        'id' => $subscription->items->data[0]->id,
        'price' => $newPriceId
    ],
    'proration_behavior' => 'create_prorations'
]);
```

### 3. Failed Payments
```php
// Send email notification
// Downgrade to limited access
// Show "Update Payment" banner in app
```

### 4. Cancellation Flow
- Never delete data immediately
- Keep access until period end
- Offer "pause" instead of cancel
- Send retention offers before cancellation

---

## 📋 PHASE 8: Testing Plan

### Test Cases:
1. ✅ New subscription flow
2. ✅ Trial period conversion
3. ✅ Payment failure handling
4. ✅ Plan upgrade/downgrade
5. ✅ Cancellation flow
6. ✅ Webhook reliability (retry logic)
7. ✅ Invoice generation

### Stripe Testing:
- Use Stripe test card: 4242 4242 4242 4242
- Test different decline scenarios
- Verify webhook delivery

---

## 📋 COMPLETE IMPLEMENTATION CHECKLIST

| Task | Status |
|------|--------|
| Create plans table & seeder | ☐ |
| Create organization_subscriptions table | ☐ |
| Install Stripe SDK: `composer require stripe/stripe-php` | ☐ |
| Add Stripe keys to .env | ☐ |
| Create StripeService | ☐ |
| Create BillingController | ☐ |
| Add webhook route | ☐ |
| Implement feature gating middleware | ☐ |
| Create frontend Billing page | ☐ |
| Add "Upgrade" prompts for disabled features | ☐ |
| Test payment flow | ☐ |
| Add invoice generation | ☐ |
| Handle edge cases (trial, upgrade, cancel) | ☐ |

---

## 💰 REVENUE MODEL SUMMARY

```
Monthly Recurring Revenue (MRR) Calculation:

Starter (29) × 10 customers = $290
Professional (79) × 20 customers = $1,580  
Enterprise (199) × 5 customers = $995

Total MRR = $2,865/month
Annual Run Rate = $34,380/year
```

---

## 🎯 NEXT STEPS

1. **Start with Stripe** - It's the easiest to integrate
2. **Seed plans first** - Create 3-4 plans in database
3. **Build checkout flow** - Get one plan working end-to-end
4. **Add feature gating** - Protect advanced features
5. **Handle edge cases** - Trial, failed payments, upgrades
6. **Add analytics** - Track conversion rates

This plan gives you a production-ready subscription system that companies like Slack, Notion, and HubSpot use!