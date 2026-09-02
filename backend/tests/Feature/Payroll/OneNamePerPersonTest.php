<?php

namespace Tests\Feature\Payroll;

use App\Models\EmployeeProfile;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A PERSON HAS ONE NAME ACROSS THE PRODUCT.
 *
 * `users.name` is what the Employees list, the sidebar, the payroll register
 * and the revision table all show. EmployeePayrollCardController composed its
 * own name from the profile instead — first_name plus last_name, falling back
 * to the EMAIL and never to users.name — in six places.
 *
 * On production that means the same six people are named differently depending
 * on which screen you are looking at:
 *
 *     users.name          profile first+last
 *     Akash               akash vishwakarma
 *     Vishwa              Vishwa Jolpara
 *     Nisha Goswami       Nisha Gauswami
 *
 * so Employee Cards lists "akash vishwakarma" and Salary Breakdown says
 * "Nisha Gauswami" while every other screen in the same tab says otherwise.
 * Half of them are also casing variants — "kajal patil" against "Kajal Patil".
 *
 * users.name wins because it is what the rest of the product already shows;
 * aligning the outlier with the majority changes six call sites rather than
 * every screen. The profile name remains the fallback for a user row that
 * somehow has none, and email is the last resort it always was.
 */
class OneNamePerPersonTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
    }

    public function test_the_account_name_is_what_the_product_shows(): void
    {
        $user = $this->person('Nisha Goswami', 'Nisha', 'Gauswami');

        $this->assertSame('Nisha Goswami', $user->displayName());
    }

    public function test_the_profile_name_fills_in_when_the_account_has_none(): void
    {
        $user = $this->person('', 'Vansh', 'Mistry');

        $this->assertSame('Vansh Mistry', $user->displayName());
    }

    public function test_a_first_name_alone_is_enough(): void
    {
        $user = $this->person('', 'Vishwa', '');

        $this->assertSame('Vishwa', $user->displayName());
    }

    public function test_email_is_the_last_resort(): void
    {
        $user = $this->person('', '', '');

        $this->assertSame($user->email, $user->displayName());
    }

    public function test_whitespace_does_not_count_as_a_name(): void
    {
        // A name of spaces used to pass `?:` and render as an empty cell.
        $user = $this->person('   ', '  ', '  ');

        $this->assertSame($user->email, $user->displayName());
    }

    private function person(string $accountName, string $first, string $last): User
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
            'name' => $accountName,
        ]);

        EmployeeProfile::updateOrCreate(
            ['user_id' => $user->id],
            [
                'organization_id' => $this->organization->id,
                'first_name' => $first,
                'last_name' => $last,
            ]
        );

        return $user->fresh();
    }
}
