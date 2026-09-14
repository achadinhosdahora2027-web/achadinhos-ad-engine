#!/usr/bin/env python3
"""Deploy bounded v3700 X HTTP-stream gateways without opening a stream.
Reads operator credentials only from protected files; never serializes secret values to evidence.
"""
import concurrent.futures,datetime,hashlib,json,mimetypes,pathlib,re,secrets,time,urllib.error,urllib.parse,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
MASTER='etbxbaaaspdcoiakifbb'
RUNTIME=pathlib.Path('/home/user/.v3370-protected/runtime.json')
SUPABASE_UPLOAD=pathlib.Path('/home/user/uploads/Supabase.txt')
EDGE_SECRETS=pathlib.Path('/home/user/.v3370-protected/v3700-edge-secrets.json')
REFS=[r['project_ref'] for r in json.loads((ROOT/'docs/evidencias/v3680-14-project-edge-deploy.json').read_text())['rows']]
TOKENS=[]
def collect(value):
  if isinstance(value,dict):
    for child in value.values():collect(child)
  elif isinstance(value,list):
    for child in value:collect(child)
  elif isinstance(value,str) and value.startswith('sbp_') and value not in TOKENS:TOKENS.append(value)
collect(json.loads(RUNTIME.read_text()))
for value in re.findall(r'\bsbp_[A-Za-z0-9_-]{20,}\b',SUPABASE_UPLOAD.read_text(errors='replace')):
  if value not in TOKENS:TOKENS.append(value)
SHARED=json.loads(EDGE_SECRETS.read_text())

def request(url,method='GET',token=None,data=None,headers=None,timeout=60):
  h=dict(headers or {});
  if token:h['Authorization']='Bearer '+token
  req=urllib.request.Request(url,data=data,headers=h,method=method)
  with urllib.request.urlopen(req,timeout=timeout) as response:return response.status,response.read()
def token_for(ref):
  for token in TOKENS:
    try:
      status,_=request('https://api.supabase.com/v1/projects/'+ref,token=token,timeout=10)
      if status==200:return token
    except Exception:pass
  raise RuntimeError('management_token_unavailable_'+ref)
def multipart(metadata,files):
  boundary='----nexusv3700'+secrets.token_hex(16);chunks=[]
  def add(value):chunks.append(value if isinstance(value,bytes) else value.encode())
  add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n{json.dumps(metadata)}\r\n')
  for file in files:
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file.name}"\r\nContent-Type: application/typescript\r\n\r\n');add(file.read_bytes());add('\r\n')
  add(f'--{boundary}--\r\n');return boundary,b''.join(chunks)
def deploy(ref,token,slug,files):
  boundary,payload=multipart({'name':slug,'entrypoint_path':'index.ts','verify_jwt':False},files)
  status,body=request(f'https://api.supabase.com/v1/projects/{ref}/functions/deploy?slug={urllib.parse.quote(slug)}','POST',token,payload,{'Content-Type':'multipart/form-data; boundary='+boundary},180)
  result=json.loads(body or b'{}');return status,int(result.get('version') or 0)
def configure(ref):
  token=token_for(ref);payload=json.dumps([{'name':name,'value':value} for name,value in SHARED.items()]).encode()
  status,_=request(f'https://api.supabase.com/v1/projects/{ref}/secrets','POST',token,payload,{'Content-Type':'application/json'},30)
  stream_dir=ROOT/'supabase/functions/nexus-twitter-stream-v3700';deploy_status,version=deploy(ref,token,'nexus-twitter-stream-v3700',[stream_dir/'index.ts',stream_dir/'aho.ts'])
  copilot_status=None;copilot_version=None
  if ref==MASTER:
    copilot_dir=ROOT/'supabase/functions/nexus-twitter-copilot-v3700';copilot_status,copilot_version=deploy(ref,token,'nexus-twitter-copilot-v3700',[copilot_dir/'index.ts'])
  return {'project_ref':ref,'secrets_http':status,'stream_deploy_http':deploy_status,'stream_version':version,'copilot_deploy_http':copilot_status,'copilot_version':copilot_version}

def verify(row):
  ref=row['project_ref'];base=f'https://{ref}.supabase.co/functions/v1/nexus-twitter-stream-v3700';public=auth=None
  for _ in range(8):
    try:public=request(base,timeout=20)[0]
    except urllib.error.HTTPError as e:public=e.code
    try:auth=request(base,'POST',data=b'{',headers={'Content-Type':'application/json','x-nexus-v3700-secret':SHARED['NEXUS_V3700_EDGE_SECRET']},timeout=20)[0]
    except urllib.error.HTTPError as e:auth=e.code
    if public==200 and auth==400:break
    time.sleep(1)
  try:request(base,'POST',data=b'{}',headers={'Content-Type':'application/json'},timeout=20);unauth=200
  except urllib.error.HTTPError as e:unauth=e.code
  row.update({'status_get_http':public,'authorized_invalid_json_http':auth,'unauthorized_post_http':unauth,'stream_opened_during_deploy':False});return row

def main():
  with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:rows=list(pool.map(configure,REFS))
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:rows=list(pool.map(verify,rows))
  ok=all(r['secrets_http']in(200,201)and r['stream_deploy_http']in(200,201)and r['status_get_http']==200 and r['authorized_invalid_json_http']==400 and r['unauthorized_post_http']==401 for r in rows)
  master=next(r for r in rows if r['project_ref']==MASTER);ok=ok and master['copilot_deploy_http']in(200,201)
  evidence={'schema_version':'v3700-14-project-edge-deploy-1','verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'result':'pass' if ok else 'fail','configured_projects':len(rows),'bounded_stream_gateway_deployed':sum(r['stream_deploy_http']in(200,201)for r in rows),'public_status_verified':sum(r['status_get_http']==200 for r in rows),'custom_secret_verified':sum(r['authorized_invalid_json_http']==400 for r in rows),'unauthorized_rejected':sum(r['unauthorized_post_http']==401 for r in rows),'master_copilot_deployed':master['copilot_deploy_http']in(200,201),'provider_keys_copied_to_satellites':False,'x_stream_connections_opened_during_deploy':0,'continuous_24x7_proven':False,'rfc6455_websocket_used':False,'stream_transport':'persistent HTTP','stream_source_sha256':hashlib.sha256((ROOT/'supabase/functions/nexus-twitter-stream-v3700/index.ts').read_bytes()).hexdigest(),'aho_source_sha256':hashlib.sha256((ROOT/'supabase/functions/nexus-twitter-stream-v3700/aho.ts').read_bytes()).hexdigest(),'copilot_source_sha256':hashlib.sha256((ROOT/'supabase/functions/nexus-twitter-copilot-v3700/index.ts').read_bytes()).hexdigest(),'secrets_recorded':False,'rows':rows}
  (ROOT/'docs/evidencias/v3700-14-project-edge-deploy.json').write_text(json.dumps(evidence,indent=2)+'\n')
  print(json.dumps({k:evidence[k] for k in('result','configured_projects','bounded_stream_gateway_deployed','public_status_verified','custom_secret_verified','unauthorized_rejected','master_copilot_deployed','x_stream_connections_opened_during_deploy')}))
  if not ok:raise SystemExit(1)
if __name__=='__main__':main()
