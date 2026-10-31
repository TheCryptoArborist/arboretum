# Arboretum preview under treegrow.xyz

The protected review application has a dedicated Netlify project so it can use a stable hostname under the intended production domain.

| Setting | Value |
| --- | --- |
| Preview hostname | `preview.treegrow.xyz` |
| Tester entrance | `https://preview.treegrow.xyz/tester-access` |
| Netlify project | `arboretum-preview` |
| Netlify site ID | `d425445d-4980-49be-8ab2-12e7527ba281` |
| Default Netlify hostname | `arboretum-preview.netlify.app` |
| Existing production site ID | `a344fb31-10b4-4eea-9562-067d90a39607` |

## Build policy

Netlify calls the primary deployment of each project `production`. The dedicated project's primary deployment is still a protected review, so `scripts/build-policy.mjs` distinguishes the provider's context from the application's deployment role. The exception requires both `NETLIFY=true` and the exact preview site ID above. It also requires `REVIEW_ONLY=true` and settlement activation disabled.

`scripts/build-site.mjs` selects the review builder only for that pinned project. Other projects retain the previous public build sequence and its existing approval checks. The original production site and unknown site IDs cannot run the review builder in production context. Child builders inherit the actual context, and the review report records the dedicated-preview role explicitly. The Python builders use the same policy through a small JSON adapter.

The runtime application, wallet transforms, contracts, tester gate, public-guide edge function, and calendar function are unchanged. The preview remains nonindexable, with `Disallow: /` in `robots.txt`. Its 11 critical emitted application files match the verified `a3096b4f4e0d6b357949505f706b4afe88f85009` review build byte for byte.

## Runtime configuration

The preview project uses `NODE_VERSION=24` in the Builds scope for production context. It has its own `ARBORETUM_TESTER_PASSWORD` and `ARBORETUM_SESSION_SECRET` in the Functions scope for production context, both stored as secrets. The tester code is preserved from the existing review; the session secret is newly generated. No secret belongs in this repository or the published assets.

Bundle both edge functions and `calendar-reminder` with the full source deployment. A static-only upload is insufficient. Existing tester sessions are bound to their hostname, so testers enter the code again on the new hostname.

## DNS connection

The custom domain is assigned to the preview project in Netlify. Add the following record at the authoritative external DNS provider:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| CNAME | `preview` | `arboretum-preview.netlify.app` | Automatic/default |

In Namecheap this is **Domain List → Manage → Advanced DNS → Host Records → Add New Record**. The host field is `preview`. This record does not require replacing the apex or `www` records or changing nameservers.

The custom URL is ready only after DNS resolves to this project and its HTTPS certificate is valid. Until then, the assigned domain is a pending connection, not a verified live address. Verification evidence records the actual deployment and observed DNS/TLS state separately.

## Verification

Focused guard checks:

```sh
node --test scripts/build-policy.test.mjs economy-review/garden-ux.test.mjs economy-review/integration.test.mjs
```

Local simulation of the dedicated Netlify target:

```sh
NETLIFY=true CONTEXT=production SITE_ID=d425445d-4980-49be-8ab2-12e7527ba281 node scripts/build-site.mjs
```

This local simulation does not establish hosted availability. Hosted verification must separately confirm the deployed edge gate, tester login, artifact hashes, disabled transactions, and unchanged original production deploy. A branded hostname is a distinct wallet origin and does not establish wallet-provider clearance.

## Provider references

- [External DNS configuration](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/)
- [Managed HTTPS](https://docs.netlify.com/manage/domains/secure-domains-with-https/https-ssl/)
- [Edge Functions environment variables](https://docs.netlify.com/build/edge-functions/environment-variables/)
