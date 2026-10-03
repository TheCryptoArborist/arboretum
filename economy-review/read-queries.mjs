/** Fixed GraphQL reads, verified against the current endpoint schema. */
export const READ_QUERIES = Object.freeze({
 archiveObjects:`query PartnerArchives($type:String!,$after:String) {
  objects(first:25,after:$after,filter:{type:$type}) {
   pageInfo {hasNextPage endCursor}
   nodes {address version previousTransaction {digest} asMoveObject {contents {json type {repr}}}}
  }
 }`,
 state:`query PartnerState($registry:SuiAddress!) {
  chainIdentifier checkpoint {sequenceNumber timestamp}
  serviceConfig {availableRange(type:"Query",field:"events",filters:["type","beforeCheckpoint"]) {first {sequenceNumber timestamp} last {sequenceNumber timestamp}}}
  registry:object(address:$registry) {address version asMoveObject {contents {json type {repr}}}}
 }`,
 events:`query PartnerEvents($type:String!,$before:String,$ceiling:UInt53!,$size:Int!) {
  events(last:$size,before:$before,filter:{type:$type,beforeCheckpoint:$ceiling}) {
   pageInfo {hasPreviousPage startCursor}
   nodes {sequenceNumber contents {json type {repr}}
    transaction {digest effects {status checkpoint {sequenceNumber timestamp}}}}
  }
 }`,
 transaction:`query PartnerTransaction($digest:String!,$after:String) {
  transaction(digest:$digest) {digest transactionJson effects {status checkpoint {sequenceNumber timestamp}
   balanceChangesJson
   events(first:50,after:$after) {pageInfo {hasNextPage endCursor} nodes {sequenceNumber contents {json type {repr}}}}
  }}
 }`
});
