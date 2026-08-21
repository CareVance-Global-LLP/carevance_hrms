<?php

/*
 * Only the messages we deliberately reword. Everything absent falls through to
 * Laravel's defaults, which are fine — publishing the whole file would mean
 * carrying hundreds of strings we never touch and that then drift behind the
 * framework.
 */
return [
    'password' => [
        /*
         * Laravel's default reads "The given password has appeared in a data
         * leak", which people reliably misread as CareVance having leaked their
         * password. It also stops at the diagnosis: it never says what to do
         * instead, and the obvious next guess is usually another breached
         * password.
         *
         * The check is a k-anonymity lookup against Have I Been Pwned. It is
         * saying this exact string is already in an attacker's wordlist, not
         * that anything here was compromised.
         */
        'uncompromised' => 'This password has appeared in a public data breach, so it is not safe to use here. Please choose a different one — a few unrelated words works well.',
    ],
];
