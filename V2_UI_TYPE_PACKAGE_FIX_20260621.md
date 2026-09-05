# V2 UI Type Package Fix

The current live upgrade moves transaction calls to package:

```text
0xee2cb50c675bb47de4612e713b2101b3b6a5f66620f146ff57858efc39dd689b
```

Existing and newly created Arboretum object types still resolve under the original package:

```text
0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b
```

The UI now uses `PACKAGE_ID` for Move calls and `TYPE_PACKAGE_ID` for Seed, Tool, Crate, and event queries. This fixes the case where planting succeeds on-chain but the garden does not display the planted Seed.
