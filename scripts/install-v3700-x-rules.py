#!/usr/bin/env python3
"""Idempotently install the two v3700 geotag-radius candidate rules.
Does not open the X stream and never writes the bearer token to output/evidence.
"""
import datetime,hashlib,json,pathlib,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
CREDENTIALS=pathlib.Path('/home/user/.v3370-protected/v3700-twitter-credentials.json')
URL='https://api.x.com/2/tweets/search/stream/rules'
DESIRED=[
 {'value':'point_radius:[-46.6333 -23.5505 40km] -is:retweet','tag':'nexus-v3700-br-sp-radius'},
 {'value':'point_radius:[-74.0060 40.7128 40km] -is:retweet','tag':'nexus-v3700-us-ny-radius'}]

def call(bearer,method='GET',payload=None):
 headers={'Authorization':'Bearer '+bearer,'User-Agent':'nexus-v3700-rule-installer/1.0'};data=None
 if payload is not None:headers['Content-Type']='application/json';data=json.dumps(payload).encode()
 with urllib.request.urlopen(urllib.request.Request(URL,data=data,headers=headers,method=method),timeout=30) as response:
  return response.status,json.loads(response.read() or b'{}')
def main():
 bearer=json.loads(CREDENTIALS.read_text())['bearer_token_v2'];status,before=call(bearer);existing=before.get('data') or []
 allowed={item['tag'] for item in DESIRED}
 if any(item.get('tag') not in allowed for item in existing):raise SystemExit('foreign X stream rules present; fail closed')
 adds=[item for item in DESIRED if not any(row.get('tag')==item['tag'] and row.get('value')==item['value'] for row in existing)]
 post_status=200
 if adds:post_status,_=call(bearer,'POST',{'add':adds})
 status,after=call(bearer);bearer='';rows=after.get('data') or []
 ok=status==200 and len(rows)==2 and all(any(row.get('tag')==item['tag'] and row.get('value')==item['value'] for row in rows) for item in DESIRED)
 evidence={'schema_version':'v3700-x-rules-install-1','verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'result':'pass' if ok else 'fail','rules_before':len(existing),'rules_added':len(adds),'rules_after':len(rows),'get_http':status,'post_http':post_status,'rules':[{'tag':item['tag'],'query':item['value'],'query_sha256':hashlib.sha256(item['value'].encode()).hexdigest(),'location_basis':'geotagged post/place within 40km point radius','city_or_residence_proof':False} for item in DESIRED],'filtered_stream_is_full_firehose':False,'rfc6455_websocket_used':False,'stream_connections_opened':0,'posts_read':0,'secrets_recorded':False}
 (ROOT/'docs/evidencias/v3700-x-rules-install.json').write_text(json.dumps(evidence,indent=2)+'\n')
 print(json.dumps({'result':evidence['result'],'rules_before':evidence['rules_before'],'rules_added':evidence['rules_added'],'rules_after':evidence['rules_after'],'post_http':post_status,'stream_connections_opened':0}))
 if not ok:raise SystemExit(1)
if __name__=='__main__':main()
