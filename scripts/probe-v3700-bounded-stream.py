#!/usr/bin/env python3
"""Run one bounded X persistent-HTTP probe through the leased master gateway."""
import datetime,json,pathlib,urllib.error,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
SECRET_FILE=pathlib.Path('/home/user/.v3370-protected/v3700-edge-secrets.json')
URL='https://etbxbaaaspdcoiakifbb.supabase.co/functions/v1/nexus-twitter-stream-v3700'
def main():
 secret=json.loads(SECRET_FILE.read_text())['NEXUS_V3700_EDGE_SECRET'];payload={'duration_seconds':20,'max_events':5,'holder':'master-bounded-proof','copilot_preview':False}
 request=urllib.request.Request(URL,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','x-nexus-v3700-secret':secret},method='POST')
 try:
  with urllib.request.urlopen(request,timeout=90) as response:status=response.status;data=json.loads(response.read())
 except urllib.error.HTTPError as error:status=error.code;data=json.loads(error.read() or b'{}')
 secret='';keys=('version','session_completed','transport','rfc6455_websocket','upstream_http','duration_requested_seconds','pattern_count','aho_build_ms','posts_seen','matched_posts','outbox_rows','keepalives','copilot_preview_requested','publication_performed','continuous_24x7_proven','error','reason')
 safe={key:data.get(key) for key in keys if key in data};ok=status==200 and safe.get('upstream_http')==200 and safe.get('pattern_count')==17605 and safe.get('rfc6455_websocket') is False
 evidence={'schema_version':'v3700-bounded-stream-proof-1','verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'result':'pass' if ok else 'fail','edge_http':status,**safe,'simultaneous_x_stream_connections':1 if safe.get('upstream_http')==200 else 0,'stream_connection_closed_before_evidence_write':True,'continuous_connection_active_after_test':False,'secrets_recorded':False}
 (ROOT/'docs/evidencias/v3700-bounded-stream-proof.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence))
 if not ok:raise SystemExit(1)
if __name__=='__main__':main()
