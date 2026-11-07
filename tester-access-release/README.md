# TreeGrow testing without an access code

The project owner requested removal of the shared tester access code on
`https://www.treegrow.xyz`. This release changes the custom Edge Function's
website access policy on the dedicated Netlify site
`d425445d-4980-49be-8ab2-12e7527ba281`.

Published on **2026-11-07 at 03:53:39 UTC** from source commit
`05c0a9d9799ba6bc096051650320099db3def8a8`, Netlify deploy
`6aeea0b254e028ece344267c`. The original tester entrance was reloaded in a
browser and opened `https://www.treegrow.xyz/admin/claim-test/` directly, without
entering a code. The disconnected wallet controls remained disabled.

Release records are under `verification/hosted/`. Both push and pull-request
runs of the required **Settlement app integration review** workflow passed for
the exact source commit. Other repository workflow results are recorded
separately in `verification/hosted/ci.json`; this release does not claim that
every historical workflow passed.

## Result

- The garden, new-season review, and isolated owner/administrator pages and
  assets load through ordinary GET/HEAD requests without a password or cookie.
- Existing `/tester-access` links redirect to their fixed intended destination.
  Unknown or duplicate `next` values fall back to `/game.html`.
- An old native login form can still submit a same-origin, bounded form POST;
  it redirects without checking a password and expires any old tester cookie.
  It cannot create an authenticated session. Logout expires that cookie and
  returns to the garden.
- Other non-GET/HEAD requests remain denied. The calendar function's read-only
  ICS response is available; its POST/PUT/etc requests are denied at the edge.
- Application responses retain no-store, no-index, frame, referrer, and content
  type protections. Public home and handbook policies remain as before.
- The provider-assigned site ID is the only opt-in. Missing or different site
  IDs retain the original tester gate. No Netlify platform visibility or
  password-protection setting is changed.

These testing pages are now viewable by anyone with the link. The no-index
header is a search-engine directive, not access control. Browser wallet
selection, account/network checks, reviewed transaction intent, and explicit
wallet approval remain separate from website access and are unchanged. General
garden transaction submission remains disabled by the existing review build.

## Validation and preservation

The release retains the 103 application files from published deploy
`6aebf7959ad6e90b6714ca15` byte for byte. It preserves the sole
`calendar-reminder` backend bundle/runtime, both Edge Function names, no scheduled
functions, and the original site's published deploy. Only `tester-gate` behavior
changes. The preflight evidence records the actual deployed inventories.

After publication, all 103 expected application paths were retrieved without
tester credentials. Of those, 95 responses match the build byte for byte. Eight
HTML responses contain only Netlify's verified pretty-URL transformation in 23
anchor start tags: `.html` suffix removal, relative-link resolution, and tag
quote/attribute-order serialization. Every other byte and every non-URL attribute
value matches. The exact changed tags and raw response hashes are recorded in
`verification/hosted/html-serving-normalization.json`.

Post-publication backend and current-site checks used the connected Netlify
tools; the local deployment credential file was no longer available. The
connector confirmed the unchanged calendar bundle/runtime, no schedules, two
edge functions, and the original site's unchanged publication. An authenticated
post-publication file inventory and internal edge-function names were not
re-read; the public verification covers all 103 expected application paths and
does not enumerate additional remote paths. Source files and all application
bytes remain bound to the submitted archive and saved baseline.

The focused tester-gate tests cover the dedicated-site exception and the
original gate together. Build policy/panel checks, the reproducible review build,
the required integration CI workflow, and anonymous hosted checks verify the
release. Source ZIP deployment uses the existing build pipeline so backend and
edge bundles are preserved along with static assets; a static-only upload is
insufficient.

No wallet connections, signatures, blockchain submissions, or contract/SDK
changes are part of this release.

## Guidance consulted

The live `MystenLabs/skills` README was checked for this request at commit
`495528ab09a75480847f5b9668adc163817bb296`. Relevant files reviewed:

- `move-security/SKILL.md`, `move-security/best-practices.md`, and
  `move-security/access-control.md` for the distinction between website access,
  public chain data, and wallet/capability authority.
- `frontend-apps/SKILL.md` and `frontend-apps/limitations.md` for browser secrets
  and wallet authorization boundaries.

Current Netlify access-control, deployment, and Edge Function guidance was also
reviewed. This is a custom application access-policy change, scoped using
`context.site.id`, rather than a change to Netlify platform access controls.
