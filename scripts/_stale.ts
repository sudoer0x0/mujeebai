import { createClient } from "@supabase/supabase-js";
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth:{persistSession:false} });
async function main(){
  const { data } = await a.from("messages").select("id,role,status,content,created_at").eq("status","streaming").order("created_at",{ascending:false}).limit(20);
  console.log(`  assistant rows stuck in "streaming": ${data?.length ?? 0}`);
  for (const m of (data ?? []).slice(0,6)) {
    const ageMin = Math.round((Date.now() - new Date(m.created_at).getTime())/60000);
    console.log(`    ${m.created_at.slice(0,19)}  ${ageMin} min old  content=${JSON.stringify((m.content??"").slice(0,30))}`);
  }
  const { count } = await a.from("messages").select("id",{count:"exact",head:true}).eq("status","streaming");
  console.log(`\n  total across the database: ${count}`);
  console.log("  ^ each of these renders as a permanent 'Generating…' on reload");
}
main();
