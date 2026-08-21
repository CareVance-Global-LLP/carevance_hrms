<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Organization;
use App\Models\User;
use App\Services\Auth\ScimProvisioningService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * SCIM 2.0, as identity providers actually speak it.
 *
 * OUTSIDE THE NORMAL AUTH STACK BY NECESSITY. An IdP cannot hold a session or
 * do an OAuth dance against us; RFC 7644 specifies bearer-token auth and that
 * is what Entra and Okta send. The token IS the authentication, which is why it
 * is hashed at rest and revocable.
 *
 * THE RESPONSE SHAPES ARE NOT OURS TO CHOOSE. `schemas`, `totalResults`,
 * `Resources`, and the error envelope with `scimType` are all defined by the
 * RFC. An IdP parses them strictly and reports "provisioning failed" with no
 * detail when they are wrong, so they are written out here rather than run
 * through this codebase's usual JSON conventions.
 *
 * DELETE MEANS DEACTIVATE. SCIM's DELETE says "this person is no longer in the
 * directory", not "erase their employment history". Payslips, attendance and
 * the leave ledger are records the organization is obliged to keep, and an IdP
 * administrator ticking a box must not be able to destroy them.
 */
class ScimController extends Controller
{
    private const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';

    public function __construct(
        private readonly ScimProvisioningService $scim,
    ) {
    }

    /**
     * List users, with the filter Entra and Okta actually send.
     *
     * They both probe `userName eq "someone@example.com"` before creating
     * anybody, so a listing that ignored the filter would report every user as
     * already existing and provision nobody.
     */
    public function index(Request $request): JsonResponse
    {
        $organization = $this->authenticate($request);

        if (! $organization) {
            return $this->unauthorised();
        }

        $query = User::query()->where('organization_id', $organization->id);

        $filter = (string) $request->query('filter', '');

        if (preg_match('/^\s*(userName|externalId)\s+eq\s+"?([^"]+)"?\s*$/i', $filter, $matches)) {
            [$attribute, $value] = [strtolower($matches[1]), trim($matches[2])];

            $attribute === 'username'
                ? $query->whereRaw('LOWER(email) = ?', [strtolower($value)])
                : $query->where('scim_external_id', $value);
        } elseif ($filter !== '') {
            /*
             * Anything else is refused rather than silently ignored. Returning
             * the whole directory for a filter we did not understand is how an
             * IdP concludes everybody already exists.
             */
            return $this->error(400, 'invalidFilter', 'That filter is not supported.');
        }

        $perPage = min(max((int) $request->query('count', 100), 1), 200);
        $startIndex = max((int) $request->query('startIndex', 1), 1);

        $total = (clone $query)->count();
        $users = $query->orderBy('id')->skip($startIndex - 1)->take($perPage)->get();

        return $this->scimJson([
            'schemas' => ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
            'totalResults' => $total,
            'startIndex' => $startIndex,
            'itemsPerPage' => $users->count(),
            'Resources' => $users->map(fn (User $user) => $this->scim->toScimUser($user))->all(),
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $organization = $this->authenticate($request);

        if (! $organization) {
            return $this->unauthorised();
        }

        $user = $this->find($organization, $id);

        return $user
            ? $this->scimJson($this->scim->toScimUser($user))
            : $this->error(404, 'notFound', 'No such user.');
    }

    public function store(Request $request): JsonResponse
    {
        $organization = $this->authenticate($request);

        if (! $organization) {
            return $this->unauthorised();
        }

        try {
            $user = $this->scim->upsertUser($organization, $request->all());
        } catch (RuntimeException $exception) {
            return $this->error(400, 'invalidValue', $exception->getMessage());
        }

        return $this->scimJson($this->scim->toScimUser($user), 201);
    }

    /** A full replace. Entra sends these on most attribute changes. */
    public function update(Request $request, string $id): JsonResponse
    {
        $organization = $this->authenticate($request);

        if (! $organization) {
            return $this->unauthorised();
        }

        $user = $this->find($organization, $id);

        if (! $user) {
            return $this->error(404, 'notFound', 'No such user.');
        }

        try {
            $payload = $request->all();
            // Pin the identity to the record we already matched, so a PUT
            // carrying a different userName renames rather than creating.
            $payload['externalId'] = $payload['externalId'] ?? $user->scim_external_id;

            $updated = $this->scim->upsertUser($organization, $payload);
        } catch (RuntimeException $exception) {
            return $this->error(400, 'invalidValue', $exception->getMessage());
        }

        return $this->scimJson($this->scim->toScimUser($updated));
    }

    /**
     * PATCH, which is how deprovisioning actually arrives.
     *
     * Okta and Entra both deactivate by patching `active` to false rather than
     * by calling DELETE, so a SCIM implementation without PATCH provisions
     * people perfectly and never removes anybody — the exact half-measure this
     * work exists to close.
     */
    public function patch(Request $request, string $id): JsonResponse
    {
        $organization = $this->authenticate($request);

        if (! $organization) {
            return $this->unauthorised();
        }

        $user = $this->find($organization, $id);

        if (! $user) {
            return $this->error(404, 'notFound', 'No such user.');
        }

        $operations = $request->input('Operations', $request->input('operations', []));

        if (! is_array($operations) || $operations === []) {
            return $this->error(400, 'invalidValue', 'A PATCH needs at least one operation.');
        }

        foreach ($operations as $operation) {
            $op = strtolower((string) ($operation['op'] ?? ''));
            $path = strtolower(trim((string) ($operation['path'] ?? '')));
            $value = $operation['value'] ?? null;

            if (! in_array($op, ['replace', 'add'], true)) {
                continue;
            }

            /*
             * Two shapes in the wild for the same thing:
             *   {"op":"replace","path":"active","value":false}     — Okta
             *   {"op":"replace","value":{"active":false}}          — Entra
             * Both mean deprovision, and handling only one is how half your
             * customers find leavers keep their access.
             */
            $active = match (true) {
                $path === 'active' => filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE),
                is_array($value) && array_key_exists('active', $value)
                    => filter_var($value['active'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE),
                default => null,
            };

            if ($active === false) {
                $this->scim->deactivate($user);

                continue;
            }

            if ($active === true) {
                $user->forceFill(['deactivated_at' => null, 'scim_synced_at' => now()])->save();

                continue;
            }

            if (is_array($value)) {
                $this->scim->upsertUser($organization, array_merge(
                    ['externalId' => $user->scim_external_id, 'userName' => $user->email],
                    $value,
                ));
            }
        }

        return $this->scimJson($this->scim->toScimUser($user->fresh()));
    }

    /** DELETE means deactivate — see the class docblock. */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $organization = $this->authenticate($request);

        if (! $organization) {
            return $this->unauthorised();
        }

        $user = $this->find($organization, $id);

        if (! $user) {
            return $this->error(404, 'notFound', 'No such user.');
        }

        $this->scim->deactivate($user);

        // 204, which is what the RFC specifies and what an IdP waits for.
        return response()->json(null, 204);
    }

    // -------------------------------------------------------------- helpers

    private function authenticate(Request $request): ?Organization
    {
        return $this->scim->organizationForToken($request->bearerToken());
    }

    private function find(Organization $organization, string $id): ?User
    {
        return User::query()
            ->where('organization_id', $organization->id)
            ->where(function ($query) use ($id) {
                $query->where('id', is_numeric($id) ? (int) $id : 0)
                    ->orWhere('scim_external_id', $id);
            })
            ->first();
    }

    /** @param array<string, mixed> $payload */
    private function scimJson(array $payload, int $status = 200): JsonResponse
    {
        // The RFC's own content type. Some IdPs check it.
        return response()->json($payload, $status, ['Content-Type' => 'application/scim+json']);
    }

    private function unauthorised(): JsonResponse
    {
        return $this->error(401, null, 'Invalid or missing bearer token.');
    }

    private function error(int $status, ?string $scimType, string $detail): JsonResponse
    {
        return $this->scimJson(array_filter([
            'schemas' => ['urn:ietf:params:scim:api:messages:2.0:Error'],
            'scimType' => $scimType,
            'detail' => $detail,
            'status' => (string) $status,
        ]), $status);
    }
}
