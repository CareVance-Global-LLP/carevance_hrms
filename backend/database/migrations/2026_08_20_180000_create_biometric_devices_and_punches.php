<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ingestion for eSSL, ZKTeco, Biomax and Matrix punch devices.
 *
 * These are physically on the wall of most Indian offices. A buyer who has
 * already paid for the hardware will not replace it to adopt us, and will not
 * run two attendance systems either — so this is a hardware objection that
 * cannot be argued past, only removed.
 *
 * Built around the ADMS "push" protocol rather than a pull SDK. The device
 * opens an OUTBOUND HTTP connection to us and posts its logs, which works
 * behind office NAT and firewalls with no VPN, no static IP and nothing
 * installed on the customer's network. A pull SDK needs a reachable device,
 * which in a small Indian office it never is.
 *
 * Three tables, because three different things can be wrong:
 *
 * - `biometric_devices` — is the hardware known and talking to us?
 * - `biometric_device_users` — do we know whose finger that is?
 * - `biometric_punches` — what did it actually report?
 *
 * Keeping them apart is what makes the failure legible. Every integration of
 * this kind breaks at the second one, and a design that folds it into the third
 * can only say "attendance is wrong" rather than "device 3 sent us user 47 and
 * nobody has claimed that id".
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('biometric_devices')) {
            Schema::create('biometric_devices', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();

                /*
                 * The serial the device sends on every request, and the only
                 * thing identifying it. A device cannot hold a bearer token, so
                 * the serial must be pre-registered by an admin: an unknown
                 * serial is refused rather than auto-enrolled, or anybody who
                 * learns the endpoint could post attendance for a tenant.
                 */
                $table->string('serial_number', 64);
                $table->string('name');
                $table->string('location')->nullable();

                // Which company's premises it sits in, for multi-entity groups.
                $table->foreignId('legal_entity_id')->nullable()->constrained('legal_entities')->nullOnDelete();

                $table->string('vendor', 32)->nullable();
                $table->string('firmware', 64)->nullable();
                $table->string('ip_address', 45)->nullable();

                /*
                 * A device that has stopped talking is the failure mode nobody
                 * notices: attendance simply stops arriving and looks like
                 * absence. This is what an alert reads.
                 */
                $table->timestamp('last_seen_at')->nullable();
                $table->unsignedInteger('punches_received')->default(0);

                $table->boolean('is_active')->default(true);
                $table->timestamps();

                $table->unique('serial_number');
                $table->index(['organization_id', 'is_active']);
            });
        }

        if (! Schema::hasTable('biometric_device_users')) {
            Schema::create('biometric_device_users', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();

                /*
                 * The id the DEVICE knows somebody by — enrolled on the device
                 * keypad, unrelated to anything in this system. Mapping it to a
                 * person is the step every one of these integrations actually
                 * breaks at, so it is an explicit, admin-visible row rather than
                 * a convention like "device id equals employee code".
                 */
                $table->string('device_user_id', 64);
                $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();

                // Null user_id means "seen, not yet claimed" — which is a state
                // an admin has to be able to see and fix, not an error to drop.
                $table->timestamp('first_seen_at')->nullable();
                $table->timestamps();

                $table->unique(['organization_id', 'device_user_id']);
                $table->index('user_id');
            });
        }

        if (! Schema::hasTable('biometric_punches')) {
            Schema::create('biometric_punches', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('biometric_device_id')->constrained()->cascadeOnDelete();

                $table->string('device_user_id', 64);
                $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();

                $table->timestamp('punched_at');

                /*
                 * What the device thinks the punch means. Kept, but not trusted:
                 * these are set by whichever key the person pressed, and in
                 * practice everybody presses the same one. Direction is decided
                 * downstream from the sequence of punches in a day.
                 */
                $table->string('device_status', 16)->nullable();
                $table->string('verify_mode', 16)->nullable();

                // Whether this punch has been folded into attendance yet.
                $table->timestamp('processed_at')->nullable();
                $table->string('process_result', 40)->nullable();

                $table->timestamps();

                $table->index(['organization_id', 'punched_at']);
                $table->index(['user_id', 'punched_at']);
                $table->index('processed_at');

                /*
                 * The same punch, once.
                 *
                 * Devices replay their whole buffer after a connectivity gap,
                 * and some replay on every poll until acknowledged. Without
                 * this, one office outage becomes thousands of duplicate
                 * punches and an attendance record nobody can read.
                 *
                 * Declared here rather than as raw pgsql SQL: it carries no
                 * WHERE clause, so every driver can enforce it - and a guarantee
                 * that exists only on the production driver is one the tests
                 * cannot check.
                 */
                $table->unique(['biometric_device_id', 'device_user_id', 'punched_at'], 'biometric_punches_unique');
            });
        }

    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS biometric_punches_unique');
        }

        Schema::dropIfExists('biometric_punches');
        Schema::dropIfExists('biometric_device_users');
        Schema::dropIfExists('biometric_devices');
    }
};
