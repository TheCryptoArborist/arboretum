"""Read-only schema/state and purchase inspection. Never signs or executes."""
import datetime,json,pathlib,urllib.request
OUT=pathlib.Path('economy-review-results/live-inspection');OUT.mkdir(parents=True,exist_ok=True)
URL='https://graphql.mainnet.sui.io/graphql'
def query(name,q,variables=None):
    req=urllib.request.Request(URL,data=json.dumps({'query':q,'variables':variables or {}}).encode(),headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=30) as response: body=json.load(response)
        (OUT/(name+'.json')).write_text(json.dumps(body,indent=2)); return body
    except Exception as e:
        (OUT/(name+'.json')).write_text(json.dumps({'readFailed':True,'type':type(e).__name__,'message':str(e)[:300]})); return {}
query('state','''query {chainIdentifier checkpoint {sequenceNumber timestamp}
 registry:object(address:"0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50") {address version asMoveObject {contents {json type {repr}}}}}''')
for name in ['ServiceConfig','MoveModule','MovePackage','TransactionInput','MoveCallCommand','Checkpoint','CheckpointConnection','CheckpointFilter']:
 query('schema-'+name,'''query($name:String!){__type(name:$name){kind name fields{name args{name type{kind name ofType{kind name ofType{kind name}}}} type{kind name ofType{kind name ofType{kind name}}}} inputFields{name type{kind name ofType{kind name ofType{kind name}}}} possibleTypes{name}}}''',{'name':name})
query('recent-purchases','''query($type:String!){events(last:8,filter:{type:$type}){pageInfo{hasPreviousPage startCursor hasNextPage endCursor} nodes{sequenceNumber contents{json type{repr}} transaction{digest transactionJson effects{status checkpoint{sequenceNumber timestamp} balanceChangesJson events(first:50){pageInfo{hasNextPage endCursor} nodes{sequenceNumber contents{json type{repr}}}}}}}}''',{'type':'0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b::arboretum::CratePurchased'})
query('season-events','''query($type:String!){events(last:10,filter:{type:$type}){pageInfo{hasPreviousPage startCursor} nodes{sequenceNumber contents{json type{repr}} transaction{digest effects{status checkpoint{sequenceNumber timestamp}}}}}}''',{'type':'0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b::arboretum::SeasonStarted'})
(OUT/'scope.json').write_text(json.dumps({'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'endpoint':URL,'transactions':0,'walletConnections':0,'purpose':'schema_and_purchase_reads_only'},indent=2))
