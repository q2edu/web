import { createClient } from "@supabase/supabase-js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.SUPABASE_URL || !secretKey) return res.status(503).json({ error: "database_not_configured" });
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}; }
  catch { return res.status(400).json({ error: "invalid_json" }); }
  const attemptId = text(body.attemptId, 64), roomCode = text(body.roomCode, 8).toUpperCase();
  const studentName = text(body.studentName, 30), studentClass = text(body.studentClass, 20);
  const friendName = text(body.friendName, 30) || null, friendPhone = text(body.friendPhone, 20) || null;
  const foundCount = integer(body.foundCount, 0, 14), tapCount = integer(body.tapCount, 0, 1000), totalScore = integer(body.totalScore, 0, 2000);
  const consent = body.friendConsent === true;
  if (!uuidPattern.test(attemptId) || !/^[A-Z0-9]{6,8}$/.test(roomCode) || !studentName || !studentClass || foundCount === null || tapCount === null || totalScore === null) return res.status(400).json({ error: "invalid_submission" });
  if (!friendName || !friendPhone || !consent || friendPhone.replace(/\D/g, "").length < 8) return res.status(400).json({ error: "friend_details_required" });
  if (totalScore !== foundCount * 10 + tapCount + (consent ? 50 : 0)) return res.status(400).json({ error: "invalid_score" });
  const supabase = createClient(process.env.SUPABASE_URL, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: room, error: roomError } = await supabase.from("game_rooms").select("id,status").eq("code", roomCode).maybeSingle();
  if (roomError || !room || room.status !== "active") return res.status(400).json({ error: "invalid_or_closed_room" });
  const record = { attempt_id:attemptId, room_id:room.id, student_name:studentName, student_class:studentClass, found_count:foundCount, tap_count:tapCount, total_score:totalScore, friend_name:friendName, friend_phone:friendPhone, consent_at:new Date().toISOString() };
  const { data, error } = await supabase.from("challenge_submissions").upsert(record, { onConflict: "attempt_id" }).select("id,created_at").single();
  if (error) return res.status(500).json({ error: "database_write_failed" });
  res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok:true, id:data.id, createdAt:data.created_at });
}
function text(value,max){return typeof value==="string"?value.trim().slice(0,max):""}
function integer(value,min,max){const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:null}
