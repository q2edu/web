import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import "./styles.css";
import "./overrides.css";
import "./rooms.css";

const $ = (selector) => document.querySelector(selector);
const screens = [...document.querySelectorAll(".screen")];
const params = new URLSearchParams(location.search);
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
const db = SUPABASE_URL && SUPABASE_PUBLIC_KEY
  ? createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY)
  : null;
const IS_LOCAL_DEMO = import.meta.env.DEV && !db;

const PENDING_KEY = "chiiQuestPendingV3";
const LOCAL_ROOMS_KEY = "chiiQuestRoomsV3";
const LOCAL_RECORDS_KEY = "chiiQuestRecordsV3";
const FIND_SECONDS = 20;
const TAP_SECONDS = 15;
const TOTAL_TARGETS = 14;
const MUSIC_ID = "LzzW_TBL558";

let timerHandle = null;
let musicPlayer = null;
let musicMuted = false;
let realtimeChannels = [];
let adminRecords = [];
let adminRooms = [];
let selectedRoomId = "";
let currentQrLink = "";
let toastTimer = null;
let adminDemo = false;

const state = {
  studentName: "",
  studentClass: "",
  found: 0,
  taps: 0,
  invited: false,
  friendName: "",
  friendPhone: "",
  attemptId: "",
  room: null
};

function showScreen(id) {
  clearTimer();
  screens.forEach((screen) => screen.classList.toggle("active", screen.id === id));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (id === "adminScreen") initAdmin();
}

function clearTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function score() {
  return state.found * 10 + state.taps + (state.invited ? 50 : 0);
}

function refreshScore() {
  $("#scoreDisplay").textContent = score();
}

function uuid() {
  return crypto.randomUUID?.() || "10000000-1000-4000-8000-100000000000".replace(
    /[018]/g,
    (char) => (char ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> char / 4).toString(16)
  );
}

function resetGame() {
  Object.assign(state, {
    studentName: "",
    studentClass: "",
    found: 0,
    taps: 0,
    invited: false,
    friendName: "",
    friendPhone: "",
    attemptId: uuid()
  });
  $("#joinForm").reset();
  $("#bonusForm").reset();
  $("#foundCount").textContent = "0";
  $("#tapCount").textContent = "0";
  refreshScore();
  prepareFind();
  prepareTap();
}

async function resolveRoom() {
  const code = (params.get("room") || (import.meta.env.DEV ? "DEMO01" : ""))
    .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const badge = $("#roomBadge");
  const submit = $("#joinForm button[type=submit]");

  if (!code) {
    badge.className = "room-badge invalid";
    badge.querySelector("small").textContent = "尚未加入房间";
    badge.querySelector("b").textContent = "请扫描老师提供的 QR 码";
    submit.disabled = true;
    return;
  }

  if (IS_LOCAL_DEMO) {
    state.room = getLocalRooms().find((room) => room.code === code && room.status === "active") || null;
  } else if (db) {
    const { data } = await db.from("game_rooms")
      .select("id,code,name,status").eq("code", code).eq("status", "active").maybeSingle();
    state.room = data || null;
  }

  if (state.room) {
    badge.className = "room-badge valid";
    badge.querySelector("small").textContent = `房间代码 ${state.room.code}`;
    badge.querySelector("b").textContent = state.room.name;
    submit.disabled = false;
  } else {
    badge.className = "room-badge invalid";
    badge.querySelector("small").textContent = `房间 ${code} 无法进入`;
    badge.querySelector("b").textContent = db || IS_LOCAL_DEMO ? "房间不存在或已经关闭" : "请先配置 Supabase";
    submit.disabled = true;
  }
}

function runTimer(seconds, element, onEnd) {
  const deadline = performance.now() + seconds * 1000;
  clearTimer();
  const tick = () => {
    const left = Math.max(0, deadline - performance.now());
    element.textContent = (left / 1000).toFixed(1);
    element.classList.toggle("urgent", left <= 5000);
    if (left <= 0) {
      clearTimer();
      onEnd();
    }
  };
  tick();
  timerHandle = setInterval(tick, 80);
}

function prepareFind() {
  const board = $("#findBoard");
  if (!board) return;
  board.innerHTML = "";
  const targets = new Set();
  while (targets.size < TOTAL_TARGETS) targets.add(Math.floor(Math.random() * 48));
  const sprites = [0, 1, 3, 5, 8];

  for (let index = 0; index < 48; index += 1) {
    const cell = document.createElement("div");
    cell.className = "find-cell";
    cell.style.setProperty("--rotate", `${-12 + Math.random() * 24}deg`);
    cell.style.setProperty("--scale", `${0.88 + Math.random() * 0.25}`);
    const mascot = document.createElement("div");
    mascot.className = `sprite sprite-${sprites[Math.floor(Math.random() * sprites.length)]}`;
    cell.appendChild(mascot);

    if (targets.has(index)) {
      const target = document.createElement("button");
      target.className = "target-cookie";
      target.setAttribute("aria-label", "找到星星饼干");
      target.style.left = `${8 + Math.random() * 50}%`;
      target.style.top = `${6 + Math.random() * 48}%`;
      target.innerHTML = '<img src="/assets/star-cookie.png" alt="" draggable="false">';
      target.addEventListener("click", () => findTarget(target));
      cell.appendChild(target);
    }
    board.appendChild(cell);
  }

  $("#findTimer").textContent = "20.0";
  $("#findTimer").classList.remove("urgent");
  $("#findCover").style.display = "grid";
  $("#findCoverTitle").textContent = "20 秒眼力大挑战";
  $("#findCoverText").textContent = "在满满的 Chiikawa 伙伴中，点击藏起来的星星饼干。";
  const button = $("#findCover .primary");
  button.dataset.action = "start-find";
  button.innerHTML = "开始计时 <span>20s</span>";
}

function startFind() {
  state.found = 0;
  refreshScore();
  $("#foundCount").textContent = "0";
  $("#findCover").style.display = "none";
  runTimer(FIND_SECONDS, $("#findTimer"), endFind);
  ensureMusic();
}

function findTarget(target) {
  if (!timerHandle || target.classList.contains("found")) return;
  target.classList.add("found");
  state.found += 1;
  $("#foundCount").textContent = state.found;
  refreshScore();
}

function endFind() {
  document.querySelectorAll(".target-cookie").forEach((target) => { target.disabled = true; });
  $("#findCover").style.display = "grid";
  $("#findCoverTitle").textContent = `找到 ${state.found} 个！`;
  $("#findCoverText").textContent = "完成眼力挑战，特殊任务已经解锁。";
  const button = $("#findCover .primary");
  button.dataset.action = "to-bonus";
  button.innerHTML = "继续特殊任务 <span>→</span>";
  burstStars();
}

function prepareTap() {
  if (!$("#tapCover")) return;
  $("#tapTimer").textContent = "15.0";
  $("#tapTimer").classList.remove("urgent");
  $("#tapCount").textContent = "0";
  $("#tapCover").style.display = "grid";
  $("#tapCoverTitle").textContent = "15 秒手速大挑战";
  $("#tapCoverText").textContent = "不断点击角色；每点一次，乌萨奇就会开心地跳起来！";
  const button = $("#tapCover .primary");
  button.dataset.action = "start-tap";
  button.innerHTML = "开始计时 <span>15s</span>";
}

function startTap() {
  state.taps = 0;
  refreshScore();
  $("#tapCount").textContent = "0";
  $("#tapCover").style.display = "none";
  runTimer(TAP_SECONDS, $("#tapTimer"), endTap);
}

function tapCharacter(event) {
  if (!timerHandle || !$("#tapScreen").classList.contains("active")) return;
  state.taps += 1;
  $("#tapCount").textContent = state.taps;
  refreshScore();
  const character = $("#tapCharacter");
  character.classList.remove("jumping");
  void character.offsetWidth;
  character.classList.add("jumping");
  const effect = document.createElement("span");
  effect.className = "tap-pop";
  effect.textContent = state.taps % 5 === 0 ? "+1 ★" : "✦";
  const rect = $("#tapStage").getBoundingClientRect();
  effect.style.left = `${event.clientX - rect.left}px`;
  effect.style.top = `${event.clientY - rect.top}px`;
  $("#tapStage").appendChild(effect);
  setTimeout(() => effect.remove(), 600);
}

function endTap() {
  $("#tapCover").style.display = "grid";
  $("#tapCoverTitle").textContent = `点击 ${state.taps} 次！`;
  $("#tapCoverText").textContent = state.taps >= 70 ? "手速王出现啦！快看看最终成绩。" : "乌萨奇跳得好开心！来领取成绩卡。";
  const button = $("#tapCover .primary");
  button.dataset.action = "finish";
  button.innerHTML = "查看成绩 <span>★</span>";
  burstStars();
}

function finish() {
  const total = score();
  $("#finalFound").textContent = state.found;
  $("#finalTaps").textContent = state.taps;
  $("#finalScore").textContent = total;
  $("#resultRank").textContent = total >= 190 ? "黄金冒险家" : total >= 120 ? "元气伙伴" : "可爱萌新";
  showScreen("resultScreen");
  submitResult();
  burstStars();
}

function payload() {
  return {
    attemptId: state.attemptId,
    roomCode: state.room?.code,
    studentName: state.studentName,
    studentClass: state.studentClass,
    foundCount: state.found,
    tapCount: state.taps,
    totalScore: score(),
    friendName: state.friendName,
    friendPhone: state.friendPhone,
    friendConsent: state.invited
  };
}

async function sendSubmission(item) {
  if (IS_LOCAL_DEMO) {
    saveLocalRecord(item);
    return { ok: true };
  }
  const response = await fetch("/api/submissions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item)
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "save_failed");
  return response.json();
}

async function submitResult() {
  const status = $("#saveStatus");
  status.className = "save-status";
  status.querySelector("p").textContent = "正在安全保存成绩…";
  const item = payload();
  try {
    await sendSubmission(item);
    status.classList.add("saved");
    status.querySelector("p").textContent = IS_LOCAL_DEMO ? "成绩已保存到本地演示后台" : "成绩已安全保存到云端后台";
    await flushQueue();
  } catch {
    queueSubmission(item);
    status.classList.add("queued");
    status.querySelector("p").textContent = "网络暂不可用，成绩已保存在本机并会自动补传";
  }
}

function pending() { return readLocal(PENDING_KEY, []); }
function queueSubmission(item) {
  const items = pending().filter((entry) => entry.attemptId !== item.attemptId);
  items.push(item);
  localStorage.setItem(PENDING_KEY, JSON.stringify(items));
}
async function flushQueue() {
  if (IS_LOCAL_DEMO) return;
  const failed = [];
  for (const item of pending()) {
    try { await sendSubmission(item); } catch { failed.push(item); }
  }
  localStorage.setItem(PENDING_KEY, JSON.stringify(failed));
}

function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function getLocalRooms() {
  let rooms = readLocal(LOCAL_ROOMS_KEY, []);
  if (!rooms.length) {
    rooms = [{ id: uuid(), code: "DEMO01", name: "本地预览房", status: "active", created_at: new Date().toISOString() }];
    localStorage.setItem(LOCAL_ROOMS_KEY, JSON.stringify(rooms));
  }
  return rooms;
}

function getLocalRecords() { return readLocal(LOCAL_RECORDS_KEY, []); }

function saveLocalRecord(item) {
  const room = getLocalRooms().find((entry) => entry.code === item.roomCode);
  const records = getLocalRecords().filter((entry) => entry.attempt_id !== item.attemptId);
  records.unshift({
    id: uuid(), attempt_id: item.attemptId, room_id: room?.id,
    student_name: item.studentName, student_class: item.studentClass,
    found_count: item.foundCount, tap_count: item.tapCount, total_score: item.totalScore,
    friend_name: item.friendName, friend_phone: item.friendPhone,
    consent_at: new Date().toISOString(), created_at: new Date().toISOString(),
    game_rooms: room ? { name: room.name, code: room.code } : null
  });
  localStorage.setItem(LOCAL_RECORDS_KEY, JSON.stringify(records));
}

async function initAdmin() {
  if (!db) {
    $("#configHint").textContent = "本地预览可直接进入演示后台；部署后填入 Supabase 环境变量即切换为云端。";
    if (!$("#demoAdminButton")) {
      const button = document.createElement("button");
      button.id = "demoAdminButton";
      button.className = "demo-admin";
      button.type = "button";
      button.dataset.action = "demo-admin";
      button.textContent = "进入本地演示后台";
      $("#adminLogin").appendChild(button);
    }
    return;
  }
  const { data } = await db.auth.getSession();
  if (data.session) openDashboard(false);
}

async function login(event) {
  event.preventDefault();
  if (!db) { showToast("本地预览请使用演示后台"); return; }
  $("#loginError").textContent = "";
  const { error } = await db.auth.signInWithPassword({
    email: $("#adminEmail").value.trim(),
    password: $("#adminPassword").value
  });
  if (error) { $("#loginError").textContent = "登录失败，请检查账号或 teacher 权限。"; return; }
  openDashboard(false);
}

async function openDashboard(demo) {
  adminDemo = demo;
  $("#adminLogin").hidden = true;
  $("#dashboard").hidden = false;
  await loadAdminData();
  if (!demo) {
    realtimeChannels.forEach((channel) => db.removeChannel(channel));
    realtimeChannels = [
      db.channel("submissions-live").on("postgres_changes", { event: "*", schema: "public", table: "challenge_submissions" }, loadAdminData).subscribe(),
      db.channel("rooms-live").on("postgres_changes", { event: "*", schema: "public", table: "game_rooms" }, loadAdminData).subscribe()
    ];
  }
}

async function loadAdminData() {
  if (adminDemo) {
    adminRooms = getLocalRooms();
    adminRecords = getLocalRecords();
  } else {
    const [roomsResult, recordsResult] = await Promise.all([
      db.from("game_rooms").select("*").order("created_at", { ascending: false }),
      db.from("challenge_submissions").select("*,game_rooms(name,code)").order("created_at", { ascending: false }).limit(2000)
    ]);
    if (roomsResult.error || recordsResult.error) { showToast("读取失败，请检查 teacher 权限"); return; }
    adminRooms = roomsResult.data || [];
    adminRecords = recordsResult.data || [];
  }
  renderAdmin();
}

function renderAdmin() {
  $("#totalPlayers").textContent = uniqueBest(adminRecords).length;
  $("#totalRooms").textContent = adminRooms.filter((room) => room.status === "active").length;
  $("#averageTaps").textContent = adminRecords.length
    ? Math.round(adminRecords.reduce((sum, record) => sum + record.tap_count, 0) / adminRecords.length)
    : 0;
  renderRooms();
  renderLeaderboards();
}

function renderRooms() {
  $("#roomList").innerHTML = adminRooms.map((room) => {
    const count = adminRecords.filter((record) => record.room_id === room.id).length;
    return `<article class="room-card ${room.status}"><div><span>${room.status === "active" ? "进行中" : "已关闭"}</span><h4>${escapeHtml(room.name)}</h4><p>代码 ${room.code} · ${count} 份成绩</p></div><div><button data-qr="${room.id}">QR 码</button>${room.status === "active" ? `<button class="close-room" data-close-room="${room.id}">关闭</button>` : ""}</div></article>`;
  }).join("") || '<div class="rooms-empty">还没有房间，先开一个吧！</div>';

  const filter = $("#roomFilter");
  const previous = selectedRoomId || filter.value;
  filter.innerHTML = adminRooms.map((room) => `<option value="${room.id}">${escapeHtml(room.name)} (${room.code})</option>`).join("");
  selectedRoomId = adminRooms.some((room) => room.id === previous) ? previous : (adminRooms[0]?.id || "");
  filter.value = selectedRoomId;
}

function uniqueBest(records) {
  const map = new Map();
  records.forEach((record) => {
    const key = `${record.student_name.toLowerCase()}|${record.student_class.toLowerCase()}`;
    if (!map.has(key) || map.get(key).total_score < record.total_score) map.set(key, record);
  });
  return [...map.values()].sort((a, b) => b.total_score - a.total_score || b.tap_count - a.tap_count);
}

function renderLeaderboards() {
  fillRanking($("#globalRows"), $("#globalEmpty"), uniqueBest(adminRecords), true);
  fillRanking($("#roomRows"), $("#roomEmpty"), uniqueBest(adminRecords.filter((record) => record.room_id === selectedRoomId)), false);
}

function fillRanking(tbody, empty, records, showRoom) {
  empty.classList.toggle("show", !records.length);
  tbody.innerHTML = records.map((record, index) => `<tr><td><b class="rank r${index + 1}">${index + 1}</b></td><td><strong>${escapeHtml(record.student_name)}</strong>${showRoom ? `<small>${escapeHtml(record.student_class)}</small>` : ""}</td><td>${showRoom ? escapeHtml(record.game_rooms?.name || "—") : escapeHtml(record.student_class)}</td><td>${record.found_count}</td><td>${record.tap_count}</td><td><b>${record.total_score} ★</b></td></tr>`).join("");
}

async function createRoom(event) {
  event.preventDefault();
  const name = $("#roomName").value.trim();
  if (!name) return;
  const code = generateRoomCode();
  if (adminDemo) {
    const rooms = getLocalRooms();
    rooms.unshift({ id: uuid(), code, name, status: "active", created_at: new Date().toISOString() });
    localStorage.setItem(LOCAL_ROOMS_KEY, JSON.stringify(rooms));
  } else {
    const { data: userData } = await db.auth.getUser();
    const { error } = await db.from("game_rooms").insert({ name, code, created_by: userData.user.id });
    if (error) { showToast("开房失败，请重试"); return; }
  }
  $("#createRoomForm").reset();
  await loadAdminData();
  showToast(`房间 ${code} 已创建`);
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (adminRooms.some((room) => room.code === code));
  return code;
}

async function closeRoom(id) {
  if (adminDemo) {
    const rooms = getLocalRooms();
    const room = rooms.find((entry) => entry.id === id);
    if (room) room.status = "closed";
    localStorage.setItem(LOCAL_ROOMS_KEY, JSON.stringify(rooms));
  } else {
    const { error } = await db.from("game_rooms").update({ status: "closed" }).eq("id", id);
    if (error) { showToast("关闭房间失败"); return; }
  }
  await loadAdminData();
}

async function showQr(id) {
  const room = adminRooms.find((entry) => entry.id === id);
  if (!room) return;
  currentQrLink = `${location.origin}${location.pathname}?room=${room.code}`;
  $("#qrRoomName").textContent = room.name;
  $("#qrRoomCode").textContent = room.code;
  $("#qrModal").hidden = false;
  await QRCode.toCanvas($("#qrCanvas"), currentQrLink, {
    width: 250,
    margin: 2,
    color: { dark: "#3e302b", light: "#fffdf8" }
  });
}

async function logout() {
  realtimeChannels.forEach((channel) => db?.removeChannel(channel));
  realtimeChannels = [];
  if (!adminDemo) await db?.auth.signOut();
  adminDemo = false;
  $("#dashboard").hidden = true;
  $("#adminLogin").hidden = false;
}

function exportCsv() {
  if (!adminRecords.length) { showToast("暂无记录可导出"); return; }
  const rows = [
    ["房间", "房间代码", "学生名字", "班级", "找到饼干", "点击次数", "总分", "朋友名字", "朋友电话", "同意时间", "完成时间"],
    ...adminRecords.map((record) => [
      record.game_rooms?.name || "", record.game_rooms?.code || "", record.student_name,
      record.student_class, record.found_count, record.tap_count, record.total_score,
      record.friend_name, record.friend_phone, record.consent_at, record.created_at
    ])
  ];
  const csv = "\ufeff" + rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `chiikawa-results-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function initMusic() {
  window.onYouTubeIframeAPIReady = () => {
    musicPlayer = new window.YT.Player("youtubePlayer", {
      videoId: MUSIC_ID,
      playerVars: { autoplay: 1, loop: 1, playlist: MUSIC_ID, controls: 0, disablekb: 1, playsinline: 1, rel: 0 },
      events: { onReady: (event) => {
        event.target.setVolume(100);
        event.target.playVideo();
        setTimeout(() => { if (event.target.getPlayerState() !== 1) $("#musicGate").hidden = false; }, 1800);
      } }
    });
  };
  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(script);
}

function ensureMusic() {
  if (!musicPlayer) return;
  musicPlayer.unMute();
  musicPlayer.setVolume(100);
  musicPlayer.playVideo();
  musicMuted = false;
  $("#musicIcon").textContent = "♫";
  $("#musicGate").hidden = true;
}

function toggleMusic() {
  if (!musicPlayer) { showToast("音乐正在加载…"); return; }
  if (musicMuted || musicPlayer.isMuted()) ensureMusic();
  else { musicPlayer.mute(); musicMuted = true; $("#musicIcon").textContent = "×"; }
}

function burstStars() {
  const layer = $("#fxLayer");
  for (let index = 0; index < 16; index += 1) {
    const star = document.createElement("span");
    star.className = "flying-star";
    star.textContent = index % 3 ? "★" : "✦";
    star.style.left = `${5 + Math.random() * 90}%`;
    star.style.animationDelay = `${Math.random() * 0.25}s`;
    layer.appendChild(star);
    setTimeout(() => star.remove(), 1500);
  }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function escapeHtml(value = "") {
  const span = document.createElement("span");
  span.textContent = String(value);
  return span.innerHTML;
}

$("#joinForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.room) { showToast("请先扫描有效的房间 QR 码"); return; }
  state.studentName = $("#studentName").value.trim();
  state.studentClass = $("#studentClass").value.trim();
  state.attemptId = uuid();
  state.found = 0;
  state.taps = 0;
  state.invited = false;
  state.friendName = "";
  state.friendPhone = "";
  prepareFind();
  refreshScore();
  showScreen("findScreen");
  ensureMusic();
});

$("#bonusForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#friendName").value.trim();
  const phone = $("#friendPhone").value.trim();
  if (!name || phone.replace(/\D/g, "").length < 8) { $("#bonusError").textContent = "请填写朋友名字和有效电话号码。"; return; }
  if (!$("#friendConsent").checked) { $("#bonusError").textContent = "请先确认资料使用说明。"; return; }
  state.invited = true;
  state.friendName = name;
  state.friendPhone = phone;
  refreshScore();
  burstStars();
  showScreen("tapScreen");
});

$("#loginForm").addEventListener("submit", login);
$("#createRoomForm").addEventListener("submit", createRoom);
$("#tapCharacter").addEventListener("pointerdown", tapCharacter);
$("#roomFilter").addEventListener("change", (event) => { selectedRoomId = event.target.value; renderLeaderboards(); });

document.addEventListener("click", async (event) => {
  const tab = event.target.closest("[data-tab]")?.dataset.tab;
  if (tab) {
    document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    document.querySelectorAll(".admin-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `${tab}Panel`));
    return;
  }
  const qrId = event.target.closest("[data-qr]")?.dataset.qr;
  if (qrId) { await showQr(qrId); return; }
  const closeId = event.target.closest("[data-close-room]")?.dataset.closeRoom;
  if (closeId) { await closeRoom(closeId); return; }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "home") showScreen("introScreen");
  if (action === "admin") showScreen("adminScreen");
  if (action === "demo-admin") openDashboard(true);
  if (action === "start-find") startFind();
  if (action === "to-bonus") showScreen("bonusScreen");
  if (action === "start-tap") startTap();
  if (action === "finish") finish();
  if (action === "restart") { resetGame(); showScreen("introScreen"); }
  if (action === "export") exportCsv();
  if (action === "logout") logout();
  if (action === "music") toggleMusic();
  if (action === "enable-music") ensureMusic();
  if (action === "close-qr") $("#qrModal").hidden = true;
  if (action === "copy-room-link") { await navigator.clipboard.writeText(currentQrLink); showToast("房间链接已复制"); }
});

window.addEventListener("online", flushQueue);
window.addEventListener("beforeunload", clearTimer);
initMusic();
resetGame();
resolveRoom();
flushQueue();
if (params.has("admin")) showScreen("adminScreen");
if (import.meta.env.DEV && params.get("preview") === "find") showScreen("findScreen");
if (import.meta.env.DEV && params.get("preview") === "tap") showScreen("tapScreen");
if (import.meta.env.DEV && params.get("preview") === "find-live") { showScreen("findScreen"); $("#findCover").style.display = "none"; }
if (import.meta.env.DEV && params.get("preview") === "tap-live") { showScreen("tapScreen"); $("#tapCover").style.display = "none"; }
if (import.meta.env.DEV && params.get("preview") === "admin-demo") { showScreen("adminScreen"); openDashboard(true); }
if (import.meta.env.DEV && params.get("preview") === "qr-demo") {
  showScreen("adminScreen");
  openDashboard(true).then(() => showQr(adminRooms[0]?.id));
}
