# Arboretum preview at www.treegrow.xyz

The protected review application is attached to the owner's requested exact hostname, **www.treegrow.xyz**, through the dedicated `arboretum-preview` Netlify project. This is now the version served by the main website.

| Setting | Value |
| --- | --- |
| Preview hostname | `www.treegrow.xyz` |
| Tester entrance | `https://www.treegrow.xyz/tester-access` |
| Approved upgrade administrator route | `https://www.treegrow.xyz/admin/settlement-upgrade/` |
| Netlify project | `arboretum-preview` |
| Netlify site ID | `d425445d-4980-49be-8ab2-12e7527ba281` |
| Default Netlify hostname | `arboretum-preview.netlify.app` |
| Retained original project ID | `a344fb31-10b4-4eea-9562-067d90a39607` |

## Current administrator release — 2026-10-31 UTC

The owner-approved administrator signing page is published at **https://www.treegrow.xyz/admin/settlement-upgrade/**. Current deployment **`6ae5576912763ca45cca5a76`** uses source **`c20c181b5651c1818aa02e1cccbd3058cdcac4d6`** and was published at 02:50:37 UTC (October 30, 9:50 p.m. America/Chicago). Its isolated route accepts only the exact reviewed v11-to-v12 transaction, with explicit administrator account selection, fresh mainnet simulation, Slush approval, duplicate-request protection, and actual receipt verification. Gameplay submission remains disabled.

All 15 raw deployed asset hashes match the tested build; the 11 existing gameplay assets match the previously accepted preview byte for byte. The configured tester entrance, anonymous protection, published inventory, both edge functions, and calendar function inventory passed the current hosted checks. The gate, its credentials, and session settings were preserved. A fresh authenticated login and calendar invocation were not repeated because Netlify masks the stored production tester secret. The calendar function source and runtime are unchanged; its newly generated bundle digest differs. See the [current hosted record](../settlement-admin/verification/hosted-20261031.json) for the exact verification scope.

The [administrator handoff](../settlement-admin/README.md) records 28 passing focused tests, 46 passing synthetic browser checks, two successful Settlement integration CI runs, and the pre-existing failures in five historical preview workflows. The final read-only mainnet check still records version 11; the website deployment does not itself publish the contract. The next action is the owner's Slush signature.

## Accepted gameplay checkpoint — earlier on 2026-10-31 UTC

The protected preview was deployed and verified at [the requested www tester entrance](https://www.treegrow.xyz/tester-access). That accepted checkpoint used source commit `9aacd99d42d89e43ccdc216daefdfbaefd4ce265` and preview deployment `6ae53e7c96ded9882ad844c8` on the dedicated preview project. The domain reassignment reused that verified deployment without rebuilding application code. The current administrator release above preserves its gameplay assets.

Verification on the exact www origin passed for all 11 critical raw deployed assets, 30 anonymous/public route cases, and 11 tester login, content, cookie, and logout checks. Both edge functions and the calendar function are present. The served game HTML differs from the raw artifact only through Netlify Pretty URLs normalizing six internal anchor links and their serialization; the remaining parsed markup, text, and scripts match. The original project's deployment `6abe81174b61a8e3dd53b333` is retained, but the main domain now serves the preview project's deployment.

HTTPS is valid for both `www.treegrow.xyz` and `treegrow.xyz`, with the existing same-team certificate reused. HTTPS is enforced. The apex domain redirects to www. See [the completed www verification record](../settlement-integration/verification/hosted/www-preview-20261031.json). The earlier [subdomain preparation record](../settlement-integration/verification/hosted/branded-preview-20261031.json) is historical and has been superseded by the owner's request for exact www.

### User-confirmed Slush connection

On October 30, 2026 (America/Chicago), the owner reported successfully entering the tester access page and connecting Slush Wallet after the preview was attached to `www.treegrow.xyz`. The exact-domain tester and wallet connection flow therefore has a successful user-reported result. This confirmation is recorded separately from the automated HTTP checks, which did not operate a wallet.

The owner subsequently confirmed both requested acceptance checks: the Arboretum wallet address matches the selected Slush account, and the existing garden, NFTree holdings, and season information load as expected. The tester access, wallet connection, account selection, and data-loading checkpoint is therefore passed by user confirmation.

No gameplay transaction execution was verified, and gameplay submission remains disabled by the review build. The later administrator route is the separately approved, exact-upgrade exception. The user did not separately report whether a warning appeared. These results do not establish the cause of the earlier warning or clearance of the old Netlify preview hostnames.

## Build policy

Netlify calls the primary deployment of each project `production`. The dedicated project's primary deployment is still a protected review, so `scripts/build-policy.mjs` distinguishes the provider's context from the application's deployment role. The exception requires both `NETLIFY=true` and the exact preview site ID above. It also requires `REVIEW_ONLY=true` and settlement activation disabled.

`scripts/build-site.mjs` selects the review builder only for that pinned project. Other projects retain the previous public build sequence and its existing approval checks. The original production site and unknown site IDs cannot run the review builder in production context. Child builders inherit the actual context, and the review report records the dedicated-preview role explicitly. The Python builders use the same policy through a small JSON adapter.

The runtime application, wallet transforms, contracts, tester gate, public-guide edge function, and calendar function are unchanged. The preview remains nonindexable, with `Disallow: /` in `robots.txt`. Its 11 critical emitted application files match the verified `a3096b4f4e0d6b357949505f706b4afe88f85009` review build byte for byte.

## Runtime configuration

The preview project uses `NODE_VERSION=24` in the Builds scope for production context. It has its own `ARBORETUM_TESTER_PASSWORD` and `ARBORETUM_SESSION_SECRET` in the Functions scope for production context, both stored as secrets. The tester code is preserved from the existing review; the session secret is newly generated. No secret belongs in this repository or the published assets.

Bundle both edge functions and `calendar-reminder` with the full source deployment. A static-only upload is insufficient. Existing tester sessions are bound to their hostname, so testers enter the code again on the new hostname.

## Domain assignment and existing DNS

The original project released the apex/www domain pair, and the prepared preview project took `www.treegrow.xyz` as its primary domain. Netlify automatically redirects the apex domain to the www primary. Both projects remain in the same team.

No external DNS change was needed. The existing record remains:

| Type | Host | Existing value |
| --- | --- | --- |
| CNAME | `www` | `arboretum-sui-forest.netlify.app` |

Netlify's same-team hostname assignment selects the preview project even though that existing CNAME names the original project. Retain the original project and its `arboretum-sui-forest` name while this CNAME references it. No nameserver or registrar changes were made.

The earlier request to add a `preview` CNAME is withdrawn. The unused `preview.treegrow.xyz` assignment was removed before the transfer. It is not an alias on the requested www preview.

## Verification

Focused guard checks:

```sh
node --test scripts/build-policy.test.mjs economy-review/garden-ux.test.mjs economy-review/integration.test.mjs
```

Local simulation of the dedicated Netlify target:

```sh
NETLIFY=true CONTEXT=production SITE_ID=d425445d-4980-49be-8ab2-12e7527ba281 node scripts/build-site.mjs
```

This local simulation does not establish hosted availability. The hosted record separately confirms the edge gate, tester login, artifact hashes, disabled transactions, valid HTTPS, and actual domain assignment. Automated checks did not operate a wallet; the subsequent successful Slush connection was reported by the owner and is recorded above. Wallet-provider classification of other origins remains unverified.

The source policy's reporting origin is now `https://www.treegrow.xyz` for future builds. This metadata-only adjustment does not change the live application artifacts or the pinned preview site identity. Historical build records retain the origin configured when those builds ran.

## Provider references

- [External DNS configuration](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/)
- [Managed HTTPS](https://docs.netlify.com/manage/domains/secure-domains-with-https/https-ssl/)
- [Edge Functions environment variables](https://docs.netlify.com/build/edge-functions/environment-variables/)
- [Same-team domain reassignment without DNS changes](https://answers.netlify.com/t/guidance-on-launching-a-new-site-to-replace-existing-site-on-same-netlify-account-with-a-custom-domain/126832)
- [Same-team certificate reuse](https://answers.netlify.com/t/switching-domain-between-sites/56238)
- [Automatic apex/www pairing](https://docs.netlify.com/manage/domains/manage-domains/manage-multiple-domains/)
