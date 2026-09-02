/**
 * A real multi-turn conversation, then read back as a reload would.
 *
 * Guards three faults that reached production together and looked like
 * one vague "the chat is broken":
 *
 *  - The two rows of a turn were written concurrently and left to the
 *    database's `now()`, so a reply could sort above its own question.
 *  - An assistant turn whose `active_variant_id` had not landed was
 *    dropped from the history *silently*, so the model saw consecutive
 *    user questions and answered all of them at once ("4\n\n20").
 *  - A turn that never finished stayed `streaming` for ever and rendered
 *    as a permanent "Generating…".
 *
 * Each is invisible to a single-turn test, which is why they survived.
 *
 *   npm run dev &
 *   npm run smoke:conversation
 */
import { createClient } from "@supabase/supabase-js";
const URL_=process.env.NEXT_PUBLIC_SUPABASE_URL!, ANON=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF=URL_.replace("https://","").split(".")[0];
const admin=createClient(URL_,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
let fail=0; const ok=(c:boolean,l:string,e="")=>{console.log(`  ${c?"PASS":"*** FAIL"}  ${l}${e?" :: "+e:""}`); if(!c)fail++;};

async function main(){
  const stamp=Date.now(), email=`zz-e2e-${stamp}@example.com`, password=`Ee1!${stamp}abcDE`;
  const { data:c, error } = await admin.auth.admin.createUser({ email, password, email_confirm:true });
  if (error) throw error;
  const uid=c!.user.id;
  try{
    const cl=createClient(URL_,ANON,{auth:{persistSession:false,autoRefreshToken:false}});
    await cl.auth.signInWithPassword({ email, password });
    const { data:s }=await cl.auth.getSession();
    const cookie=`sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(s.session)).toString("base64")}`;

    let convId: string | null = null;
    const asked = ["What is 2 plus 2? Reply with only the number.", "What is 10 plus 10? Reply with only the number.", "What is 100 plus 100? Reply with only the number."];
    const expect = ["4", "20", "200"];
    for (const q of asked) {
      const res: Response = await fetch("http://localhost:3000/api/chat", { method:"POST",
        headers:{cookie,"content-type":"application/json",connection:"close"},
        body: JSON.stringify({ content: q, ...(convId ? { conversationId: convId } : {}) }) });
      convId = res.headers.get("X-Conversation-Id") ?? convId;
      await res.text();
      await new Promise(r=>setTimeout(r,900));
    }
    ok(Boolean(convId), "conversation created");

    // What a reload actually loads.
    const { data: rows } = await admin.from("messages")
      .select("role, content, status, created_at").eq("conversation_id", convId!).order("created_at",{ascending:true});
    const seq = (rows ?? []).map(m => m.role[0]).join("");
    ok(seq === "uauaua", "turns alternate user/assistant after reload", seq);

    const users = (rows ?? []).filter(m => m.role === "user").map(m => m.content);
    ok(JSON.stringify(users) === JSON.stringify(asked), "questions are in the order they were asked", users.join(" | "));

    ok(!(rows ?? []).some(m => m.status === "streaming"), "nothing left stuck on 'Generating…'",
       (rows ?? []).map(m=>m.status).join(","));

    // And the history the model would be handed for the next turn.
    const replies = (rows ?? []).filter(m => m.role === "assistant").map(m => (m.content ?? "").trim());
    console.log("\n  question -> reply");
    replies.forEach((r, i) => {
      const right = r.includes(expect[i]);
      console.log(`    ${asked[i].slice(0,32).padEnd(34)} -> ${JSON.stringify(r.slice(0,40))} ${right ? "correct" : "*** WRONG (expected " + expect[i] + ")"}`);
      if (!right) fail++;
    });
  } finally { await admin.auth.admin.deleteUser(uid).catch(()=>{}); }
  console.log(fail===0?"\n  CONVERSATION INTEGRITY OK":`\n  ${fail} FAILURES`);
  if(fail)process.exitCode=1;
}
main().catch(e=>{console.error("FATAL",e?.message??e);process.exitCode=1;});
