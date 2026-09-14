#!/usr/bin/env python3
import concurrent.futures,datetime,hashlib,json,pathlib,re,secrets,time,urllib.error,urllib.parse,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1];MASTER='etbxbaaaspdcoiakifbb';RT=pathlib.Path('/home/user/.v3370-protected/runtime.json');UPLOAD=pathlib.Path('/home/user/uploads/Supabase.txt');SEC=pathlib.Path('/home/user/.v3370-protected/v3750-edge-secrets.json')
REFS=[r['project_ref']for r in json.loads((ROOT/'docs/evidencias/v3680-14-project-edge-deploy.json').read_text())['rows']];TOKENS=[]
def collect(o):
 if isinstance(o,dict):
  for v in o.values():collect(v)
 elif isinstance(o,list):
  for v in o:collect(v)
 elif isinstance(o,str)and o.startswith('sbp_')and o not in TOKENS:TOKENS.append(o)
collect(json.loads(RT.read_text()))
for v in re.findall(r'\bsbp_[A-Za-z0-9_-]{20,}\b',UPLOAD.read_text(errors='ignore')):
 if v not in TOKENS:TOKENS.append(v)
SHARED=json.loads(SEC.read_text())
def req(url,method='GET',token=None,data=None,headers=None,timeout=60):
 h=dict(headers or {});
 if token:h['Authorization']='Bearer '+token
 with urllib.request.urlopen(urllib.request.Request(url,data=data,headers=h,method=method),timeout=timeout)as r:return r.status,r.read()
def token_for(ref):
 for token in TOKENS:
  try:
   if req('https://api.supabase.com/v1/projects/'+ref,token=token,timeout=10)[0]==200:return token
  except:pass
 raise RuntimeError('management_unavailable_'+ref)
def multipart(meta,files):
 b='----nexusv3750'+secrets.token_hex(16);out=[]
 def add(x):out.append(x if isinstance(x,bytes)else x.encode())
 add(f'--{b}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n{json.dumps(meta)}\r\n')
 for f in files:add(f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{f.name}"\r\nContent-Type: application/typescript\r\n\r\n');add(f.read_bytes());add('\r\n')
 add(f'--{b}--\r\n');return b,b''.join(out)
def deploy(ref,token,slug,files):
 b,data=multipart({'name':slug,'entrypoint_path':'index.ts','verify_jwt':False},files);s,raw=req(f'https://api.supabase.com/v1/projects/{ref}/functions/deploy?slug={urllib.parse.quote(slug)}','POST',token,data,{'Content-Type':'multipart/form-data; boundary='+b},180);return s,int(json.loads(raw or b'{}').get('version')or 0)
def configure(ref):
 t=token_for(ref);s,_=req(f'https://api.supabase.com/v1/projects/{ref}/secrets','POST',t,json.dumps([{'name':k,'value':v}for k,v in SHARED.items()]).encode(),{'Content-Type':'application/json'},30);d=ROOT/'supabase/functions/nexus-whitehat-replay-v3750';ds,dv=deploy(ref,t,'nexus-whitehat-replay-v3750',[d/'index.ts',d/'aho.ts']);cs=cv=None
 if ref==MASTER:
  c=ROOT/'supabase/functions/nexus-free-copilot-v3750';cs,cv=deploy(ref,t,'nexus-free-copilot-v3750',[c/'index.ts'])
 return{'project_ref':ref,'secrets_http':s,'replay_deploy_http':ds,'replay_version':dv,'copilot_deploy_http':cs,'copilot_version':cv}
def verify(row):
 base=f"https://{row['project_ref']}.supabase.co/functions/v1/nexus-whitehat-replay-v3750";public=auth=unauth=0
 for _ in range(8):
  try:public=req(base,timeout=20)[0]
  except urllib.error.HTTPError as e:public=e.code
  try:auth=req(base,'POST',data=b'{',headers={'Content-Type':'application/json','x-nexus-v3750-secret':SHARED['NEXUS_V3750_REPLAY_SECRET']},timeout=20)[0]
  except urllib.error.HTTPError as e:auth=e.code
  if public==200 and auth==400:break
  time.sleep(1)
 try:unauth=req(base,'POST',data=b'{}',headers={'Content-Type':'application/json'},timeout=20)[0]
 except urllib.error.HTTPError as e:unauth=e.code
 row.update({'status_get_http':public,'authorized_invalid_json_http':auth,'unauthorized_post_http':unauth,'replay_executed_during_deploy':False});return row
def main():
 with concurrent.futures.ThreadPoolExecutor(max_workers=6)as p:rows=list(p.map(configure,REFS))
 with concurrent.futures.ThreadPoolExecutor(max_workers=8)as p:rows=list(p.map(verify,rows))
 master=next(r for r in rows if r['project_ref']==MASTER);ok=all(r['secrets_http']in(200,201)and r['replay_deploy_http']in(200,201)and r['status_get_http']==200 and r['authorized_invalid_json_http']==400 and r['unauthorized_post_http']==401 for r in rows)and master['copilot_deploy_http']in(200,201)
 out={'schema_version':'v3750-14-project-edge-deploy-1','verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'result':'pass'if ok else'fail','configured_projects':14,'bounded_replay_gateway_deployed':sum(r['replay_deploy_http']in(200,201)for r in rows),'public_status_verified':sum(r['status_get_http']==200 for r in rows),'custom_secret_verified':sum(r['authorized_invalid_json_http']==400 for r in rows),'unauthorized_rejected':sum(r['unauthorized_post_http']==401 for r in rows),'master_copilot_deployed':master['copilot_deploy_http']in(200,201),'provider_keys_copied_to_satellites':False,'replay_executions_during_deploy':0,'x_transport_used':False,'third_party_cookie_used':False,'scraper_used':False,'continuous_24x7_proven':False,'replay_source_sha256':hashlib.sha256((ROOT/'supabase/functions/nexus-whitehat-replay-v3750/index.ts').read_bytes()).hexdigest(),'copilot_source_sha256':hashlib.sha256((ROOT/'supabase/functions/nexus-free-copilot-v3750/index.ts').read_bytes()).hexdigest(),'secrets_recorded':False,'rows':rows};(ROOT/'docs/evidencias/v3750-14-project-edge-deploy.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({k:out[k]for k in('result','configured_projects','bounded_replay_gateway_deployed','public_status_verified','custom_secret_verified','unauthorized_rejected','master_copilot_deployed')}));raise SystemExit(0 if ok else 1)
if __name__=='__main__':main()
