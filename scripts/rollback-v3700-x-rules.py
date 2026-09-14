#!/usr/bin/env python3
"""Explicitly delete only v3700-owned X rules. Not executed by deployment."""
import json,os,pathlib,urllib.request
if os.getenv('NEXUS_V3700_CONFIRM_RULE_DELETE')!='DELETE_V3700_RULES':raise SystemExit('set NEXUS_V3700_CONFIRM_RULE_DELETE=DELETE_V3700_RULES')
credentials=json.loads(pathlib.Path('/home/user/.v3370-protected/v3700-twitter-credentials.json').read_text());bearer=credentials['bearer_token_v2'];url='https://api.x.com/2/tweets/search/stream/rules';headers={'Authorization':'Bearer '+bearer,'User-Agent':'nexus-v3700-rule-rollback/1.0'}
with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=30) as response:data=json.loads(response.read() or b'{}')
owned=[row['id'] for row in data.get('data') or [] if row.get('tag') in {'nexus-v3700-br-sp-radius','nexus-v3700-us-ny-radius'}]
if owned:
 payload=json.dumps({'delete':{'ids':owned}}).encode();headers['Content-Type']='application/json'
 with urllib.request.urlopen(urllib.request.Request(url,data=payload,headers=headers,method='POST'),timeout=30) as response:status=response.status
else:status=200
bearer='';print(json.dumps({'owned_rules_deleted':len(owned),'http':status,'foreign_rules_touched':False,'secrets_recorded':False}))
