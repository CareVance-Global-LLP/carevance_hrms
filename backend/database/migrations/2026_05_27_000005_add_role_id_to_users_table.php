<?php

use App\Models\Organization;
use App\Models\Permission;
use App\Models\Role;
use Carbon\Carbon;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('role_id')->nullable()->constrained('roles')->nullOnDelete();
        });

        // Map existing role strings to system roles for each organization.
        // This is a best-effort migration; brand-new orgs will get system roles
        // created by the Organization model observer.
        $now = Carbon::now();
        $orgs = Organization::whereHas('users')->get();

        DB::transaction(function () use ($orgs, $now) {
            foreach ($orgs as $org) {
                foreach (Organization::SYSTEM_ROLE_HIERARCHY_LEVELS as $slug => $level) {
                    $existing = Role::where('organization_id', $org->id)->where('slug', $slug)->first();
                    if ($existing) continue;

                    $role = Role::create([
                        'organization_id' => $org->id,
                        'name' => ucfirst($slug),
                        'slug' => $slug,
                        'description' => ucfirst($slug) . ' role (system)',
                        'hierarchy_level' => $level,
                        'is_system' => true,
                        'is_active' => true,
                    ]);

                    $permKeys = Organization::SYSTEM_ROLE_PERMISSION_DEFAULTS[$slug] ?? Permission::pluck('key')->all();
                    $permIds = Permission::whereIn('key', $permKeys)->pluck('id');
                    DB::table('role_permissions')->insert(
                        $permIds->map(fn($pid) => [
                            'role_id' => $role->id,
                            'permission_id' => $pid,
                            'created_at' => $now,
                            'updated_at' => $now,
                        ])->all()
                    );
                }
            }
        });

        // Migrate existing users to role_id
        $users = DB::table('users')->whereNull('role_id')->get(['id', 'organization_id', 'role']);

        DB::transaction(function () use ($users) {
            foreach ($users as $user) {
                $slug = strtolower(trim($user->role));
                if (!array_key_exists($slug, Organization::SYSTEM_ROLE_HIERARCHY_LEVELS)) continue;
                $role = Role::where('organization_id', $user->organization_id)->where('slug', $slug)->first();
                if ($role) {
                    DB::table('users')->where('id', $user->id)->update(['role_id' => $role->id]);
                }
            }
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['role_id']);
            $table->dropColumn('role_id');
        });
    }
};
