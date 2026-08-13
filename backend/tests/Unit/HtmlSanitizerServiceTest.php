<?php

namespace Tests\Unit;

use App\Services\Security\HtmlSanitizerService;
use PHPUnit\Framework\TestCase;

/**
 * The sanitizer runs over every request through SanitizeInput middleware, so a
 * value it mangles is mangled application-wide.
 *
 * Both entry points guarded on empty(), and empty('0') is true in PHP: the
 * string "0" was replaced with "". Any field legitimately submitted as zero —
 * a 0% component, a 0 quantity, a 0 amount — arrived empty. It surfaced as a
 * 500 on the payroll salary breakdown, where '' reached a decimal cast, but it
 * was silently wrong everywhere else first.
 */
class HtmlSanitizerServiceTest extends TestCase
{
    private HtmlSanitizerService $sanitizer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->sanitizer = new HtmlSanitizerService();
    }

    public function test_it_preserves_the_string_zero(): void
    {
        $this->assertSame('0', $this->sanitizer->sanitizePlainText('0'));
        $this->assertSame('0', $this->sanitizer->sanitize('0'));
    }

    public function test_it_preserves_other_falsy_looking_strings(): void
    {
        $this->assertSame('0.00', $this->sanitizer->sanitizePlainText('0.00'));
        $this->assertSame('00', $this->sanitizer->sanitizePlainText('00'));
        $this->assertSame('false', $this->sanitizer->sanitizePlainText('false'));
    }

    public function test_null_and_empty_still_come_back_empty(): void
    {
        $this->assertSame('', $this->sanitizer->sanitizePlainText(null));
        $this->assertSame('', $this->sanitizer->sanitizePlainText(''));
        $this->assertSame('', $this->sanitizer->sanitize(null));
        $this->assertSame('', $this->sanitizer->sanitize(''));
    }

    public function test_it_still_escapes_plain_text(): void
    {
        $this->assertSame(
            '&lt;script&gt;alert(1)&lt;/script&gt;',
            $this->sanitizer->sanitizePlainText('<script>alert(1)</script>'),
        );
    }

    public function test_a_zero_inside_an_array_survives(): void
    {
        $result = $this->sanitizer->sanitizeArray([
            'basic_percentage' => '40',
            'da_percentage' => '0',
            'nested' => ['vpf_percentage' => '0'],
        ]);

        $this->assertSame('0', $result['da_percentage']);
        $this->assertSame('0', $result['nested']['vpf_percentage']);
    }
}
