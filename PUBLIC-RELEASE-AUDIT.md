# Public release audit

Checked on 5 October 2026. Scope: the exact files staged for the first public
Survantara commit. This is a publication-content audit, not a penetration test
or a guarantee that the application has no security defects.

## Evidence

- The staged file contents matched the working files after line-ending
  normalization. The public repository has no commits and no Git remote;
  operational Git history was not copied.
- Staged content was compared with 225 original seeded values, including
  account hashes, salts, institution identifiers, and master-data names.
  No credential or operational seed matches were found. Remaining name
  mentions were negative assertions in tests and a documentation example;
  the documentation example has since been generalized.
- An additional exact-match comparison checked the original database ID,
  manager email, institution contacts, and any available local-secret
  assignments. No matches were found; values are not recorded in this report.
- All staged migrations were applied to a fresh in-memory SQLite database.
  Users, reporters, routine sources, villages, posyandu, reports, audit logs,
  integration bindings/receipts, public disease snapshots, and status history
  each contained zero rows.
- No private-key, access-token, literal JWT, Telegram-token, or local-machine
  path patterns were found. The D1 ID is an all-zero deployment placeholder.
- Known HTTP destinations are map libraries/tiles, official surveillance
  provenance, optional Telegram delivery, documentation, and local test or
  reserved example addresses. The Google Drive URL in the reference catalog
  is retained source provenance, not an institution's private W2 guide.

## Intentional public content

- Original author credit for Naufal Hilmy Amanur Qolby and the custom license.
- Synthetic test accounts, PINs, phone numbers, patient labels, and villages.
  These are isolated test fixtures; application migrations do not create them.
- Clinical catalogs, validation rules, empty operational schemas, and optional
  integration code.
- Negative tests that reject the former institution's branding.

## Limits and ongoing checks

Ignored dependencies, Wrangler caches, and QA screenshots may exist in the
working directory. They are excluded from the staged commit. Publishing the
entire directory as a ZIP would require a separate content check.

The release checker now reads Git's staged content and refuses unstaged
changes or untracked public files. Its token checks are pattern based and
cannot identify every possible secret. Re-run it after changes; never treat
this audit as approval for future added data or credentials.

An isolated copy of the staged sources was also used to verify the checker:
it accepted the clean snapshot and rejected staged synthetic private-key and
access-token patterns, as well as an unstaged source change.
