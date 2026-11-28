// RoClothes avatar relay — drop-in replacement for https://krulhub.dev/avatar/*
// Implements exactly what RoClothes_perchance.lua expects:
//   POST /avatar/publish  {placeId,jobId,userId,displayName,scriptVersion,updatedAt,bundle,tweaks[,pose][,clone]}
//   GET  /avatar/server?placeId=..&jobId=..&self=..&protocol=2&clones=1[&since=..]  (entries carry pose)
//   POST /avatar/clonepos {placeId,jobId,userId,pos}
//   WS   /avatar/ws?placeId=..&jobId=..  hello/welcome/pub/peer/clone/cpos/bye (peer carries pose)
//   pose = { "Joint|Part": [12 CFrame numbers] } — validated (<=64 joints, finite), stored + forwarded with the avatar.
//
// Run: npm install && node server.js   (needs Node 18+, listens on PORT env or 3000)
// Deploy anywhere Roblox can reach over plain HTTPS/WSS: Render, Fly.io, Railway,
// a VPS, or your own PC with port-forwarding / cloudflared tunnel.
// Then in RoClothes_perchance.lua set: RC_SYNC_BASE = "https://YOUR-HOST"
//
// Notes:
// - In-memory rooms (placeId:jobId). Restart clears them; clients re-publish in seconds.
// - No auth: anyone who knows placeId+jobId can read/write that room. JobIds are
//   unguessable per Roblox server instance, which is the same privacy the old backend had.
// - Caps: 50 users/room, 512KB body, idle users pruned after 60 min (long grace
//   so a dropped connection never wipes outfits; leavers may linger that long).
// - WS heartbeat {t:"tick"} every 25s keeps clients' ~70s silence-detector and any
//   proxy/tunnel idle timeout happy. The script ignores unknown message types.

const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const MAX_USERS_PER_ROOM = 50;
const MAX_BODY_BYTES = 512 * 1024;
const IDLE_PRUNE_MS = 60 * 60 * 1000;
const TOMBSTONE_MS = 60 * 1000;

// roomKey -> { seq, users: Map<userId, Rec>, tombstones: [{userId, at}], ws: Set<ws> }
// Rec = { userId, displayName, scriptVersion, bundle, tweaks, updatedAt, lastSeen, seq, clones: Map<slot, clone>, clonePos }
const rooms = new Map();

function validPlaceId(p) { return typeof p === "string" || typeof p === "number" ? /^[0-9]{1,20}$/.test(String(p)) : false; }
function validJobId(j) { return typeof j === "string" && j.length >= 1 && j.length <= 64 && /^[A-Za-z0-9_.\-]+$/.test(j); }
function validUserId(u) { const n = Number(u); return Number.isSafeInteger(n) && n > 0 && n <= 1e15; }
// pose = { "JointName|PartName": [12 finite CFrame components], ... } (joint snapshot)
function poseOk(p) {
  if (p === null || p === undefined) return true;
  if (typeof p !== "object" || Array.isArray(p)) return false;
  const keys = Object.keys(p);
  if (keys.length > 64) return false;
  for (const k of keys) {
    if (typeof k !== "string" || k.length === 0 || k.length > 80) return false;
    const a = p[k];
    if (!Array.isArray(a) || a.length !== 12) return false;
    for (let i = 0; i < 12; i++) { const n = a[i]; if (typeof n !== "number" || !Number.isFinite(n)) return false; }
  }
  return true;
}
function roomKeyOf(placeId, jobId) {
  if (!validPlaceId(placeId) || !validJobId(String(jobId))) return null;
  const k = String(placeId) + ":" + String(jobId);
  return k.length <= 100 ? k : null;
}
function getRoom(key) {
  let r = rooms.get(key);
  if (!r) { r = { seq: 0, users: new Map(), tombstones: [], ws: new Set() }; rooms.set(key, r); }
  return r;
}
function nowMs() { return Date.now(); }
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) { reject(new Error("too_large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function safeParse(s) {
  if (typeof s !== "string" || s.length === 0 || s.length > MAX_BODY_BYTES) return null;
  try { const v = JSON.parse(s); return (v && typeof v === "object") ? v : null; }
  catch (e) { return null; }
}
function pruneRoom(key, room) {
  const now = nowMs();
  let changed = false;
  for (const [uid, rec] of room.users) {
    if (now - rec.lastSeen > IDLE_PRUNE_MS) {
      room.users.delete(uid);
      room.tombstones.push({ userId: uid, at: now });
      broadcast(room, JSON.stringify({ t: "leave", userId: uid }), null);
      console.log(new Date().toISOString(), "prune", key, "u" + uid, "idle" + Math.round((now - rec.lastSeen) / 1000) + "s");
      changed = true;
    }
  }
  while (room.tombstones.length && now - room.tombstones[0].at > TOMBSTONE_MS) room.tombstones.shift();
  if (room.users.size === 0 && room.ws.size === 0) rooms.delete(key);
  return changed;
}
setInterval(() => {
  for (const [key, room] of rooms) pruneRoom(key, room);
}, 15000);

// Heartbeat: a tiny server->client frame every 25s so clients never hit their
// ~70s receive-silence timeout during long idle stretches, and so proxies /
// tunnels with idle limits keep the socket open. The script updates its
// last-receive clock on any message and ignores unknown types.
setInterval(() => {
  let msg = null;
  for (const room of rooms.values()) {
    if (room.ws.size === 0) continue;
    if (!msg) msg = JSON.stringify({ t: "tick", now: Date.now() });
    broadcast(room, msg, null);
  }
}, 25000);

function presentIds(room) {
  const out = [];
  for (const uid of room.users.keys()) out.push(uid);
  return out.slice(0, MAX_USERS_PER_ROOM);
}
function entriesFor(room, since) {
  const out = [];
  for (const rec of room.users.values()) {
    if (rec.bundle === undefined || rec.bundle === null) continue;
    if (since !== null && since !== undefined && Number.isFinite(since)) {
      if (!(rec.seq > since)) continue;
    }
    out.push({
      userId: rec.userId,
      displayName: rec.displayName || "",
      bundle: rec.bundle,
      tweaks: rec.tweaks === undefined ? null : rec.tweaks,
      pose: rec.pose === undefined ? null : rec.pose,
      updatedAt: rec.updatedAt,
    });
    if (out.length >= MAX_USERS_PER_ROOM) break;
  }
  return out;
}
function broadcast(room, msg, except) {
  for (const ws of room.ws) {
    if (ws === except) continue;
    if (ws.readyState !== 1) continue;
    try { ws.send(msg); } catch (e) {}
  }
}

// ---------- HTTP ----------
async function handlePublish(req, res) {
  let raw;
  try { raw = await readBody(req); } catch (e) { return json(res, 413, { ok: false, error: "too_large" }); }
  const m = safeParse(raw);
  if (!m) return json(res, 400, { ok: false, error: "bad_json" });
  const key = roomKeyOf(m.placeId, m.jobId);
  if (!key || !validUserId(m.userId)) return json(res, 400, { ok: false, error: "bad_params" });
  if (m.bundle !== null && m.bundle !== undefined && typeof m.bundle !== "object") return json(res, 400, { ok: false, error: "bad_bundle" });
  if (m.tweaks !== undefined && m.tweaks !== null && typeof m.tweaks !== "object") return json(res, 400, { ok: false, error: "bad_tweaks" });
  if (!poseOk(m.pose)) return json(res, 400, { ok: false, error: "bad_pose" });
  const updatedAt = Number(m.updatedAt);
  if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0) return json(res, 400, { ok: false, error: "bad_updatedAt" });

  const room = getRoom(key);
  if (!room.users.has(Number(m.userId)) && room.users.size >= MAX_USERS_PER_ROOM) {
    return json(res, 429, { ok: false, error: "room_full" });
  }
  room.seq += 1;
  const uid = Number(m.userId);
  let rec = room.users.get(uid);
  if (!rec) {
    rec = { userId: uid, clones: new Map() };
    room.users.set(uid, rec);
  }
  rec.displayName = typeof m.displayName === "string" ? m.displayName.slice(0, 40) : (rec.displayName || "");
  rec.scriptVersion = typeof m.scriptVersion === "string" ? m.scriptVersion.slice(0, 40) : rec.scriptVersion;
  rec.updatedAt = updatedAt;
  rec.lastSeen = nowMs();
  rec.seq = room.seq;
  if (m.clone && typeof m.clone === "object") {
    // clone publish shares the same endpoint (slot inside clone object)
    const slot = Number(m.clone.slot);
    if (Number.isSafeInteger(slot) && slot >= 1 && slot <= 8) {
      if (m.clone.remove) rec.clones.delete(slot);
      else rec.clones.set(slot, { slot, name: String(m.clone.name || "").slice(0, 32), cf: m.clone.cf, pose: m.clone.pose });
      // keep avatar bundle too if provided
      if (m.bundle !== undefined) rec.bundle = m.bundle;
      if (m.pose !== undefined) rec.pose = m.pose;
      if (m.tweaks !== undefined) rec.tweaks = m.tweaks;
    }
    broadcast(room, JSON.stringify({ t: "clone", ownerId: uid, clone: Object.assign({ slot }, m.clone.remove ? { remove: true } : m.clone) }), null);
  } else {
    rec.bundle = m.bundle;
    rec.tweaks = m.tweaks === undefined ? null : m.tweaks;
    rec.pose = m.pose === undefined ? null : m.pose;
    broadcast(room, JSON.stringify({ t: "peer", peer: { userId: uid, displayName: rec.displayName, bundle: rec.bundle, tweaks: rec.tweaks, pose: rec.pose, updatedAt } }), null);
  }
  console.log(new Date().toISOString(), "pub", key, "u" + uid);
  return json(res, 200, { ok: true });
}

function handlePoll(url, res) {
  const placeId = url.searchParams.get("placeId");
  const jobId = url.searchParams.get("jobId");
  const selfId = Number(url.searchParams.get("self"));
  const sinceRaw = url.searchParams.get("since");
  const key = roomKeyOf(placeId, jobId);
  if (!key) return json(res, 400, { ok: false, error: "bad_params" });
  const room = getRoom(key);
  const since = sinceRaw === null ? null : Number(sinceRaw);
  const now = nowMs();
  // touch self so idle pruning sees pollers as alive
  if (validUserId(selfId) && room.users.has(selfId)) room.users.get(selfId).lastSeen = now;
  const present = presentIds(room);
  const entries = entriesFor(room, Number.isFinite(since) ? since : null).filter((e) => e.userId !== selfId);
  const removed = room.tombstones.filter((t) => t.userId !== selfId).map((t) => t.userId);
  const clones = [];
  const clonePresent = {};
  const clonePos = {};
  for (const rec of room.users.values()) {
    if (rec.userId === selfId) continue;
    if (rec.clones && rec.clones.size) {
      clonePresent[String(rec.userId)] = true;
      for (const [slot, c] of rec.clones) clones.push(Object.assign({ ownerId: rec.userId }, c));
    }
    if (rec.clonePos) clonePos[String(rec.userId)] = rec.clonePos;
  }
  return json(res, 200, {
    ok: true, protocol: 2, now, present, entries, removed,
    cursor: room.seq, clones, clonePresent, clonePos,
  });
}

async function handleClonePos(req, res) {
  let raw;
  try { raw = await readBody(req); } catch (e) { return json(res, 413, { ok: false, error: "too_large" }); }
  const m = safeParse(raw);
  if (!m) return json(res, 400, { ok: false, error: "bad_json" });
  const key = roomKeyOf(m.placeId, m.jobId);
  if (!key || !validUserId(m.userId)) return json(res, 400, { ok: false, error: "bad_params" });
  const room = getRoom(key);
  const rec = room.users.get(Number(m.userId));
  if (rec && m.pos && typeof m.pos === "object") {
    rec.clonePos = m.pos;
    rec.lastSeen = nowMs();
    broadcast(room, JSON.stringify({ t: "cpos", ownerId: Number(m.userId), pos: m.pos }), null);
  }
  return json(res, 200, { ok: true });
}

// ---------- Public live board (dripsync.edgeone.dev is a static page that reads this) ----------
// POST /board/presence {userId, name, fit} — lightweight opt-in heartbeat, separate from avatar sync
// GET  /board/presence -> { ok, count, users: [{name, fit, seen}] } (no userIds ever leave)
const board = new Map(); // userId -> { name, fit, lastSeen }
const BOARD_MAX = 500, BOARD_TTL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = nowMs();
  for (const [uid, r] of board) if (now - r.lastSeen > BOARD_TTL_MS) board.delete(uid);
}, 30000);
async function handleBoardPost(req, res) {
  let raw;
  try { raw = await readBody(req); } catch (e) { return json(res, 413, { ok: false, error: "too_large" }); }
  const m = safeParse(raw);
  if (!m || !validUserId(m.userId)) return json(res, 400, { ok: false, error: "bad_params" });
  if (board.size >= BOARD_MAX && !board.has(Number(m.userId))) return json(res, 429, { ok: false, error: "board_full" });
  let parts = null;
  if (m.parts !== undefined && m.parts !== null) {
    if (!Array.isArray(m.parts) || m.parts.length > 64) return json(res, 400, { ok: false, error: "bad_parts" });
    parts = [];
    for (const p of m.parts) {
      if (!p || typeof p !== "object") return json(res, 400, { ok: false, error: "bad_parts" });
      const e = {};
      if (p.m !== undefined) {
        if (typeof p.m !== "string" || p.m.length > 300 || !/^https:\/\//.test(p.m)) return json(res, 400, { ok: false, error: "bad_parts" });
        e.m = p.m;
      }
      if (p.t !== undefined) {
        if (typeof p.t !== "string" || p.t.length > 300 || !/^https:\/\//.test(p.t)) return json(res, 400, { ok: false, error: "bad_parts" });
        e.t = p.t;
      }
      if (p.cf !== undefined) {
        if (!Array.isArray(p.cf) || p.cf.length !== 12 || !p.cf.every(Number.isFinite)) return json(res, 400, { ok: false, error: "bad_parts" });
        e.cf = p.cf;
      }
      if (p.s !== undefined) {
        if (!Array.isArray(p.s) || p.s.length !== 3 || !p.s.every(Number.isFinite)) return json(res, 400, { ok: false, error: "bad_parts" });
        e.s = p.s;
      }
      if (p.c !== undefined) {
        if (!Array.isArray(p.c) || p.c.length !== 3 || p.c.some((v) => typeof v !== "number" || v < 0 || v > 255)) return json(res, 400, { ok: false, error: "bad_parts" });
        e.c = p.c;
      }
      if (p.tr !== undefined) {
        if (typeof p.tr !== "number" || !Number.isFinite(p.tr)) return json(res, 400, { ok: false, error: "bad_parts" });
        e.tr = p.tr;
      }
      if (p.p !== undefined) {
        if (typeof p.p !== "string" || p.p.length > 40) return json(res, 400, { ok: false, error: "bad_parts" });
        e.p = p.p;
      }
      if (p.n !== undefined) {
        if (typeof p.n !== "string" || p.n.length > 64) return json(res, 400, { ok: false, error: "bad_parts" });
        e.n = p.n;
      }
      if (p.k !== undefined) {
        if (p.k !== "mesh" && p.k !== "box" && p.k !== "block" && p.k !== "ball" && p.k !== "cyl") return json(res, 400, { ok: false, error: "bad_parts" });
        e.k = p.k;
      }
      parts.push(e);
    }
  }
  board.set(Number(m.userId), {
    name: typeof m.name === "string" ? m.name.slice(0, 28) : "?",
    fit: typeof m.fit === "string" ? m.fit.slice(0, 120) : "",
    parts: parts,
    lastSeen: nowMs(),
  });
  return json(res, 200, { ok: true });
}
// ---------- Asset proxy (assetdelivery.roblox.com has no browser CORS; the static
// board page loads catalog meshes/textures through here instead) ----------
// GET /asset?id=123 -> bytes with CORS. Small LRU-ish cache, 8MB cap per asset.
const assetCache = new Map(); // id -> { data: Buffer, type, at }
const ASSET_MAX = 8 * 1024 * 1024, ASSET_CACHE_N = 200, ASSET_TTL_MS = 6 * 3600 * 1000;
function serveAsset(res, hit) {
  res.writeHead(200, {
    "Content-Type": hit.type || "application/octet-stream",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=86400",
    "Content-Length": hit.data.length,
  });
  return res.end(hit.data);
}
async function handleAsset(url, res) {
  const id = url.searchParams.get("id");
  if (!id || !/^\d{1,20}$/.test(id)) return json(res, 400, { ok: false, error: "bad_id" });
  const now = nowMs();
  const hit = assetCache.get(id);
  if (hit && now - hit.at < ASSET_TTL_MS) return serveAsset(res, hit);
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, 20000);
    const r = await fetch("https://assetdelivery.roblox.com/v1/asset/?id=" + id, { signal: ctl.signal });
    clearTimeout(to);
    if (!r.ok) return json(res, 502, { ok: false, error: "upstream" });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > ASSET_MAX) return json(res, 502, { ok: false, error: "bad_size" });
    const type = (r.headers.get("content-type") || "application/octet-stream").split(";")[0].slice(0, 80);
    while (assetCache.size >= ASSET_CACHE_N) assetCache.delete(assetCache.keys().next().value);
    const rec = { data: buf, type, at: now };
    assetCache.set(id, rec);
    return serveAsset(res, rec);
  } catch (e) {
    return json(res, 502, { ok: false, error: "fetch_fail" });
  }
}

function handleBoardGet(res) {  const now = nowMs();
  const users = [];
  for (const r of board.values()) {
    if (now - r.lastSeen > BOARD_TTL_MS) continue;
    users.push({ name: r.name, fit: r.fit, parts: r.parts || null, seen: Math.max(0, Math.round((now - r.lastSeen) / 1000)) });
  }
  users.sort((a, b) => a.seen - b.seen);
  return json(res, 200, { ok: true, count: users.length, users: users.slice(0, BOARD_MAX) });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://x");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }
    if (req.method === "GET" && url.pathname === "/asset") return handleAsset(url, res);
    if (req.method === "POST" && url.pathname === "/board/presence") return await handleBoardPost(req, res);
    if (req.method === "GET" && url.pathname === "/board/presence") return handleBoardGet(res);
    if (req.method === "POST" && url.pathname === "/avatar/publish") return await handlePublish(req, res);
    if (req.method === "GET" && url.pathname === "/avatar/server") return handlePoll(url, res);
    if (req.method === "POST" && url.pathname === "/avatar/clonepos") return await handleClonePos(req, res);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json(res, 200, { ok: true, rooms: rooms.size, name: "roclothes-relay" });
    }
    return json(res, 404, { ok: false, error: "not_found" });
  } catch (e) {
    try { return json(res, 500, { ok: false, error: "internal" }); } catch (e) {}
  }
});

// ---------- WebSocket (same rooms, realtime path) ----------
const wss = new WebSocketServer({ server, path: "/avatar/ws" });
wss.on("connection", (ws, req) => {
  let roomKey = null, room = null, userId = null, displayName = "", welcomed = false;
  try {
    const url = new URL(req.url || "/", "http://x");
    roomKey = roomKeyOf(url.searchParams.get("placeId"), url.searchParams.get("jobId"));
  } catch (e) { roomKey = null; }
  if (!roomKey) {
    try { ws.send(JSON.stringify({ t: "err", code: "bad_place_id", of: "hello" })); } catch (e) {}
    return ws.close(4001, "hello");
  }
  room = getRoom(roomKey);
  ws.on("message", (data) => {
    let raw;
    try { raw = typeof data === "string" ? data : data.toString("utf8"); } catch (e) { return; }
    if (raw === "ping") { try { ws.send("pong"); } catch (e) {} return; }
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_BODY_BYTES) return;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== "object" || typeof m.t !== "string") return;

    if (m.t === "hello") {
      if (!validUserId(m.userId)) {
        try { ws.send(JSON.stringify({ t: "err", code: "bad_user_id", of: "hello" })); } catch (e) {}
        return ws.close(4001, "hello");
      }
      if (!welcomed && room.users.size >= MAX_USERS_PER_ROOM && !room.users.has(Number(m.userId))) {
        try { ws.send(JSON.stringify({ t: "err", code: "room_full", of: "hello" })); } catch (e) {}
        return ws.close(4009, "full");
      }
      userId = Number(m.userId);
      displayName = typeof m.displayName === "string" ? m.displayName.slice(0, 40) : "";
      room.ws.add(ws);
      // ensure user record exists so polling peers see us even before first pub
      let rec = room.users.get(userId);
      if (!rec) { room.seq += 1; rec = { userId, clones: new Map(), seq: room.seq }; room.users.set(userId, rec); }
      rec.displayName = displayName;
      rec.scriptVersion = typeof m.scriptVersion === "string" ? m.scriptVersion.slice(0, 40) : rec.scriptVersion;
      rec.lastSeen = nowMs();
      welcomed = true;
      const peers = entriesFor(room, null).filter((e) => e.userId !== userId);
      const clones = [];
      const clonePresent = {};
      const cpos = [];
      for (const r of room.users.values()) {
        if (r.userId === userId) continue;
        if (r.clones && r.clones.size) {
          clonePresent[String(r.userId)] = true;
          for (const [, c] of r.clones) clones.push(Object.assign({ ownerId: r.userId }, c));
        }
        if (r.clonePos) cpos.push({ ownerId: r.userId, pos: r.clonePos });
      }
      try {
        ws.send(JSON.stringify({
          t: "welcome", now: nowMs(), present: presentIds(room), peers,
          clones, clonePresent, cpos, more: false,
        }));
      } catch (e) {}
      console.log(new Date().toISOString(), "join", roomKey, "u" + userId);
      return;
    }
    if (!welcomed || userId === null) return;
    const rec = room.users.get(userId);
    if (!rec) return;
    rec.lastSeen = nowMs();

    if (m.t === "pub") {
      if (m.bundle !== null && m.bundle !== undefined && typeof m.bundle !== "object") return;
      if (m.tweaks !== undefined && m.tweaks !== null && typeof m.tweaks !== "object") return;
      if (!poseOk(m.pose)) return;
      const updatedAt = Number(m.updatedAt);
      if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0) return;
      room.seq += 1;
      rec.seq = room.seq;
      rec.bundle = m.bundle;
      rec.tweaks = m.tweaks === undefined ? null : m.tweaks;
      rec.pose = m.pose === undefined ? null : m.pose;
      rec.updatedAt = updatedAt;
      broadcast(room, JSON.stringify({ t: "peer", peer: { userId, displayName, bundle: rec.bundle, tweaks: rec.tweaks, pose: rec.pose, updatedAt } }), ws);
      console.log(new Date().toISOString(), "pub-ws", roomKey, "u" + userId);
      return;
    }
    if (m.t === "clone") {
      room.seq += 1; rec.seq = room.seq;
      const slot = Number(m.slot !== undefined ? m.slot : (m.clone && m.clone.slot));
      const cobj = m.clone && typeof m.clone === "object" ? m.clone : m;
      if (Number.isSafeInteger(slot) && slot >= 1 && slot <= 8) {
        rec.clones.set(slot, { slot, name: String(cobj.name || "").slice(0, 32), cf: cobj.cf, pose: cobj.pose });
      }
      broadcast(room, JSON.stringify({ t: "clone", ownerId: userId, clone: Object.assign({ slot }, cobj) }), ws);
      return;
    }
    if (m.t === "cloneRemove") {
      const slot = Number(m.slot);
      if (Number.isSafeInteger(slot)) rec.clones.delete(slot);
      broadcast(room, JSON.stringify({ t: "cloneRemove", ownerId: userId, slot }), ws);
      return;
    }
    if (m.t === "cpos") {
      if (m.pos && typeof m.pos === "object") {
        rec.clonePos = m.pos;
        broadcast(room, JSON.stringify({ t: "cpos", ownerId: userId, pos: m.pos }), ws);
      }
      return;
    }
    if (m.t === "bye" || m.t === "leave") {
      room.users.delete(userId);
      room.tombstones.push({ userId, at: nowMs() });
      room.seq += 1;
      broadcast(room, JSON.stringify({ t: "leave", userId }), ws);
      try { ws.close(1000, "bye"); } catch (e) {}
      return;
    }
  });
  ws.on("close", () => {
    try { if (room) room.ws.delete(ws); } catch (e) {}
    // keep avatar data for HTTP pollers for a bit; only broadcast leave if we had welcomed
    if (room && welcomed && userId !== null) {
      // mark lastSeen now; prune job will tombstone + broadcast if they don't come back
      const rec = room.users.get(userId);
      if (rec) rec.lastSeen = nowMs();
    }
  });
  ws.on("error", () => {});
});

server.listen(PORT, () => console.log("roclothes-relay on :" + PORT));
