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

const PENDING_KEY = "chiiQuestPendingV3";
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
  document.body.classList.toggle("admin-view", id === "adminScreen");
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
  const code = (params.get("room") || "")
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

  if (db) {
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
    badge.querySelector("b").textContent = db ? "房间不存在或已经关闭" : "网站尚未连接 Supabase";
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
    status.querySelector("p").textContent = "成绩已安全保存到云端后台";
    await flushQueue();
  } catch {
    queueSubmission(item);
    status.classList.add("queued");
    status.querySelector("p").textContent = "网络暂不可用，成绩已保存在本机并会自动补传";
  }
}

function pending() { return readQueue(PENDING_KEY, []); }
function queueSubmission(item) {
  const items = pending().filter((entry) => entry.attemptId !== item.attemptId);
  items.push(item);
  localStorage.setItem(PENDING_KEY, JSON.stringify(items));
}
async function flushQueue() {
  const failed = [];
  for (const item of pending()) {
    try { await sendSubmission(item); } catch { failed.push(item); }
  }
  localStorage.setItem(PENDING_KEY, JSON.stringify(failed));
}

function readQueue(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

async function initAdmin() {
  if (!db) {
    $("#configHint").textContent = "网站尚未连接 Supabase，请先设置环境变量并重新部署。";
    return;
  }
  const { data } = await db.auth.getSession();
  if (data.session && data.session.user.app_metadata?.role === "teacher") openDashboard();
  else if (data.session) {
    await db.auth.signOut({ scope: "local" });
    $("#configHint").textContent = "这个账号没有 teacher 权限，请设置权限后重新登录。";
  }
}

async function login(event) {
  event.preventDefault();
  if (!db) { showToast("网站尚未连接 Supabase"); return; }
  $("#loginError").textContent = "";
  const { data, error } = await db.auth.signInWithPassword({
    email: $("#adminEmail").value.trim(),
    password: $("#adminPassword").value
  });
  if (error) { $("#loginError").textContent = "登录失败，请检查邮箱和密码。"; return; }
  if (data.session?.user.app_metadata?.role !== "teacher") {
    await db.auth.signOut({ scope: "local" });
    $("#loginError").textContent = "账号尚未设置 teacher 权限，请先在 Supabase 授权后重新登录。";
    return;
  }
  openDashboard();
}

async function openDashboard() {
  $("#adminLogin").hidden = true;
  $("#dashboard").hidden = false;
  await loadAdminData();
  realtimeChannels.forEach((channel) => db.removeChannel(channel));
  realtimeChannels = [
    db.channel("submissions-live").on("postgres_changes", { event: "*", schema: "public", table: "challenge_submissions" }, loadAdminData).subscribe(),
    db.channel("rooms-live").on("postgres_changes", { event: "*", schema: "public", table: "game_rooms" }, loadAdminData).subscribe()
  ];
}

async function loadAdminData() {
  const [roomsResult, recordsResult] = await Promise.all([
    db.from("game_rooms").select("*").order("created_at", { ascending: false }),
    db.from("challenge_submissions").select("*,game_rooms(name,code)").order("created_at", { ascending: false }).limit(2000)
  ]);
  if (roomsResult.error || recordsResult.error) { showToast("读取失败，请检查 teacher 权限"); return; }
  adminRooms = roomsResult.data || [];
  adminRecords = recordsResult.data || [];
  renderAdmin();
}

function renderAdmin() {
  $("#totalPlayers").textContent = uniqueBest(adminRecords).length;
  $("#totalRooms").textContent = adminRooms.filter((room) => room.status === "active").length;
  $("#averageTaps").textContent = adminRecords.length
    ? Math.round(adminRecords.reduce((sum, record) => sum + record.tap_count, 0) / adminRecords.length)
    : 0;
  $("#missionCount").textContent = adminRecords.filter((record) => record.friend_name && record.friend_phone).length;
  renderRooms();
  renderLeaderboards();
  renderMissions();
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
  const selectedRoom = adminRooms.find((room) => room.id === selectedRoomId);
  $("#selectedRoomLabel").textContent = selectedRoom ? `${selectedRoom.name} · ${selectedRoom.code}` : "尚未选择房间";
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
  const globalRecords = uniqueBest(adminRecords);
  const roomRecords = uniqueBest(adminRecords.filter((record) => record.room_id === selectedRoomId));
  fillRanking($("#globalRows"), $("#globalEmpty"), globalRecords, true);
  fillRanking($("#roomRows"), $("#roomEmpty"), roomRecords, false);
  renderPodium($("#globalPodium"), globalRecords);
  renderPodium($("#roomPodium"), roomRecords);
  const selectedRoom = adminRooms.find((room) => room.id === selectedRoomId);
  $("#selectedRoomLabel").textContent = selectedRoom ? `${selectedRoom.name} · ${selectedRoom.code}` : "尚未选择房间";
}

function fillRanking(tbody, empty, records, showRoom) {
  empty.classList.toggle("show", !records.length);
  tbody.innerHTML = records.map((record, index) => `<tr class="rank-row rank-${Math.min(index + 1, 4)}"><td><b class="rank r${index + 1}">${index + 1}</b></td><td><strong class="player-name">${escapeHtml(record.student_name)}</strong>${showRoom ? `<small>${escapeHtml(record.student_class)}</small>` : ""}</td><td>${showRoom ? escapeHtml(record.game_rooms?.name || "—") : escapeHtml(record.student_class)}</td><td>${record.found_count}</td><td>${record.tap_count}</td><td><b class="score-badge">${record.total_score} ★</b></td></tr>`).join("");
}

function renderPodium(container, records) {
  const medals = ["🥇", "🥈", "🥉"];
  container.innerHTML = records.slice(0, 3).map((record, index) => `<article class="podium-card podium-${index + 1}"><span>${medals[index]}</span><strong>${escapeHtml(record.student_name)}</strong><small>${escapeHtml(record.student_class)}</small><b>${record.total_score} ★</b></article>`).join("");
  container.classList.toggle("empty-podium", records.length === 0);
}

function renderMissions() {
  const records = adminRecords.filter((record) => record.friend_name && record.friend_phone);
  $("#missionEmpty").classList.toggle("show", !records.length);
  $("#missionRows").innerHTML = records.map((record) => `<tr><td><strong>${escapeHtml(record.student_name)}</strong></td><td>${escapeHtml(record.student_class)}</td><td><strong>${escapeHtml(record.game_rooms?.name || "—")}</strong><small>${escapeHtml(record.game_rooms?.code || "")}</small></td><td><strong>${escapeHtml(record.friend_name)}</strong><small class="consent-ok">✓ 已确认同意</small></td><td><span class="phone-value">${escapeHtml(record.friend_phone)}</span></td><td>${formatDateTime(record.created_at)}</td></tr>`).join("");
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

async function toggleRankingsFullscreen() {
  const panel = $("#rankingsPanel");
  if (panel.classList.contains("fullscreen-fallback")) {
    panel.classList.remove("fullscreen-fallback");
    updateFullscreenButton();
    return;
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await panel.requestFullscreen();
  } catch {
    panel.classList.toggle("fullscreen-fallback");
    updateFullscreenButton();
  }
}

function updateFullscreenButton() {
  const expanded = document.fullscreenElement === $("#rankingsPanel") || $("#rankingsPanel").classList.contains("fullscreen-fallback");
  $(".fullscreen-rankings").textContent = expanded ? "✕ 退出全屏" : "⛶ 全屏显示";
}

async function createRoom(event) {
  event.preventDefault();
  const name = $("#roomName").value.trim();
  if (!name) return;
  const code = generateRoomCode();
  const { data: userData } = await db.auth.getUser();
  const { error } = await db.from("game_rooms").insert({ name, code, created_by: userData.user.id });
  if (error) { showToast("开房失败，请重试"); return; }
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
  const { error } = await db.from("game_rooms").update({ status: "closed" }).eq("id", id);
  if (error) { showToast("关闭房间失败"); return; }
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
  await db?.auth.signOut();
  $("#dashboard").hidden = true;
  $("#adminLogin").hidden = false;
}

function exportCsv() {
  if (!adminRecords.length) { showToast("暂无记录可导出"); return; }
  const rows = [
    ["房间", "房间代码", "学生名字", "Form", "找到饼干", "点击次数", "总分", "朋友名字", "朋友电话", "同意时间", "完成时间"],
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
      playerVars: { autoplay: 1, loop: 1, playlist: MUSIC_ID, controls: 0, disablekb: 1, playsinline: 1, rel: 0, origin: location.origin },
      events: { onReady: (event) => {
        event.target.getIframe()?.setAttribute("allow", "autoplay; encrypted-media");
        event.target.unMute();
        event.target.setVolume(100);
        event.target.playVideo();
        setTimeout(() => { if (event.target.getPlayerState() !== 1) $("#musicGate").hidden = false; }, 1800);
      }, onStateChange: (event) => {
        if (event.data === window.YT.PlayerState.PLAYING) $("#musicGate").hidden = true;
      }, onAutoplayBlocked: () => { $("#musicGate").hidden = false; } }
    });
  };
  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(script);
}

function unlockMusicOnFirstInteraction() {
  if (!musicPlayer) return;
  ensureMusic();
  window.removeEventListener("pointerdown", unlockMusicOnFirstInteraction, true);
  window.removeEventListener("keydown", unlockMusicOnFirstInteraction, true);
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
  if (action === "start-find") startFind();
  if (action === "to-bonus") showScreen("bonusScreen");
  if (action === "start-tap") startTap();
  if (action === "finish") finish();
  if (action === "restart") { resetGame(); showScreen("introScreen"); }
  if (action === "export") exportCsv();
  if (action === "fullscreen-rankings") toggleRankingsFullscreen();
  if (action === "logout") logout();
  if (action === "music") toggleMusic();
  if (action === "enable-music") ensureMusic();
  if (action === "close-qr") $("#qrModal").hidden = true;
  if (action === "copy-room-link") { await navigator.clipboard.writeText(currentQrLink); showToast("房间链接已复制"); }
});

window.addEventListener("online", flushQueue);
window.addEventListener("beforeunload", clearTimer);
document.addEventListener("fullscreenchange", updateFullscreenButton);
window.addEventListener("pointerdown", unlockMusicOnFirstInteraction, true);
window.addEventListener("keydown", unlockMusicOnFirstInteraction, true);
initMusic();
resetGame();
resolveRoom();
flushQueue();
if (params.has("admin")) showScreen("adminScreen");
