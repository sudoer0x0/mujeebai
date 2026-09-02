/**
 * End-to-end check of a real chat turn.
 *
 * Proves the things that were broken in production: the reply is served
 * as SSE (a CDN buffers anything else, which is why answers only appeared
 * after a reload), the stream opens before the model answers, it sends an
 * explicit terminator so the caret can stop, the body arrives in more
 * than one network read, the persisted text matches what streamed, and
 * the user's message is stored exactly once.
 *
 * Not part of `npm run verify`: it calls a live model and spends quota.
 * Run it against a local production build:
 *
 *   npm run build && npm run start &
 *   npm run smoke:chat
 */
import { createClient } from "@supabase/supabase-js";
const URL_=process.env.NEXT_PUBLIC_SUPABASE_URL!, ANON=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF=URL_.replace("https://","").split(".")[0];
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth:{persistSession:false} });
let fails=0; const ok=(c:boolean,l:string,e="")=>{console.log(`  ${c?"PASS":"*** FAIL"}  ${l}${e?" :: "+e:""}`); if(!c)fails++;};
async function main(){
  const stamp=Date.now(), email=`zz-str-${stamp}@example.com`, password=`St1!${stamp}abcDE`;
  const { data:c, error } = await admin.auth.admin.createUser({ email, password, email_confirm:true });
  if (error) throw error;
  const uid=c!.user.id;
  try {
    const cl=createClient(URL_,ANON,{auth:{persistSession:false,autoRefreshToken:false}});
    await cl.auth.signInWithPassword({ email, password });
    const { data:s }=await cl.auth.getSession();
    const cookie=`sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(s.session)).toString("base64")}`;

    const t0=Date.now();
    const res=await fetch("http://localhost:3300/api/chat",{method:"POST",
      headers:{cookie,"content-type":"application/json",connection:"close"},
      body:JSON.stringify({content:"Count from one to five, one number per line."})});
    ok(res.status===200,"200",String(res.status));
    ok((res.headers.get("content-type")??"").includes("text/event-stream"),"served as SSE (CDNs pass this through)",res.headers.get("content-type")??"");
    const msgId=res.headers.get("X-Message-Id"); const convId=res.headers.get("X-Conversation-Id");
    ok(Boolean(msgId&&convId),"message + conversation ids in headers");

    const reader=res.body!.getReader(); const dec=new TextDecoder();
    let buf="", sawOpen=false, sawEnd=false, deltas=0, text="";
    const arrivals: number[] = [];
    while(true){
      const {value,done}=await reader.read(); if(done)break;
      arrivals.push(Date.now()-t0);
      buf+=dec.decode(value,{stream:true});
      const frames=buf.split("\n\n"); buf=frames.pop()??"";
      for(const f of frames){
        if(f.startsWith(": open")) sawOpen=true;
        if(f.includes("event: end")) sawEnd=true;
        const d=f.split("\n").find(l=>l.startsWith("data:"));
        if(d){ try{ const j=JSON.parse(d.slice(5).trim()); if(j.type==="delta"){deltas++; text+=j.text;} }catch{} }
      }
    }
    ok(sawOpen,"stream opens before the model answers (headers flush immediately)");
    ok(sawEnd,"stream sends an explicit terminator (so the caret can stop)");
    // How many deltas the model emits is the model's business — a short
    // answer from a batching provider legitimately arrives as one. What
    // this has to prove is that *our* transport is incremental, which is
    // the number of separate network reads.
    // Distinguish "the app is broken" from "the provider said no".
    // An exhausted OpenRouter free-tier quota produces an empty reply and
    // an error frame, which is the app behaving correctly — reporting it
    // as a failure sends someone hunting for a bug that is not there.
    const rateLimited = buf.includes('"code":"rate_limited"');
    if (rateLimited) {
      console.log("  NOTE  provider returned rate_limited (OpenRouter free-tier quota).");
      console.log("        The transport assertions above still apply; content ones are skipped.");
    }
    if (!rateLimited) ok(deltas>=1,"text deltas received",`${deltas} deltas`);
    ok(arrivals.length>1,"body delivered in multiple network reads (not buffered)",`${arrivals.length} reads`);
    ok(arrivals[0] < arrivals[arrivals.length-1],"reads are spread over time, not flushed at the end",
       `first ${arrivals[0]}ms, last ${arrivals[arrivals.length-1]}ms`);
    if (!rateLimited) ok(text.trim().length>0,"visible text was produced",JSON.stringify(text.slice(0,60)));

    // And the same text is what got persisted — the reload path.
    await new Promise(r=>setTimeout(r,1500));
    const { data:row }=await admin.from("messages").select("content,status").eq("id",msgId!).single();
    ok(
      rateLimited ? row?.status === "error" : row?.status === "complete",
      rateLimited ? "a refused turn is persisted as an error, not left streaming" : "message persisted as complete",
      String(row?.status),
    );
    ok((row?.content??"").trim()===text.trim(),"persisted text matches what streamed");

    // The user's message must appear exactly once in the conversation.
    const { data:msgs }=await admin.from("messages").select("role,content").eq("conversation_id",convId!);
    const userMsgs=(msgs??[]).filter(m=>m.role==="user");
    ok(userMsgs.length===1,"the user's message was stored once, not duplicated",`${userMsgs.length}`);
  } finally { await admin.auth.admin.deleteUser(uid).catch(()=>{}); }
  console.log(fails===0?"\n  CHAT STREAMING OK":`\n  ${fails} FAILURES`);
  if(fails)process.exitCode=1;
}
main().catch(e=>{console.error("FATAL",e?.message??e);process.exitCode=1;});
