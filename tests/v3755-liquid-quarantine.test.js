'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const sql=read('supabase/migrations/supabase_v3755_free_optimization.sql');
const runtime=read('supabase/migrations/supabase_v3755_runtime_verification.sql');
const rollback=read('supabase/migrations/rollback_v3755_free_optimization.sql');
const edge=read('supabase/functions/nexus-copywriter-v3200/index.ts');

assert.match(sql,/^-- Nexus v3755\.0/);
assert.match(sql,/begin;[\s\S]*statement_timeout='4000ms'/);
assert.match(sql,/lock_timeout='1000ms'/);
assert.match(sql,/liquid\/lfm-2\.5-2\.6b:free/);
assert.match(sql,/catalog_price_zero_verified=true/);
assert.match(sql,/cost_zero_guaranteed',false/);
assert.match(sql,/create table public\.nexus_v3755_pages_quarantine/);
assert.match(sql,/direct_upload_allowed boolean not null default false/);
assert.match(sql,/production_deployed boolean not null default false/);
assert.match(sql,/mismatches integer not null check\(mismatches=31\)/);
assert.match(sql,/jobid=60 and jobname='v360-tg-flush-10s'/);
assert.doesNotMatch(sql,/(insert\s+into|update|delete\s+from)\s+public\.(?:ads|nexus_v370_keyword_source|nexus_shopee_offers)\b/i);

assert.match(runtime,/begin;[\s\S]*statement_timeout='4000ms'/);
assert.match(runtime,/lock_timeout='1000ms'/);
assert.match(runtime,/'v3755_liquid_output_accepted',false/);
assert.match(runtime,/'state','unsafe_shape_rejected'/);
assert.match(runtime,/'fanout','Promise\.allSettled'/);
assert.match(runtime,/'projects_http_200',14/);
assert.match(runtime,/'continuous_groq_guaranteed',false/);
assert.match(runtime,/exception when others then raise/);

assert.match(edge,/NEXUS_V3755_COPY_SECRET/);
assert.match(edge,/liquid\/lfm-2\.5-2\.6b:free/);
assert.match(edge,/Promise\.allSettled\(calls\)/);
assert.match(edge,/groq_result_preferred: true/);
assert.match(edge,/cost_zero_guaranteed: false/);
assert.match(edge,/deterministic_copy_remains_canonical: true/);
assert.match(edge,/publication_claimed: false/);
assert.doesNotMatch(edge,/mistralai\/mistral-7b-instruct:free|qwen\/qwen-2\.5-7b-instruct:free/);

assert.match(rollback,/delete from public\.nexus_v3750_provider_policy where provider='openrouter'and model_id='liquid\/lfm-2\.5-2\.6b:free'/);
assert.doesNotMatch(rollback,/update\s+cron\.job/i);
assert.strictEqual(sha('api/ads/go.js'),'e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716');
assert.strictEqual(sha('edge/jetstream/compose.ts'),'d99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0');
assert.strictEqual(sha('supabase/functions/nexus-copywriter-v3200/compose.ts'),sha('edge/jetstream/compose.ts'));

(async()=>{
  // Local handler execution only: verifies the exact success header without a network request,
  // affiliate redirect, click, publication, or Cloudflare Pages mutation.
  const handler=require(path.join(root,'api/ads/go.js'));
  const req={query:{diag:'1',brand:'shopee',site:'aquitemachadinhos',slot:'produto'},headers:{
    host:'aquitemachadinhos.com.br','user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    'accept-language':'pt-BR,pt;q=0.9','sec-fetch-user':'?1'}};
  const res={headers:{},statusCode:0,body:'',setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},end(v=''){this.body=v;return this;}};
  await handler(req,res);
  assert.strictEqual(res.statusCode,200);
  assert.strictEqual(res.headers['X-Adsterra-Binding'],'pop=bound;sb=bound');
  assert.match(res.body,/modo diagnóstico/);
  console.log('v3755 Liquid/quarantine tests: PASS');
})().catch(e=>{console.error(e);process.exit(1);});
