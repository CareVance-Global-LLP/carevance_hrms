<?php

namespace App\Http\Middleware;

use App\Services\Security\HtmlSanitizerService;
use Closure;
use Illuminate\Http\Request;

class SanitizeInput
{
    public function __construct(
        private readonly HtmlSanitizerService $sanitizer
    ) {
    }

    /**
     * Fields that can contain HTML (will be sanitized but allow safe HTML)
     */
    private const HTML_ALLOWED_FIELDS = [
        'description',
        'body',
        'content',
        'message',
        'notes',
        'comment',
        'details',
    ];

    /**
     * Handle an incoming request.
     */
    public function handle(Request $request, Closure $next): mixed
    {
        $this->sanitizeInput($request);
        return $next($request);
    }

    /**
     * Sanitize request input
     */
    private function sanitizeInput(Request $request): void
    {
        $input = $request->all();
        
        if (empty($input)) {
            return;
        }

        $sanitized = $this->sanitizeArray($input);
        $request->replace($sanitized);
    }

    /**
     * Recursively sanitize array
     */
    private function sanitizeArray(array $data, string $parentKey = ''): array
    {
        $sanitized = [];
        
        foreach ($data as $key => $value) {
            $fullKey = $parentKey ? "{$parentKey}.{$key}" : $key;
            
            if (is_array($value)) {
                // Handle nested arrays (like items[0][description])
                if ($this->isSequentialArray($value)) {
                    $sanitized[$key] = array_map(
                        fn ($item) => is_array($item) ? $this->sanitizeArray($item, $fullKey) : $this->sanitizeValue($item, $fullKey),
                        $value
                    );
                } else {
                    $sanitized[$key] = $this->sanitizeArray($value, $fullKey);
                }
            } else {
                $sanitized[$key] = $this->sanitizeValue($value, $key);
            }
        }
        
        return $sanitized;
    }

    /**
     * Check if array is sequential (list) rather than associative
     */
    private function isSequentialArray(array $array): bool
    {
        if (empty($array)) {
            return true;
        }
        return array_keys($array) === range(0, count($array) - 1);
    }

    /**
     * Sanitize a single value
     */
    private function sanitizeValue(mixed $value, string $key): mixed
    {
        if (!is_string($value)) {
            return $value;
        }

        // Check if this field allows HTML
        $allowsHtml = $this->fieldAllowsHtml($key);
        
        if ($allowsHtml) {
            return $this->sanitizer->sanitize($value);
        }

        return $this->sanitizer->sanitizePlainText($value);
    }

    /**
     * Check if field allows HTML
     */
    private function fieldAllowsHtml(string $key): bool
    {
        $keyLower = strtolower($key);
        
        foreach (self::HTML_ALLOWED_FIELDS as $allowed) {
            if (str_contains($keyLower, $allowed)) {
                return true;
            }
        }
        
        return false;
    }
}
