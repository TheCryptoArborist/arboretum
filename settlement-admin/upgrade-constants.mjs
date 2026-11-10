// Pinned type identities from the independently verified approved upgrade.
export const LEGACY_TYPE_ORIGINS = Object.freeze([
  {
    "module": "arboretum",
    "struct": "Registry",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "Sapling",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "Seed",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "Tool",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "Crate",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "AdminCap",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "SeasonArchive",
    "definingId": "0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940"
  },
  {
    "module": "arboretum",
    "struct": "ChallengeBook",
    "definingId": "0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940"
  },
  {
    "module": "arboretum",
    "struct": "CanopyChallenge",
    "definingId": "0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940"
  },
  {
    "module": "arboretum",
    "struct": "ChallengeEntry",
    "definingId": "0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940"
  },
  {
    "module": "arboretum",
    "struct": "SeedPlanted",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "SeedWatered",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "SeedDied",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "SeedRevived",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "SeedAbandoned",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "CratePurchased",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "CrateOpened",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "SupplyDropPurchased",
    "definingId": "0xb6f93eb9efc6a1e6760efc2d5f0e07064ed6e72665ef7401a9047f7889e551d7"
  },
  {
    "module": "arboretum",
    "struct": "RewardClaimed",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "ReferralPaid",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "SaplingMinted",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "SeasonStarted",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "SeasonReset",
    "definingId": "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
  },
  {
    "module": "arboretum",
    "struct": "SeasonArchived",
    "definingId": "0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940"
  },
  {
    "module": "arboretum",
    "struct": "ArchivedRewardClaimed",
    "definingId": "0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940"
  },
  {
    "module": "arboretum",
    "struct": "ArchivedRewardsSwept",
    "definingId": "0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940"
  },
  {
    "module": "arboretum",
    "struct": "ChallengeBookCreated",
    "definingId": "0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940"
  },
  {
    "module": "arboretum",
    "struct": "ChallengeOpened",
    "definingId": "0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940"
  },
  {
    "module": "arboretum",
    "struct": "ChallengeEntered",
    "definingId": "0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940"
  },
  {
    "module": "arboretum",
    "struct": "ChallengeFinalized",
    "definingId": "0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940"
  },
  {
    "module": "arboretum",
    "struct": "ChallengeCanceled",
    "definingId": "0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940"
  },
  {
    "module": "arboretum",
    "struct": "ChallengeEntryRefunded",
    "definingId": "0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940"
  }
].map(Object.freeze));
export const SETTLEMENT_TYPE_NAMES = Object.freeze([
  "AdminCap",
  "ArchivedRewardClaimed",
  "ArchivedRewardsSwept",
  "CanopyChallenge",
  "ChallengeBook",
  "ChallengeBookCreated",
  "ChallengeCanceled",
  "ChallengeEntered",
  "ChallengeEntry",
  "ChallengeEntryRefunded",
  "ChallengeFinalized",
  "ChallengeOpened",
  "Crate",
  "CrateOpened",
  "CratePurchased",
  "GameplayPauseChanged",
  "PoolFunded",
  "ReferralPaid",
  "Registry",
  "RewardClaimed",
  "RewardEntitlementProcessed",
  "RewardSettlementFinalized",
  "Sapling",
  "SaplingMinted",
  "SeasonArchive",
  "SeasonArchived",
  "SeasonReset",
  "SeasonStarted",
  "Seed",
  "SeedAbandoned",
  "SeedDied",
  "SeedPlanted",
  "SeedRevived",
  "SeedWatered",
  "SettlementAdminTransferred",
  "SettlementRegistryCreated",
  "SettlementState",
  "SupplyDropPurchased",
  "Tool"
]);
