export interface Pattern { kw: string; hash: string }
export interface Match { kw: string; hash: string; end: number }
interface Node { next: Map<string,number>; fail:number; out:Pattern[] }

export function normalizeText(value:string):string {
  return String(value??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function wordChar(ch:string|undefined):boolean { return !!ch && /[a-z0-9_]/.test(ch) }

/** Dependency-free, in-memory Aho-Corasick matcher. */
export class AhoCorasick {
  private nodes:Node[]=[{next:new Map(),fail:0,out:[]}];
  readonly patternCount:number;
  constructor(patterns:Pattern[]) {
    this.patternCount=patterns.length;
    for(const p of [...patterns].sort((a,b)=>b.kw.length-a.kw.length)) {
      const kw=normalizeText(p.kw).trim(); if(!kw) continue;
      let u=0;
      for(const ch of kw) {
        let v=this.nodes[u].next.get(ch);
        if(v===undefined){v=this.nodes.length;this.nodes.push({next:new Map(),fail:0,out:[]});this.nodes[u].next.set(ch,v)}
        u=v;
      }
      this.nodes[u].out.push({kw,hash:p.hash});
    }
    const queue:number[]=[];
    for(const v of this.nodes[0].next.values()){this.nodes[v].fail=0;queue.push(v)}
    for(let head=0;head<queue.length;head++){
      const u=queue[head];
      for(const [ch,v] of this.nodes[u].next){
        let f=this.nodes[u].fail;
        while(f!==0&&!this.nodes[f].next.has(ch))f=this.nodes[f].fail;
        const candidate=this.nodes[f].next.get(ch)??0;
        this.nodes[v].fail=candidate===v?0:candidate;
        this.nodes[v].out=this.nodes[v].out.concat(this.nodes[this.nodes[v].fail].out);
        queue.push(v);
      }
    }
  }
  searchAll(input:string,limit=25):Match[]{
    const text=normalizeText(input);let state=0;const found:Match[]=[];const seen=new Set<string>();
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      while(state!==0&&!this.nodes[state].next.has(ch))state=this.nodes[state].fail;
      state=this.nodes[state].next.get(ch)??0;
      for(const p of this.nodes[state].out){
        const start=i-p.kw.length+1;
        if(wordChar(text[start-1])||wordChar(text[i+1]))continue;
        const key=p.kw+'\u0000'+p.hash;if(seen.has(key))continue;seen.add(key);
        found.push({kw:p.kw,hash:p.hash,end:i});
      }
    }
    return found.sort((a,b)=>b.kw.length-a.kw.length).slice(0,Math.max(1,Math.min(limit,25)));
  }
}
