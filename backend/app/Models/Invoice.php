<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Invoice extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'invoice_number',
        'client_name',
        'client_email',
        'client_address',
        'subtotal',
        'tax',
        'total',
        'status',
        'due_date',
        'paid_at',
    ];

    protected $casts = [
        'subtotal' => 'decimal:2',
        'tax' => 'decimal:2',
        'total' => 'decimal:2',
        'due_date' => 'date',
        'paid_at' => 'date',
    ];

    protected $appends = ['total_amount', 'invoice_date'];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(InvoiceItem::class);
    }

    public function getTotalAmountAttribute(): float
    {
        return (float) $this->total;
    }

    public function getInvoiceDateAttribute(): string
    {
        return $this->created_at?->toDateString() ?? now()->toDateString();
    }
}
