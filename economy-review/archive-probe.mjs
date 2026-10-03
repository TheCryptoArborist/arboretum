import fs from 'node:fs';
const out='economy-review-results/archive-probe';fs.mkdirSync(out,{recursive:true});
const endpoint='https://graphql.mainnet.sui.io/graphql';
const origin='0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b::arboretum::';
async function query(name,query,variables={}){
 if(!query.trim().startsWith('query'))throw Error('Reads only');
 const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();fs.writeFileSync(out+'/'+name+'.json',JSON.stringify(j,null,2));return j;
}
for(const name of ['Query','Object','MoveObject','ObjectFilter','TransactionEffects','ServiceConfig']){
 const j=await query('schema-'+name,'query($name:String!){__type(name:$name){name fields{name args{name type{kind name ofType{kind name ofType{kind name}}}} type{kind name ofType{kind name}}} inputFields{name type{kind name ofType{kind name}}}}}',{name});
 const x=j.data?.__type;console.log(name,JSON.stringify(name==='Query'?x?.fields?.filter(f=>['objects','object','events','scope','checkpoint'].includes(f.name)):x));
}
await query('archives','query($type:String!){objects(first:50,filter:{type:$type}){pageInfo{hasNextPage endCursor} nodes{address version previousTransaction{digest} asMoveObject{contents{json type{repr}}}}}}',{type:origin+'SeasonArchive'});
for(const kind of ['SeasonArchived','SeasonStarted'])await query(kind,'query($type:String!){events(last:50,filter:{type:$type}){pageInfo{hasPreviousPage startCursor} nodes{sequenceNumber contents{json type{repr}} transaction{digest transactionJson effects{status checkpoint{sequenceNumber timestamp}}}}}}',{type:origin+kind});
console.log('Probe complete; no transaction submitted.');
