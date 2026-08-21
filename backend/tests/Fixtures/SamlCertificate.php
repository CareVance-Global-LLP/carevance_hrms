<?php

/**
 * A real self-signed X.509 certificate, used where a test needs openssl to
 * actually parse one.
 *
 * Held as PHP rather than a .txt fixture on purpose: the repository's
 * .gitignore excludes *.txt, so a plain-text fixture is present locally,
 * silently absent from the commit, and the test then fails only on a fresh
 * clone or in CI.
 *
 * Not a secret. It signs nothing; the matching private key was discarded when
 * it was generated. Valid until 2036.
 */

return ''
    .'MIIDFzCCAf+gAwIBAgIUfRF2dEr7IS3lBDva4l/0xjTnKJ8wDQYJKoZIhvcNAQELBQAwGzEZ'
    .'MBcGA1UEAwwQaWRwLmV4YW1wbGUudGVzdDAeFw0yNjA4MjEwNzA4NDBaFw0zNjA4MTgwNzA4'
    .'NDBaMBsxGTAXBgNVBAMMEGlkcC5leGFtcGxlLnRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IB'
    .'DwAwggEKAoIBAQDCUPu4sGMyY5/cFUcDOMEv0WSM7wqrGMf+AwhGpQXpRkLUB9jSWqhxNTcB'
    .'Oe6jEXQXjNkxIjvarQs/TBrNUf9eL0BbwU+YaLsdoWLGKd/txmZqsNhlVBx+lxv9ar0ulNzm'
    .'2XUgeu9VoFgBm6KTR3H6zsF7Af/qz2HpKoM98f26MEHtR2XH2u3+TURnxzgnEpLHq1h0/vNS'
    .'+vE2qX11VGNUBvX7kqc9xq7v+eabwUIUCE5R83MGjM1vGYHPAphFNjId8BvNOj2pjAB0Ic4M'
    .'iFMuB7Va6Q3i+ASCHYBQ5tNLo73qilYvrXi0G3FkKJ59ZFoC8ZY7Jxrkfl4iVNYaHSR9AgMB'
    .'AAGjUzBRMB0GA1UdDgQWBBQPt/gQRdLJt95q1D3zcSv79nlVljAfBgNVHSMEGDAWgBQPt/gQ'
    .'RdLJt95q1D3zcSv79nlVljAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQA3'
    .'Nm1w4/NiryQpZCjxzDPX5IPLdym2BntvGtcb55Q3JcLeplaHKcPtK3TcHplox4HINawfWsFD'
    .'29ocqT4QQR/mRj+AWeG7FS1JJAh95P+eagyTEnX/h2YnwD47PIDD9b7ocdhBgLqKDX2g7DrE'
    .'heNQ/Il+O+BBkNL2vXrzAytLJNBBf/f0iAFYeH/Eo+J/Y0CUNslsVJo9xQKigr3jOE5Lhagk'
    .'K73qy9eOQsI7J7pHNcN9e2Wi7jw9YqSTK+sJ/ODLUMZyPNUzca1zCuUf6e3Rps7Beg3QDdju'
    .'R2OJ5p4Udxv6U6g/P/P1kw7bIyoNP+YsdDrZ3VOhxeIe07FJU9WW';
