<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Trusted proxies
    |--------------------------------------------------------------------------
    |
    | Nothing was trusted here at all, and every deployment this repository
    | ships puts a reverse proxy in front of PHP: the Docker stack proxies
    | frontend nginx -> backend, the Lightsail box runs nginx in front of an
    | internal backend vhost on 127.0.0.1, and Caddy proxies /api/*. With an
    | empty trust list Symfony ignores X-Forwarded-For entirely and
    | $request->ip() returns the PROXY's address, so every sign-in from every
    | user on every device recorded the same 127.0.0.1.
    |
    | That was survivable while the value only reached audit_logs.ip_address.
    | It is not survivable now that "Where you're signed in" shows the address
    | to the account holder and asks them to sign out anything they do not
    | recognise: an address that is the same for a colleague in the next room
    | and an attacker in another country is not a weak signal, it is a false
    | one. The concurrent-device count depends on it too — with the address
    | constant, two different machines running the same browser collapse into
    | one and the banner never fires.
    |
    | THE DEFAULT IS THE PRIVATE RANGES, not '*'. Trusting '*' means trusting
    | whatever address the request arrived from, which on an internet-facing
    | box lets any caller name its own IP. Every edge in this repository sets
    | `X-Forwarded-For $proxy_add_x_forwarded_for` (append, not overwrite) and
    | sits on a loopback or RFC1918 address, so trusting exactly those ranges
    | resolves the real client and no more: Symfony walks the chain from the
    | right and stops at the first address it does not trust, which is the
    | public client.
    |
    | ONE CAVEAT WORTH KNOWING. If your users reach the app from inside these
    | same private ranges — an office LAN with no NAT between the desk and the
    | edge — then a client that deliberately forges an X-Forwarded-For header
    | can name the address recorded against its own session. Honest clients
    | are still resolved correctly. Deployments in that shape should set
    | TRUSTED_PROXIES to the edge's address specifically, e.g.
    | TRUSTED_PROXIES=127.0.0.1,::1
    |
    | Set TRUSTED_PROXIES to a comma-separated list of addresses or CIDR
    | ranges to narrow (or widen) this. '*' is accepted and means "trust
    | whatever is calling" — only correct when nothing but a fixed edge can
    | reach the port at all.
    |
    | The headers that are trusted are configured in bootstrap/app.php; this
    | framework version reads only `proxies` from here.
    |
    */

    'proxies' => env(
        'TRUSTED_PROXIES',
        '127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,fc00::/7,fe80::/10',
    ),

];
