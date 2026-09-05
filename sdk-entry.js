// sdk-entry.js — bundle entry point
// Run: npm run build:sdk
// Output: sui-sdk.bundle.js (served as /sui-sdk.bundle.js by your host)
export { getWallets } from '@mysten/wallet-standard';
export { SuiJsonRpcClient as SuiClient } from '@mysten/sui/jsonRpc';
export { Transaction } from '@mysten/sui/transactions';
