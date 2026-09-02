/**
 * Do the configured reasoning modes actually hold?
 *
 * The question this answers: `openrouter/free` is a router that picks a
 * different underlying model on every call, so a slot cannot promise
 * anything about thinking on the strength of the model id alone.
 * Measured directly against OpenRouter, `reasoning: {exclude: true}`
 * still returned reasoning in one call out of four.
 *
 * So `exclude` is enforced twice — asked of the provider, and any
 * reasoning it sends anyway is dropped before it leaves the server. This
 * proves the promise end to end, through the real route, with both slots
 * pointed at the *same* router.
 *
 * Not part of `npm run verify`: it spends real model quota.
 *
 *   npm run dev &
 *   npm run smoke:models
 */
import { createClient } from "@supabase/supabase-js";
const URL_=process.env.NEXT_PUBLIC_SUPABASE_URL!, ANON=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF=URL_.replace("https://","").split(".")[0];
const admin=createClient(URL_,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
let fails=0; const ok=(c:boolean,l:string,e="")=>{console.log(`  ${c?"PASS":"*** FAIL"}  ${l}${e?" :: "+e:""}`); if(!c)fails++;};

async function turn(cookie: string, modelSlug: string, attempt = 0): Promise<{status:number;reasoning:number;text:number}> {
  try {
  const res = await fetch("http://localhost:3000/api/chat", { method:"POST",
    headers:{cookie,"content-type":"application/json",connection:"close"},
    body: JSON.stringify({ content: "What is 17*23? Answer with just the number.", modelSlug }) });
  if (res.status !== 200) return { status: res.status, reasoning: 0, text: 0 };
  const reader=res.body!.getReader(); const dec=new TextDecoder(); let buf="";
  while(true){ const {value,done}=await reader.read(); if(done)break; buf+=dec.decode(value,{stream:true}); }
  return {
    status: 200,
    reasoning: (buf.match(/"type":"reasoning_delta"/g)||[]).length,
    text: (buf.match(/"type":"delta"/g)||[]).length,
  };
  } catch (e) {
    // A dev server compiles this route on first hit, which can outlast the
    // default fetch timeout. That is the harness, not the app.
    if (attempt < 2) { await new Promise(r => setTimeout(r, 4000)); return turn(cookie, modelSlug, attempt + 1); }
    throw e;
  }
}

async function main(){
  const stamp=Date.now(), email=`zz-rm-${stamp}@example.com`, password=`Rm1!${stamp}abcDE`;
  const { data:c, error } = await admin.auth.admin.createUser({ email, password, email_confirm:true });
  if (error) throw error;
  const uid=c!.user.id;
  try {
    const cl=createClient(URL_,ANON,{auth:{persistSession:false,autoRefreshToken:false}});
    await cl.auth.signInWithPassword({ email, password });
    const { data:s }=await cl.auth.getSession();
    const cookie=`sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(s.session)).toString("base64")}`;

    console.log("\n  Mujeeb AI Free — configured 'never show thinking'");
    for (let i=0;i<3;i++){
      const r = await turn(cookie, "mujeeb-free");
      ok(r.status===200 && r.reasoning===0, `run ${i+1}: no reasoning reached the client`, `status=${r.status} reasoning=${r.reasoning} text=${r.text}`);
    }

    console.log("\n  Mujeeb AI Reasoning — configured 'always show thinking'");
    const r = await turn(cookie, "mujeeb-reasoning");
    ok(r.status===200 && r.reasoning>0, "reasoning reached the client", `status=${r.status} reasoning=${r.reasoning}`);
  } finally { await admin.auth.admin.deleteUser(uid).catch(()=>{}); }
  console.log(fails===0?"\n  REASONING MODES OK":`\n  ${fails} FAILURES`);
  if(fails)process.exitCode=1;
}
main().catch(e=>{console.error("FATAL",e?.message??e);process.exitCode=1;});
