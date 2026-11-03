# Security policy

Health holds health data on the phone, so security reports are taken seriously.

## Reporting a vulnerability

Report it privately through GitHub: **Security › Report a vulnerability** on this repository, or open
<https://github.com/husainlab/Health-app/security/advisories/new>. Please do not open a public issue,
discussion or pull request for a vulnerability.

Include what you found, how to reproduce it (with demo data where possible), and the impact you see. Never send
real health data or exported files.

Health is maintained in spare time. Expect an acknowledgement within a week, and a fix
or a plan as soon as the issue is understood.

## Supported versions

Only the latest release and the latest commit on `main` are supported.

## Scope

In scope, for example:

- Anything that lets another app, or anyone without the unlocked phone, read Health's data.
- Health data or secrets (such as the coach key, kept in `expo-secure-store`) leaking through logs, errors,
  exports, backups or the network.
- Health writing unrequested records to Health Connect, or reading more than the permissions it asked for.

Out of scope:

- Attacks that need a rooted phone, or the phone unlocked in someone else's hands.
- Findings from automated scanners without a demonstrated impact.
