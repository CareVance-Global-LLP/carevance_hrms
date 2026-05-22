<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organizations', function (Blueprint $table) {
            $table->text('description')->nullable()->after('name');
            $table->string('website')->nullable()->after('description');
            $table->string('industry')->nullable()->after('website');
            $table->string('size')->nullable()->after('industry');
            $table->string('phone')->nullable()->after('size');
            $table->string('email')->nullable()->after('phone');
            $table->string('address_line')->nullable()->after('email');
            $table->string('city')->nullable()->after('address_line');
            $table->string('state')->nullable()->after('city');
            $table->string('postal_code')->nullable()->after('state');
            $table->string('country')->nullable()->after('postal_code');
        });
    }

    public function down(): void
    {
        Schema::table('organizations', function (Blueprint $table) {
            $table->dropColumn([
                'description',
                'website',
                'industry',
                'size',
                'phone',
                'email',
                'address_line',
                'city',
                'state',
                'postal_code',
                'country',
            ]);
        });
    }
};
