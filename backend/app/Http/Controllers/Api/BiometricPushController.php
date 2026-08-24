<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BiometricDevice;
use App\Models\BiometricDeviceUser;
use App\Models\BiometricPunch;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The ADMS "push" endpoints that eSSL, ZKTeco, Biomax and Matrix devices speak.
 *
 * The device opens an OUTBOUND connection to us and posts its logs, which is
 * what makes this work in a real Indian office: behind NAT, behind a firewall,
 * on a dynamic IP, with nothing installed on the customer's network. A pull SDK
 * needs a reachable device, which it never is.
 *
 * These routes are necessarily UNAUTHENTICATED in the usual sense — a wall
 * terminal cannot hold a bearer token and cannot be redirected to a login. The
 * device identifies itself by serial, so the protections are:
 *
 *   1. The serial must already be registered by an admin. An unknown serial is
 *      refused, never auto-enrolled: otherwise anyone who learns this URL could
 *      post attendance into a tenant.
 *   2. Punches are unique on (device, device user, timestamp) at the database
 *      level, so replaying a captured request changes nothing.
 *   3. A punch is a SIGNAL, not a conclusion. It records that a reading
 *      happened; it does not itself decide anybody's pay.
 *
 * Responses are plain text and must stay that way. These devices parse for a
 * literal "OK" and retry forever on anything else — including on a perfectly
 * good JSON body.
 */
class BiometricPushController extends Controller
{
    /**
     * Handshake. The device asks what to send and how.
     *
     * Called on boot and periodically. The response is a key=value block the
     * device parses; sending JSON here makes it retry indefinitely.
     */
    public function handshake(Request $request): Response
    {
        $device = $this->resolveDevice($request);
        if (! $device) {
            return $this->refuse();
        }

        $this->touch($device, $request);

        /*
         * Stamp/ATTLOGStamp are the device's cursor. Returning 0 asks it to
         * send everything it has rather than only what is new — correct on
         * first contact, and harmless afterwards because the unique index makes
         * a replay a no-op. Being deliberately generous here is what makes an
         * office outage self-heal.
         */
        return $this->plain(implode("\r\n", [
            'GET OPTION FROM: '.$device->serial_number,
            'ATTLOGStamp=0',
            'OPERLOGStamp=0',
            'ErrorDelay=30',
            'Delay=10',
            'TransTimes=00:00;12:00',
            'TransInterval=1',
            'TransFlag=1111000000',
            'Realtime=1',
            'Encrypt=0',
        ]));
    }

    /**
     * Attendance logs. The body is tab-separated, one punch per line.
     *
     * Format: device_user_id \t timestamp \t status \t verify \t ...
     * Vendors differ past the fourth field, so nothing beyond it is read.
     */
    public function receive(Request $request): Response
    {
        $device = $this->resolveDevice($request);
        if (! $device) {
            return $this->refuse();
        }

        $this->touch($device, $request);

        // Only attendance for now. A device also pushes operation logs and
        // fingerprint templates; acknowledging them keeps it from retrying
        // forever, which is the only thing that matters until we store them.
        if (strtoupper((string) $request->query('table', 'ATTLOG')) !== 'ATTLOG') {
            return $this->plain('OK');
        }

        $stored = 0;
        $unclaimed = 0;

        foreach (preg_split('/\r\n|\r|\n/', (string) $request->getContent()) as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }

            $parts = preg_split('/\t+/', $line);
            $deviceUserId = trim((string) ($parts[0] ?? ''));
            $rawTimestamp = trim((string) ($parts[1] ?? ''));

            if ($deviceUserId === '' || $rawTimestamp === '') {
                continue;
            }

            try {
                // The device sends local wall-clock with no zone. Interpreting
                // it as UTC would shift every punch by the offset — five and a
                // half hours here, which turns a 9am arrival into a 3:30am one.
                $punchedAt = Carbon::parse($rawTimestamp, config('app.timezone'));
            } catch (\Throwable) {
                Log::warning('Biometric punch with unparseable timestamp', [
                    'device' => $device->serial_number,
                    'raw' => $rawTimestamp,
                ]);

                continue;
            }

            $mapping = $this->rememberDeviceUser($device, $deviceUserId);
            if (! $mapping->user_id) {
                $unclaimed++;
            }

            $created = $this->storePunch($device, $deviceUserId, $mapping->user_id, $punchedAt, $parts);
            $stored += $created;
        }

        if ($stored > 0) {
            $device->increment('punches_received', $stored);
        }

        if ($unclaimed > 0) {
            // Surfaced rather than swallowed: an unclaimed id is the single most
            // common way this integration silently produces no attendance.
            Log::info('Biometric punches from unmapped device users', [
                'device' => $device->serial_number,
                'count' => $unclaimed,
            ]);
        }

        return $this->plain('OK');
    }

    /**
     * The device polling for commands to run.
     *
     * We push none, but it must be answered: an unanswered poll is retried
     * every few seconds forever and fills the device log.
     */
    public function commands(Request $request): Response
    {
        $device = $this->resolveDevice($request);
        if (! $device) {
            return $this->refuse();
        }

        $this->touch($device, $request);

        return $this->plain('OK');
    }

    /** Acknowledgement of a command result. Nothing to do; answer and move on. */
    public function commandResult(Request $request): Response
    {
        return $this->resolveDevice($request) ? $this->plain('OK') : $this->refuse();
    }

    /**
     * One punch, or nothing if we have it already.
     *
     * Devices replay their whole buffer after a connectivity gap, and some
     * replay on every poll until acknowledged. The unique index is what makes
     * that safe; this catches the resulting violation rather than pre-checking,
     * because a check-then-insert races two devices posting the same person.
     */
    private function storePunch(BiometricDevice $device, string $deviceUserId, ?int $userId, Carbon $punchedAt, array $parts): int
    {
        try {
            BiometricPunch::query()->create([
                'organization_id' => $device->organization_id,
                'biometric_device_id' => $device->id,
                'device_user_id' => $deviceUserId,
                'user_id' => $userId,
                'punched_at' => $punchedAt,
                'device_status' => trim((string) ($parts[2] ?? '')) ?: null,
                'verify_mode' => trim((string) ($parts[3] ?? '')) ?: null,
            ]);

            return 1;
        } catch (\Illuminate\Database\UniqueConstraintViolationException) {
            return 0;
        } catch (\Illuminate\Database\QueryException $exception) {
            // sqlite reports the same collision as a plain QueryException.
            if (str_contains(strtolower($exception->getMessage()), 'unique')) {
                return 0;
            }

            throw $exception;
        }
    }

    /**
     * Record that this device id exists, without guessing whose it is.
     *
     * Auto-matching on employee code is how these integrations go wrong
     * silently: the codes look similar enough to match the wrong person, and
     * nobody discovers it until payroll. An unclaimed id is a visible row for an
     * admin to resolve.
     */
    private function rememberDeviceUser(BiometricDevice $device, string $deviceUserId): BiometricDeviceUser
    {
        return BiometricDeviceUser::query()->firstOrCreate(
            [
                'organization_id' => $device->organization_id,
                'device_user_id' => $deviceUserId,
            ],
            ['first_seen_at' => now()],
        );
    }

    private function resolveDevice(Request $request): ?BiometricDevice
    {
        $serial = trim((string) ($request->query('SN') ?? $request->query('sn') ?? ''));
        if ($serial === '') {
            return null;
        }

        return BiometricDevice::withoutOrganizationScope()
            ->where('serial_number', $serial)
            ->where('is_active', true)
            ->first();
    }

    private function touch(BiometricDevice $device, Request $request): void
    {
        // Written without touching updated_at so "last seen" stays a fact about
        // the device rather than about our own writes.
        DB::table('biometric_devices')->where('id', $device->id)->update([
            'last_seen_at' => now(),
            'ip_address' => $request->ip(),
        ]);
    }

    private function plain(string $body): Response
    {
        return response($body, 200)->header('Content-Type', 'text/plain');
    }

    /**
     * An unregistered serial.
     *
     * 200 with an empty body on purpose. A 401 makes some firmware retry in a
     * tight loop and others disable their upload queue entirely — and a device
     * that gives up is worse than one that is politely ignored, because the
     * customer's real device may simply have been typed in wrong.
     */
    private function refuse(): Response
    {
        return $this->plain('');
    }
}
