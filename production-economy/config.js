export const PRODUCTION_ECONOMY = Object.freeze({
  version: 1,
  plantingMist: 10_000_000_000n,
  crateMist: Object.freeze({
    0: 5_000_000_000n,
    1: 10_000_000_000n,
    2: 25_000_000_000n,
    3: 50_000_000_000n,
    4: 100_000_000_000n,
    5: 30_000_000_000n,
    6: 30_000_000_000n,
  }),
  supplyDropMist: Object.freeze({
    0: 15_000_000_000n, // Revival Kit
    1: 10_000_000_000n, // Drought Shield
    2: 5_000_000_000n,  // Rain Barrel
    3: 4_000_000_000n,  // Mulch
    4: 2_000_000_000n,  // Watering Boost
  }),
  partnerTreasuryAllocationBps: 1000,
});
export const MIST_PER_SUI = 1_000_000_000n;
export function formatSuiMist(value){
  const n=BigInt(value),whole=n/MIST_PER_SUI,fraction=n%MIST_PER_SUI;
  if(!fraction)return whole.toString();
  return whole+'.'+fraction.toString().padStart(9,'0').replace(/0+$/,'');
}
