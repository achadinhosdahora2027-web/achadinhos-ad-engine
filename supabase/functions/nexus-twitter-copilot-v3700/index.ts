const cors={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-nexus-v3700-secret','access-control-allow-methods':'GET,POST,OPTIONS'};
const headers={...cors,'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
function reply(status:number,body:Record<string,unknown>){return new Response(JSON.stringify(body),{status,headers})}
function env(name:string){return Deno.env.get(name)?.trim()??''}
function safeEqual(a:string,b:string){if(!a||!b||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
function clean(value:string){
  const noLinks=value.replace(/https?:\/\/\S+/gi,'').split(/\r?\n/).filter(x=>!/^\s*#(?:publi|ad)\s*$/i.test(x)).join(' ').replace(/\s+/g,' ').trim().slice(0,220);
  const forbidden=/(garantid[oa]|imperd[ií]vel|últim[oa]s? unidades?|compre agora|lucro garantido|vendas? confirmad[ao]s?|todo mundo (?:usa|compra)|residencial verificado)/i;
  return noLinks&&!forbidden.test(noLinks)?noLinks:'';
}
async function provider(url:string,key:string,model:string,prompt:string){
  if(!key)throw new Error('provider_key_missing');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const messages=[{role:'system',content:'Você é um copiloto comercial neutro. Não invente preço, desconto, estoque, prova social, urgência, vendas, cliques, ganhos ou disponibilidade. Não gere links. Não imite usuário orgânico. Responda em uma frase curta e factual.'},{role:'user',content:prompt}];
    const requestBody=url.includes('groq.com')?{model,temperature:0.2,max_completion_tokens:256,reasoning_effort:'low',messages}:{model,temperature:0.2,max_tokens:100,messages};
    const response=await fetch(url,{method:'POST',signal:controller.signal,headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(requestBody)});
    if(!response.ok)throw new Error(`provider_http_${response.status}`);const data=await response.json();const output=clean(String(data?.choices?.[0]?.message?.content??''));if(!output)throw new Error('provider_output_rejected');return output;
  }finally{clearTimeout(timer)}
}
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method==='GET')return reply(200,{service:'nexus-twitter-copilot-v3700',version:'v3700.0',providers:['groq','deepseek'],fanout:'Promise.allSettled',publication_performed:false,links_generated:false,neutral_policy:true});
  if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(!safeEqual(request.headers.get('x-nexus-v3700-secret')??'',env('NEXUS_V3700_COPILOT_SECRET')))return reply(401,{error:'unauthorized'});
  let body:Record<string,unknown>;try{body=await request.json()}catch{return reply(400,{error:'invalid_json'})}
  const text=String(body.text??'').trim(),scope=String(body.scope??''),locale=String(body.locale??'');
  if(!text||text.length>500||!['br_sp_msa','us_ny_msa'].includes(scope)||!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale))return reply(422,{error:'invalid_request'});
  const prompt=`Idioma ${locale}; segmento territorial ${scope}. O post público menciona: ${text}. Sugira uma resposta comercial neutra, sem URL e sem alegações não verificadas.`;
  const names=['groq','deepseek'] as const;
  const settled=await Promise.allSettled([
    provider('https://api.groq.com/openai/v1/chat/completions',env('GROQ_API_KEY'),'openai/gpt-oss-20b',prompt),
    provider('https://api.deepseek.com/chat/completions',env('DEEPSEEK_API_KEY'),'deepseek-chat',prompt)
  ]);
  const disclosure=scope==='us_ny_msa'?'#ad':'#publi';const providers:Record<string,unknown>={};const templates:Record<string,string>={};
  settled.forEach((result,index)=>{const name=names[index];if(result.status==='fulfilled'){providers[name]={ok:true};templates[name]=`${result.value}\n${disclosure}\n{{SHORT_LINK}}`}else providers[name]={ok:false,reason:String(result.reason?.message??'provider_failed').slice(0,60)}});
  const ok=Object.values(providers).some(x=>(x as {ok:boolean}).ok);
  return reply(ok?200:503,{version:'v3700.0',providers,templates,fanout:'Promise.allSettled',disclosure_own_line:true,disclosure_immediately_before_short_link_placeholder:true,links_generated:false,publication_performed:false,neutral_policy:true});
});
