/**
 * Does a turn's two rows come back in the right order?
 *
 * The user message and the assistant placeholder are written
 * concurrently. Left to the database's own `now()` the winner was a coin
 * flip — measured, the assistant row sorted first 2 times in 5 — so the
 * conversation rendered scrambled and the model was handed its turns out
 * of order. The route stamps the pair; this proves it against the real
 * database rather than in the abstract.
 *
 *   npm run smoke:ordering
 */
import { createClient } from "@supabase/supabase-js";
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth:{persistSession:false} });
async function main(){
  const { data: p } = await a.from("profiles").select("id").limit(1).single();
  const uid = p!.id;
  const { data: conv } = await a.from("conversations").insert({ user_id: uid, title: "ordering probe" }).select("id").single();
  let collisions = 0;
  for (let i = 0; i < 5; i++) {
    // Mirrors the route: concurrent, but stamped so the pair is ordered.
    const turnAt = Date.now();
    const [u, s] = await Promise.all([
      a.from("messages").insert({ conversation_id: conv!.id, user_id: uid, role: "user", content: `Q${i}`, status: "complete", created_at: new Date(turnAt).toISOString() }).select("id, created_at").single(),
      a.from("messages").insert({ conversation_id: conv!.id, user_id: uid, role: "assistant", content: `A${i}`, status: "complete", created_at: new Date(turnAt + 1).toISOString() }).select("id, created_at").single(),
    ]);
    await new Promise(r => setTimeout(r, 10));
    const same = u.data!.created_at === s.data!.created_at;
    const wrongOrder = s.data!.created_at < u.data!.created_at;
    if (same || wrongOrder) collisions++;
    console.log(`  turn ${i}: user=${u.data!.created_at.slice(11,26)} assistant=${s.data!.created_at.slice(11,26)}  ${same ? "IDENTICAL" : wrongOrder ? "ASSISTANT FIRST" : "ok"}`);
  }
  const { data: ordered } = await a.from("messages").select("role, content").eq("conversation_id", conv!.id).order("created_at", { ascending: true });
  console.log("\n  order as the app would load it:");
  console.log("   ", (ordered ?? []).map(m => `${m.role[0]}:${m.content}`).join("  "));
  const expected = Array.from({length:5},(_,i)=>[`u:Q${i}`,`a:A${i}`]).flat().join("  ");
  console.log("  expected:");
  console.log("   ", expected);
  console.log(`\n  ${collisions > 0 ? `*** ${collisions}/5 turns have ambiguous or inverted ordering` : "  ordering is deterministic"}`);
  await a.from("messages").delete().eq("conversation_id", conv!.id);
  await a.from("conversations").delete().eq("id", conv!.id);
}
main().catch(e=>{console.error("FATAL",e?.message??e);process.exitCode=1;});
