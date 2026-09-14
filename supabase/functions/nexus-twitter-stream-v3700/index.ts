import {AhoCorasick,Pattern} from './aho.ts';

const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-nexus-v3700-secret','access-control-allow-methods':'GET,POST,OPTIONS'};
const jsonHeaders={...cors,'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
function reply(status:number,body:Record<string,unknown>){return new Response(JSON.stringify(body),{status,headers:jsonHeaders})}
function env(name:string){return Deno.env.get(name)?.trim()??''}
function safeEqual(a:string,b:string){if(!a||!b||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
async function rpc(name:string,payload:Record<string,unknown>={}){
  const url=env('NEXUS_MASTER_URL'),key=env('NEXUS_MASTER_SERVICE_ROLE_KEY');
  if(!url||!key)throw new Error('master_binding_missing');
  const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{authorization:`Bearer ${key}`,apikey:key,'content-type':'application/json'},body:JSON.stringify(payload)});
  const text=await response.text();if(!response.ok)throw new Error(`rpc_${name}_${response.status}`);
  try{return JSON.parse(text)}catch{throw new Error(`rpc_${name}_invalid_json`)}
}
async function sha256(value:string){const data=new TextEncoder().encode(value);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('')}
function localeOf(lang:unknown){const x=String(lang??'').toLowerCase();return x==='pt'?'pt-BR':x==='en'?'en-US':/^[a-z]{2}$/.test(x)?x:'en'}
function scopeOf(rules:unknown):'br_sp_msa'|'us_ny_msa'|null{
  if(!Array.isArray(rules))return null;const tags=rules.map(x=>String((x as Record<string,unknown>)?.tag??''));
  if(tags.includes('nexus-v3700-br-sp-radius'))return 'br_sp_msa';if(tags.includes('nexus-v3700-us-ny-radius'))return 'us_ny_msa';return null;
}
async function copilot(text:string,locale:string,scope:string){
  const base=env('NEXUS_MASTER_URL'),secret=env('NEXUS_V3700_COPILOT_SECRET');if(!base||!secret)return {attempted:false,status:{reason:'copilot_binding_missing'}};
  try{
    const response=await fetch(`${base}/functions/v1/nexus-twitter-copilot-v3700`,{method:'POST',headers:{'content-type':'application/json','x-nexus-v3700-secret':secret},body:JSON.stringify({text:text.slice(0,500),locale,scope})});
    const data=await response.json().catch(()=>({}));
    return {attempted:true,status:{http:response.status,groq:Boolean(data?.providers?.groq?.ok),deepseek:Boolean(data?.providers?.deepseek?.ok),publication_performed:false}};
  }catch{return {attempted:true,status:{http:0,groq:false,deepseek:false,publication_performed:false}}}
}

type Counters={posts_seen:number;matched_posts:number;outbox_rows:number;keepalives:number};
Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method==='GET')return reply(200,{service:'nexus-twitter-stream-v3700',version:'v3700.0',transport:'persistent HTTP stream',rfc6455_websocket:false,full_firehose:false,single_connection_lease:true,bounded_session_max_seconds:90,continuous_24x7_proven:false,publication_performed:false});
  if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(!safeEqual(request.headers.get('x-nexus-v3700-secret')??'',env('NEXUS_V3700_EDGE_SECRET')))return reply(401,{error:'unauthorized'});
  let body:Record<string,unknown>;try{body=await request.json()}catch{return reply(400,{error:'invalid_json'})}
  const duration=Math.trunc(Math.max(5,Math.min(Number(body.duration_seconds)||60,90)));
  const maxEvents=Math.trunc(Math.max(1,Math.min(Number(body.max_events)||25,50)));
  const holderRaw=String(body.holder??'edge-gateway').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,40);
  const holder=holderRaw.length>=2?holderRaw:'edge-gateway';
  const copilotEnabled=body.copilot_preview===true;
  let sessionId='',leaseToken='',bearer='',upstreamHttp=0,finishReason='not_started';
  const counters:Counters={posts_seen:0,matched_posts:0,outbox_rows:0,keepalives:0};
  let acquired=false,buildMs=0,patternCount=0;
  try{
    const lease=await rpc('nexus_v3700_acquire_stream_lease',{p_holder:holder||'edge-gateway',p_seconds:duration});
    if(!lease?.acquired)return reply(409,{version:'v3700.0',error:'single_stream_lease_busy',retry_after_seconds:lease?.retry_after_seconds??1,simultaneous_streams_started:0});
    acquired=true;sessionId=String(lease.session_id);leaseToken=String(lease.lease_token);bearer=String(lease.bearer_token);
    const snapshot=await rpc('nexus_v3700_keyword_snapshot');
    if(Number(snapshot?.count)!==17605||!Array.isArray(snapshot?.patterns)||snapshot.patterns.length!==17605)throw new Error('keyword_snapshot_invariant');
    const patterns:Pattern[]=snapshot.patterns.map((x:Record<string,unknown>)=>({kw:String(x.kw),hash:String(x.hash)}));
    const t0=performance.now();const matcher=new AhoCorasick(patterns);buildMs=performance.now()-t0;patternCount=matcher.patternCount;
    const aborter=new AbortController();const timer=setTimeout(()=>aborter.abort('bounded_session_complete'),duration*1000);
    const response=await fetch('https://api.x.com/2/tweets/search/stream?tweet.fields=created_at,lang',{headers:{authorization:`Bearer ${bearer}`,'user-agent':'nexus-v3700-bounded-http-stream/1.0'},signal:aborter.signal});
    upstreamHttp=response.status;bearer='';
    if(!response.ok||!response.body){finishReason=`upstream_http_${response.status}`;clearTimeout(timer);return reply(502,{version:'v3700.0',error:'x_stream_unavailable',upstream_http:response.status,transport:'persistent HTTP stream',rfc6455_websocket:false,pattern_count:patternCount,aho_build_ms:Number(buildMs.toFixed(3)),connection_established:false,publication_performed:false})}
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';let pending:Record<string,unknown>[]=[];
    const flush=async()=>{if(!pending.length)return;const result=await rpc('nexus_v3700_ingest_matches',{p_session_id:sessionId,p_lease_token:leaseToken,p_events:pending});counters.outbox_rows+=Number(result?.outbox_rows_created??0);pending=[]};
    try{
      while(counters.matched_posts<maxEvents){
        const chunk=await reader.read();if(chunk.done){finishReason='upstream_closed';break}buffer+=decoder.decode(chunk.value,{stream:true});
        let newline:number;
        while((newline=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,newline).replace(/\r$/,'');buffer=buffer.slice(newline+1);
          if(!line.trim()){counters.keepalives++;continue}
          let envelope:Record<string,unknown>;try{envelope=JSON.parse(line)}catch{throw new Error('x_stream_invalid_json')}
          const data=envelope.data as Record<string,unknown>|undefined;if(!data?.id||typeof data.text!=='string')continue;counters.posts_seen++;
          const scope=scopeOf(envelope.matching_rules);if(!scope)continue;
          const matches=matcher.searchAll(data.text,25);if(!matches.length)continue;
          const locale=localeOf(data.lang),provider=copilotEnabled?await copilot(data.text,locale,scope):{attempted:false,status:{disabled:true}};
          pending.push({source_post_id:String(data.id),payload_sha256:await sha256(data.text),rule_scope:scope,locale,
            matched_keyword_hashes:await Promise.all(matches.map(x=>sha256(x.kw))),matched_offer_refs:matches.map(x=>x.hash),
            source_created_at:data.created_at??null,copilot_attempted:provider.attempted,copilot_provider_status:provider.status});
          counters.matched_posts++;if(pending.length>=10)await flush();if(counters.matched_posts>=maxEvents){finishReason='max_events_reached';aborter.abort('max_events_reached');break}
        }
      }
    }catch(error){if(!(error instanceof DOMException&&error.name==='AbortError')&&!String(error).includes('bounded_session_complete'))throw error;if(finishReason==='not_started')finishReason='bounded_duration_complete'}
    finally{clearTimeout(timer);try{await flush()}finally{try{await reader.cancel()}catch{}}}
    if(finishReason==='not_started')finishReason='bounded_duration_complete';
    return reply(200,{version:'v3700.0',session_completed:true,transport:'persistent HTTP stream',rfc6455_websocket:false,upstream_http:upstreamHttp,duration_requested_seconds:duration,pattern_count:patternCount,aho_build_ms:Number(buildMs.toFixed(3)),...counters,copilot_preview_requested:copilotEnabled,publication_performed:false,continuous_24x7_proven:false});
  }catch(error){finishReason=String((error as Error)?.message??'session_error').slice(0,80);return reply(500,{version:'v3700.0',error:'session_failed',reason:finishReason,transport:'persistent HTTP stream',rfc6455_websocket:false,publication_performed:false})}
  finally{
    bearer='';
    if(acquired&&sessionId&&leaseToken){try{await rpc('nexus_v3700_finish_stream_session',{p_session_id:sessionId,p_lease_token:leaseToken,p_stats:{upstream_http:upstreamHttp||null,...counters,finish_reason:finishReason}})}catch{/* lease expires fail-closed; status is later auditable */}}
    leaseToken='';sessionId='';
  }
});
