<?php

namespace Tests\Feature\Payroll;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A MISSING FIELD IS THE CALLER'S PROBLEM, AND HAS TO SAY SO.
 *
 * Thirty controller methods are written like this:
 *
 *     try {
 *         $data = $request->validate([...]);
 *         ...
 *     } catch (\Exception $e) {
 *         return response()->json([... $e->getMessage()], 500);
 *     }
 *
 * ValidationException extends Exception, so the catch-all swallows it, answers
 * 500, and throws away the per-field `errors` array on the way. The client is
 * told "Server error. Please try again later." for a form it could have fixed
 * in five seconds if anything had named the field.
 *
 * Found by submitting the New Revision form on the live site and then probing
 * every payroll create endpoint with an empty body: six answered 500 carrying a
 * validation sentence, six answered 422 with the field list. Same product, same
 * screen family, two different contracts.
 *
 * 422 with `errors` is what Laravel does unaided, what the other half of these
 * endpoints already do, and what every client in this repo is written to read.
 */
class ValidationErrorsAreNotServerErrorsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $organization = Organization::factory()->create();
        $this->admin = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'admin',
        ]);
    }

    public static function endpoints(): array
    {
        return [
            'revision letter' => ['/api/payroll/revision-letters', ['user_id', 'new_ctc']],
            'perquisite' => ['/api/payroll/perquisites', ['user_id']],
            'fbp allocation' => ['/api/payroll/fbp/allocate', ['user_id']],
            'fbp claim' => ['/api/payroll/fbp/claims', ['fbp_component_id']],
            'arrear calculation' => ['/api/payroll/arrears/calculate', ['user_id']],
            'bank batch' => ['/api/payroll/bank/create-batch', ['payroll_run_id']],
        ];
    }

    /**
     * @dataProvider endpoints
     */
    public function test_an_empty_submission_is_refused_with_422_and_names_the_fields(string $url, array $expectedFields): void
    {
        $response = $this->actingAs($this->admin)->postJson($url, []);

        $response->assertStatus(422);

        foreach ($expectedFields as $field) {
            $response->assertJsonValidationErrors($field);
        }
    }

    /**
     * @dataProvider endpoints
     */
    public function test_the_refusal_is_never_a_500(string $url): void
    {
        $status = $this->actingAs($this->admin)->postJson($url, [])->getStatusCode();

        $this->assertNotSame(
            500,
            $status,
            'a form the caller can fix must not be reported as a server fault'
        );
    }

    public function test_endpoints_that_already_behaved_still_do(): void
    {
        // These six were correct before and must stay correct — the fix is a
        // re-throw, not a rewrite of how anything validates.
        foreach ([
            '/api/payroll/reimbursements',
            '/api/payroll/arrears',
            '/api/payroll/pay-groups',
            '/api/payroll/leave-encashments',
        ] as $url) {
            $this->actingAs($this->admin)->postJson($url, [])->assertStatus(422);
        }
    }
}
