# First-season Move tests

These tests cover the first start from the confirmed empty Registry shape. The
existing payout suite starts from an already-active fixture; its historical
evidence is retained separately and is not overwritten or rerun by this runner.

The runner compiles the unchanged production sources first. Both module bodies
must match the saved prepublication hashes and the actual version-12 receipt
after only the verified original-package self-address binding. It also checks
all 89 linked framework modules, the pinned compiler/archive hashes and the 238
framework source files. Test code is then appended to a separate generated copy
of `settlement.move`; neither deployed source file is edited.

## Coverage

The 19 focused cases cover:

- Immediate 30-day start and a 24-hour start, including actual `SeasonStarted`
  time, the backdated stored start, the exact end and unchanged empty balances.
- Accepted one-millisecond/30-day duration boundaries; rejection of zero,
  oversized and nonpositive-backdated starts.
- Sender, Registry-bound capability and version checks; existing-start replay,
  stale eligible points and a pre-existing settlement.
- A paid first-season lifecycle at the deployed test prices, followed by direct
  claim, real archive creation, second-season start and the remaining archived
  claim.
- Two current-behavior characterizations of inventory crossing Registry
  boundaries. These passing cases document a production-transition limitation;
  they do not establish an isolation guarantee or implement a correction.

The lifecycle mints test-only inputs totaling 53,000,000 MIST: two plants at
10,000,000 each, a Watering Boost at 20,000,000, and a pool deposit of 13,000,000.
The real entry calls produce a 41,000,000-MIST pool, 11,200,000 transferred to the
treasury wallet, and 800,000 transferred to the developer wallet. The Registry's
own treasury field remains zero. Watering at the actual minimum interval of
21.6 hours produces Seed weights of 31 and 10 GP. The two claims pay 31,000,000
and 10,000,000 MIST; the second claim remains valid after season 2 starts, with
the original archive deadline unchanged.

The inventory cases buy a Tool through one Registry and successfully apply it
to a Seed in another, then buy a Crate through one Registry and successfully
open it against another Registry that has not started a season. Current Tool
and Crate types carry a version but no Registry or price provenance. A separate
mainnet Registry alone therefore does not isolate inventory bought at test
prices from future use under this same module/version.

## Reproduction

Prepare the pinned public toolchain once, then choose a new output directory:

```bash
python3 contract-reconstruction/prepare_toolchain.py \
  --work-dir /tmp/arboretum-season-test-toolchain

python3 settlement-integration/season-test/run-move-tests.py \
  --toolchain /tmp/arboretum-season-test-toolchain/toolchain.json \
  --output /tmp/arboretum-first-season-new-run
```

The [runner](../run-move-tests.py) writes `summary.json`, `production-build.log`
and `first-season-tests.log` to the specified directory. It refuses to reuse an
existing output directory. Compilation and Move VM execution use an empty
keystore, a loopback-only client configuration and blocked HTTP proxies. These
fixtures create no on-chain objects, spend no real SUI and request no wallet
signature. They do not substitute for the separate unsigned mainnet simulation
or eventual owner-wallet acceptance.
