import {AhoCorasick,type Pattern}from'./aho.ts';
const RELEASE='v4310.0';
const SECRET=Deno.env.get('NEXUS_V4310_SIGNAL_SECRET')??'';
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')??'';
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const SOURCES=new Set(['synthetic_fixture','operator_export','owned_staging','public_bluesky_event','public_nostr_event']);
let cachedMatcher:AhoCorasick|null=null;
let cachedPatternCount=0;
function reply(status:number,body:Record<string,unknown>){return new Response(JSON.stringify(body),{status,headers:JSON_HEADERS})}
async function digest(value:string){const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return[...new Uint8Array(data)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function sameSecret(a:string,b:string){if(!a||!b)return false;const[x,y]=await Promise.all([digest(a),digest(b)]);let d=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)d|=(x.charCodeAt(i%x.length)^y.charCodeAt(i%y.length));return d===0}
function hasBannedKey(value:unknown):boolean{if(Array.isArray(value))return value.some(hasBannedKey);if(!value||typeof value!=='object')return false;for(const[k,v]of Object.entries(value as Record<string,unknown>)){if(/cookie|session|authorization|password|token|secret|private[_-]?key|residential|human[_-]?emulation/i.test(k))return true;if(hasBannedKey(v))return true}return false}
async function rpc(name:string,payload:Record<string,unknown>){if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('runtime_database_binding_unavailable');const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(4000)});if(!r.ok)throw new Error(`rpc_${name}_${r.status}`);return await r.json()}
async function matcher(){if(cachedMatcher)return cachedMatcher;const snapshot=await rpc('nexus_v3750_keyword_snapshot',{})as Record<string,unknown>;if(Number(snapshot.count)!==17605||!Array.isArray(snapshot.patterns)||snapshot.patterns.length!==17605)throw new Error('keyword_snapshot_invariant');const patterns=(snapshot.patterns as Record<string,unknown>[]).map(x=>({kw:String(x.kw),hash:String(x.hash)}as Pattern));cachedMatcher=new AhoCorasick(patterns);cachedPatternCount=cachedMatcher.patternCount;return cachedMatcher}
function edgeHeaders(request:Request){const cf=(request.headers.get('cf-ipcountry')??'').trim().toUpperCase();const vercel=(request.headers.get('x-vercel-ip-country')??'').trim().toUpperCase();const h:Record<string,string>={};if(cf)h['CF-IPCountry']=cf;if(vercel)h['x-vercel-ip-country']=vercel;return h}
Deno.serve(async(request:Request)=>{
 if(request.method==='GET')return reply(200,{service:'nexus-passive-yield-v4310',version:RELEASE,mode:'bounded_authenticated_edge_signal_ingress',keyword_mappings:17605,matcher_cached_in_volatile_isolate:cachedMatcher!==null,pattern_count:cachedPatternCount,atomic_logged_signal_outbox:true,polling_executor_installed:false,permanent_websocket_runtime:false,websocket_reconnect_loop_installed:false,continuous_24x7_proven:false,reason:'Deno Edge request lifecycle is not a durable process supervisor',publication_performed:false,direct_redirect:false,kv_404_fallback_enabled:false,sub_50ms_guaranteed:false,commission_lossless_guaranteed:false});
 if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
 if(!await sameSecret(request.headers.get('x-nexus-v4310-secret')??'',SECRET))return reply(401,{error:'unauthorized'});
 const length=Number(request.headers.get('content-length')??'0');if(Number.isFinite(length)&&length>131072)return reply(413,{error:'payload_too_large'});
 try{
  const raw=await request.text();if(new TextEncoder().encode(raw).length>131072)return reply(413,{error:'payload_too_large'});const body=JSON.parse(raw)as Record<string,unknown>;if(hasBannedKey(body))return reply(400,{error:'prohibited_credential_or_emulation_field'});
  if(body.action==='route'){
   const trusted=edgeHeaders(request);const fromCdn=Object.keys(trusted).length>0;const signedHint=String(body.country_hint??'').trim().toUpperCase();if(!fromCdn&&/^[A-Z]{2}$/.test(signedHint))trusted['CF-IPCountry']=signedHint;
   const route=await rpc('nexus_v4310_campaign_select',{p_headers:trusted,p_network:String(body.network??'auto'),p_product_url:typeof body.product_url==='string'?body.product_url:null,p_offer_key:typeof body.offer_key==='string'?body.offer_key:null});
   return reply(200,{version:RELEASE,route,geo_source:fromCdn?'cdn_header':'signed_payload_hint',direct_redirect_performed:false,affiliate_click_performed:false,publication_performed:false,country_header_is_context_hint:true,sub_1ms_guaranteed:false,protected_go_modified:false});
  }
  if(body.action!=='signals'||!Array.isArray(body.events)||body.events.length<1||body.events.length>50)return reply(400,{error:'bounded_signals_required'});
  const ac=await matcher();const jobs=(body.events as Record<string,unknown>[]).map(async(event)=>{
   const source=String(event.source_type??'');const eventId=String(event.event_id??'').trim();const text=String(event.text??'');const locale=String(event.locale??'').trim();const countryHint=String(event.country_hint??'').trim().toUpperCase();if(!SOURCES.has(source)||eventId.length<8||text.length<1||text.length>2000||!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)||countryHint&&!/^[A-Z]{2}$/.test(countryHint))throw new Error('invalid_signal_event');
   const matches=ac.searchAll(text,25);if(!matches.length)return null;
   return{source_type:source,source_event_sha256:await digest(`${source}|${eventId}`),locale,country_hint:countryHint||null,matched_keyword_hashes:await Promise.all(matches.map(m=>digest(m.kw))),matched_offer_refs:matches.map(m=>m.hash),provider_states:{}};
  });
  const settled=await Promise.allSettled(jobs);const rejected=settled.filter(x=>x.status==='rejected').length;if(rejected)throw new Error(`signal_batch_rejected_${rejected}`);const signals=settled.flatMap(x=>x.status==='fulfilled'&&x.value?[x.value]:[]);
  const dryRun=body.dry_run===true;let inserted=0,existing=0;if(signals.length&&!dryRun){const batch=await rpc('nexus_v4310_ingest_signal_batch',{p_signals:signals})as Record<string,unknown>;inserted=Number(batch.inserted??0);existing=Number(batch.already_present??0)}
  return reply(200,{version:RELEASE,dry_run:dryRun,events:body.events.length,matched_events:signals.length,ledger_inserted:inserted,already_present:existing,database_writes:!dryRun&&signals.length>0,atomic_database_batch:true,keyword_mappings:cachedPatternCount,fanout:'Promise.allSettled',raw_text_persisted:false,affiliate_url_persisted:false,provider_calls:0,publication_performed:false,affiliate_click_performed:false,background_socket_started:false,continuous_24x7_proven:false});
 }catch(error){return reply(422,{error:error instanceof Error?error.message.slice(0,120):'invalid_request',state:'Sintonizado em Análise',publication_performed:false});}
});
