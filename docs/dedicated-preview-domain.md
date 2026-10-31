# Arboretum preview at www.treegrow.xyz

The protected review application is attached to the owner's requested exact hostname, **www.treegrow.xyz**, through the dedicated `arboretum-preview` Netlify project. This is now the version served by the main website.

| Setting | Value |
| --- | --- |
| Preview hostname | `www.treegrow.xyz` |
| Tester entrance | `https://www.treegrow.xyz/tester-access` |
| Upgrade tester entrance | `https://www.treegrow.xyz/tester-access?next=settlement-upgrade` |
| Approved upgrade administrator route | `https://www.treegrow.xyz/admin/settlement-upgrade/` |
| Netlify project | `arboretum-preview` |
| Netlify site ID | `d425445d-4980-49be-8ab2-12e7527ba281` |
| Default Netlify hostname | `arboretum-preview.netlify.app` |
| Retained original project ID | `a344fb31-10b4-4eea-9562-067d90a39607` |

## Current administrator release — 2026-10-31 UTC

The owner-approved administrator signing page is published at **https://www.treegrow.xyz/admin/settlement-upgrade/**. Current deployment **`6ae55e069ac28a1658ed0d65`** uses source **`5abbe0930fd61639c37addd7a7a745b57a12db32`** and was published at 03:18:45 UTC (October 30, 10:18 p.m. America/Chicago). Its isolated route accepts only the exact reviewed v11-to-v12 transaction, with explicit administrator account selection, fresh mainnet simulation, Slush approval, duplicate-request protection, and actual receipt verification. Gameplay submission remains disabled.

The [upgrade tester entrance](https://www.treegrow.xyz/tester-access?next=settlement-upgrade) says **Continue to upgrade review** and returns directly to the administrator page. The previous gate always returned to the garden; an external link could also omit its Strict session cookie. The fixed gate preserves one opaque administrator return marker through authentication and an incorrect-code retry, without accepting arbitrary return URLs or changing cookie security.

All 15 raw deployed application asset hashes match the initial administrator release, including the 11 accepted gameplay assets. The [current authenticated hosted record](../settlement-admin/verification/tester-return-hosted-20261031.json) confirms 21 passing checks, actual code acceptance and administrator content, protected assets, the ordinary garden entrance, logout, and preserved calendar output. The calendar bundle digest is also unchanged. Existing credentials and session settings are preserved. The earlier masked-secret authentication limitation is historical: the existing code from the owner's earlier conversation enabled the new checks.

The [administrator handoff](../settlement-admin/README.md) records the original 28 focused upgrade tests and 46 synthetic upgrade browser checks, plus 10 return-routing tests, 20 native return-regression checks, [12 successful live native-browser checks](../settlement-admin/verification/tester-return-browser-hosted-20261031.json), and both successful Settlement integration CI runs for the current exact source. Older byte-equality guards may reject the intentional gate edit; the earlier legacy CI triage is not a result for this commit. The owner subsequently signed the approved upgrade: transaction `GY23E3FJnMkg9VgZnqABEyWrKsTog35hfqAQx6mwBZKU` confirmed version 12 at checkpoint 340000251 (October 30, 10:31 p.m. CDT). The new package is `0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a`; the actual fee is 0.337998763 SUI. See the [confirmed receipt verification](../settlement-integration/release/evidence/20261031-confirmed-upgrade/verification.json). The next separate action is empty Registry setup; the current website has no setup signing control. Gameplay and season activation remain subject to their later release steps.

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

At the hostname/build-policy checkpoint, the runtime application, wallet transforms, contracts, tester gate, public-guide edge function, and calendar function were unchanged. The later administrator release and fixed login return are described above. The preview remains nonindexable, with `Disallow: /` in `robots.txt`. Its 11 critical emitted application files match the verified `a3096b4f4e0d6b357949505f706b4afe88f85009` review build byte for byte.

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
