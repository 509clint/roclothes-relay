<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DripSync Live — who's wearing what</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "Google Sans", "Product Sans", system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
    background: #0e1015; color: #e8e8ef;
    min-height: 100vh; padding: 40px 20px 80px; text-align: center;
  }
  h1 { font-size: 28px; font-weight: 700; }
  h1 span { color: #60a5fa; }
  .sub { color: #8b93a7; margin-top: 8px; font-size: 14px; }
  .count { margin-top: 18px; font-size: 15px; color: #b9bfce; }
  .count b { color: #fff; }
  #grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 10px; max-width: 1000px; margin: 24px auto 0; text-align: left;
  }
  .card { background: #171a22; border-radius: 10px; padding: 12px 16px; }
  .card .vp {
    width: 100%; height: 190px; border-radius: 8px; background: #0c0e13;
    object-fit: contain; cursor: pointer; display: block;
  }
  .card .name { font-weight: 700; font-size: 16px; margin-top: 10px; }
  .card .fit { color: #9aa1b5; font-size: 13px; margin-top: 4px; word-break: break-word; }
  .card .seen { color: #626b7e; font-size: 12px; margin-top: 6px; }
  .note { color: #626b7e; font-size: 13px; margin-top: 32px; max-width: 620px; margin-left: auto; margin-right: auto; line-height: 1.6; }
  .err { color: #c66; margin-top: 22px; }
  #modal {
    position: fixed; inset: 0; background: rgba(4,5,8,.88); display: none;
    align-items: center; justify-content: center; z-index: 50; padding: 20px;
  }
  #modal.open { display: flex; }
  #mbox {
    background: #171a22; border-radius: 14px; padding: 18px;
    max-width: min(92vw, 640px); width: 100%;
  }
  #mcanvas { width: 100%; height: min(62vh, 560px); display: block; border-radius: 10px; background: #0c0e13; touch-action: none; }
  #mname { font-weight: 700; font-size: 18px; margin-top: 12px; }
  #mfit { color: #9aa1b5; font-size: 13px; margin-top: 4px; }
  #mclose {
    margin-top: 12px; padding: 9px 34px; border: none; border-radius: 9px;
    background: #60a5fa; color: #0b0e14; font: 700 14px "Google Sans", system-ui, sans-serif; cursor: pointer;
  }
</style>
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
} }
</script>
</head>
<body>
  <h1>RoClothes:<span>DripSync</span> Live</h1>
  <div class="sub">everyone sharing their fit right now — tap a viewport to enlarge</div>
  <div class="count"><b id="count">…</b> online</div>
  <div id="grid"></div>
  <div id="msg"></div>
  <div class="note">Opt in from inside the script (you'll get asked once, or flip it in Settings → Privacy → Share my fit with DripSync). Only your display name and current fit are shown — if your display name matches your username it's partially starred out.</div>
  <div id="modal"><div id="mbox">
    <canvas id="mcanvas"></canvas>
    <div id="mname"></div><div id="mfit"></div>
    <button id="mclose">Close</button>
  </div></div>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

var API = "https://roclothes-relay.onrender.com/board/presence";
var grid = document.getElementById("grid");
var countEl = document.getElementById("count");
var msg = document.getElementById("msg");
var modal = document.getElementById("modal");
var mcanvas = document.getElementById("mcanvas");
var mname = document.getElementById("mname");
var mfit = document.getElementById("mfit");
var usersByName = {};
var meshCache = {}, texCache = {};
var thumbRenderer = null, modalRenderer = null, modalControls = null, modalRAF = 0;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function ago(s) {
  if (s < 60) return "seen just now";
  var m = Math.floor(s / 60);
  return "seen " + m + " min ago";
}

/* ---- roblox .mesh v4 parser ---- */
async function fetchMesh(url) {
  if (meshCache[url] !== undefined) return meshCache[url];
  var p = (async function () {
    var r = await fetch(url);
    if (!r.ok) return null;
    var ab = await r.arrayBuffer();
    if (ab.byteLength < 64) return null;
    var dv = new DataView(ab);
    var head = "";
    for (var i = 0; i < 13; i++) head += String.fromCharCode(dv.getUint8(i));
    if (head.indexOf("version 4.0") !== 0) return null;
    var nv = dv.getUint32(17, true);
    if (!nv || nv > 300000) return null;
    var v0 = 37, stride = 40;
    var faceOff = v0 + nv * stride + nv * 16;
    if (faceOff + 4 > ab.byteLength) return null;
    var nf = dv.getUint32(faceOff, true);
    if (!nf || nf > 1000000) return null;
    if (faceOff + 4 + nf * 12 > ab.byteLength) return null;
    var pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    for (var v = 0; v < nv; v++) {
      var o = v0 + v * stride;
      pos[v*3] = dv.getFloat32(o, true); pos[v*3+1] = dv.getFloat32(o+4, true); pos[v*3+2] = dv.getFloat32(o+8, true);
      nrm[v*3] = dv.getFloat32(o+12, true); nrm[v*3+1] = dv.getFloat32(o+16, true); nrm[v*3+2] = dv.getFloat32(o+20, true);
      var uu = dv.getFloat32(o+24, true), vv = dv.getFloat32(o+28, true);
      uv[v*2] = Number.isFinite(uu) ? uu : 0; uv[v*2+1] = Number.isFinite(vv) ? vv : 0;
    }
    var idx = new Uint32Array(nf * 3);
    for (var f = 0; f < nf; f++) {
      for (var k = 0; k < 3; k++) {
        var ix = dv.getUint32(faceOff + 4 + f * 12 + k * 4, true);
        if (ix >= nv) return null;
        idx[f*3+k] = ix;
      }
    }
    return { pos: pos, nrm: nrm, uv: uv, idx: idx };
  })();
  meshCache[url] = p;
  p.then(function (v) { if (!v) meshCache[url] = null; });
  return p;
}

function loadTex(url) {
  if (texCache[url] !== undefined) return texCache[url];
  var p = (async function () {
    var r = await fetch(url);
    if (!r.ok) return null;
    var b = await r.blob();
    var obj = URL.createObjectURL(b);
    try {
      var tex = await new THREE.TextureLoader().loadAsync(obj);
      tex.colorSpace = THREE.SRGBColorSpace;
      return { tex: tex, w: tex.image.width, h: tex.image.height };
    } catch (e) { return null; }
    finally { URL.revokeObjectURL(obj); }
  })();
  texCache[url] = p;
  p.then(function (v) { if (!v) texCache[url] = null; });
  return p;
}

function cfMatrix(cf) {
  var m = new THREE.Matrix4();
  m.set(cf[3], cf[4], cf[5], cf[0], cf[6], cf[7], cf[8], cf[1], cf[9], cf[10], cf[11], cf[2], 0, 0, 0, 1);
  return m;
}

async function buildFigure(parts) {
  var g = new THREE.Group();
  var jobs = parts.map(async function (p) {
    var color = p.c ? new THREE.Color(p.c[0]/255, p.c[1]/255, p.c[2]/255) : new THREE.Color(0xd8d8dc);
    var op = (p.tr == null) ? 1 : Math.max(0, 1 - p.tr);
    var mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.6, metalness: 0.0, transparent: op < 1, opacity: op, side: THREE.DoubleSide });
    var mesh = null;
    if (p.k === "mesh" && p.m) {
      var geo = await fetchMesh(p.m);
      if (!geo) {
        if (!p.s) return null;
        mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
        mesh.scale.set(p.s[0], p.s[1], p.s[2]);
      } else {
        var g2 = new THREE.BufferGeometry();
        g2.setAttribute("position", new THREE.BufferAttribute(geo.pos, 3));
        g2.setAttribute("normal", new THREE.BufferAttribute(geo.nrm, 3));
        var uv = geo.uv.slice();
        if (p.t) {
          var ti = await loadTex(p.t);
          if (ti) {
            var mx = 0;
            for (var i = 0; i < uv.length; i++) { var a = Math.abs(uv[i]); if (a > mx) mx = a; }
            if (mx > 4) { for (var j = 0; j < uv.length; j += 2) { uv[j] /= ti.w; uv[j+1] /= ti.h; } }
            mat.map = ti.tex;
            mat.needsUpdate = true;
          }
        }
        g2.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        g2.setIndex(new THREE.BufferAttribute(geo.idx, 1));
        g2.computeBoundingBox();
        var bb = g2.boundingBox, bs = new THREE.Vector3();
        bb.getSize(bs);
        mesh = new THREE.Mesh(g2, mat);
        if (p.s) mesh.scale.set(p.s[0] / (bs.x || 1), p.s[1] / (bs.y || 1), p.s[2] / (bs.z || 1));
      }
    } else {
      var bg;
      if (p.k === "ball") bg = new THREE.SphereGeometry(0.5, 20, 14);
      else if (p.k === "cyl") { bg = new THREE.CylinderGeometry(0.5, 0.5, 1, 20); bg.rotateZ(Math.PI / 2); }
      else bg = new THREE.BoxGeometry(1, 1, 1);
      mesh = new THREE.Mesh(bg, mat);
      if (p.s) mesh.scale.set(p.s[0], p.s[1], p.s[2]);
    }
    if (!mesh) return null;
    if (p.cf) mesh.applyMatrix4(cfMatrix(p.cf));
    return mesh;
  });
  var meshes = await Promise.all(jobs);
  meshes.forEach(function (m) { if (m) g.add(m); });
  return g.children.length ? g : null;
}

function lightScene(scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3648, 0.9));
  var d = new THREE.DirectionalLight(0xffffff, 1.4);
  d.position.set(3, 5, 4);
  scene.add(d);
  var d2 = new THREE.DirectionalLight(0x88aaff, 0.5);
  d2.position.set(-4, 2, -3);
  scene.add(d2);
}

function frameCamera(cam, obj, w, h) {
  var box = new THREE.Box3().setFromObject(obj);
  var sphere = box.getBoundingSphere(new THREE.Sphere());
  var fov = cam.fov * Math.PI / 180;
  var dist = (sphere.radius / Math.sin(fov / 2)) * 1.05;
  var dir = new THREE.Vector3(0.55, 0.28, 1).normalize();
  cam.position.copy(sphere.center).addScaledVector(dir, dist);
  cam.near = Math.max(0.01, dist / 100);
  cam.far = dist * 20;
  cam.updateProjectionMatrix();
  cam.lookAt(sphere.center);
  return sphere.center;
}

function getThumbRenderer() {
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  }
  return thumbRenderer;
}

async function renderThumb(parts, w, h) {
  try {
    var g = await buildFigure(parts);
    if (!g) return null;
    var r = getThumbRenderer();
    r.setSize(w, h, false);
    r.setPixelRatio(1);
    var scene = new THREE.Scene();
    lightScene(scene);
    scene.add(g);
    var cam = new THREE.PerspectiveCamera(32, w / h, 0.01, 1000);
    frameCamera(cam, g, w, h);
    r.render(scene, cam);
    var url = r.domElement.toDataURL("image/png");
    disposeGroup(g);
    return url;
  } catch (e) { return null; }
}

function disposeGroup(g) {
  g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
}

/* ---- cards + modal ---- */
var modalScene = null, modalCam = null, modalGroup = null, modalUserName = null;

function closeModal() {
  modal.classList.remove("open");
  modalUserName = null;
  if (modalRAF) { cancelAnimationFrame(modalRAF); modalRAF = 0; }
  if (modalControls) { modalControls.dispose(); modalControls = null; }
  if (modalRenderer) { modalRenderer.dispose(); modalRenderer = null; }
  modalScene = null; modalCam = null; modalGroup = null;
}
document.getElementById("mclose").addEventListener("click", closeModal);
modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });

async function openModal(u) {
  if (!u.parts || !u.parts.length) return;
  modalUserName = u.name || "?";
  mname.textContent = modalUserName;
  mfit.textContent = u.fit || "Default avatar";
  modal.classList.add("open");
  var W = mcanvas.clientWidth || 560, H = mcanvas.clientHeight || 480;
  if (modalRenderer) { modalRenderer.dispose(); modalRenderer = null; }
  if (modalControls) { modalControls.dispose(); modalControls = null; }
  modalScene = null; modalCam = null; modalGroup = null;
  try {
    var g = await buildFigure(u.parts);
    if (!g) return;
    if (!modal.classList.contains("open")) { disposeGroup(g); return; }
    var r = new THREE.WebGLRenderer({ canvas: mcanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(W, H, false);
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    modalRenderer = r;
    var scene = new THREE.Scene();
    lightScene(scene);
    scene.add(g);
    modalScene = scene; modalGroup = g;
    var cam = new THREE.PerspectiveCamera(32, W / H, 0.01, 1000);
    modalCam = cam;
    var center = frameCamera(cam, g, W, H);
    var ctl = new OrbitControls(cam, mcanvas);
    ctl.target.copy(center);
    ctl.enableDamping = true;
    ctl.autoRotate = true;
    ctl.autoRotateSpeed = 1.2;
    mcanvas.addEventListener("pointerdown", function off() {
      ctl.autoRotate = false;
      mcanvas.removeEventListener("pointerdown", off);
    });
    modalControls = ctl;
    (function loop() {
      if (!modal.classList.contains("open")) return;
      modalRAF = requestAnimationFrame(loop);
      ctl.update();
      r.render(scene, cam);
    })();
  } catch (e) {
    mfit.textContent = "3D failed: " + (e && e.message);
  }
}

/* live: while the modal is open and the user hasn't grabbed the camera,
   swap in the fresh parts each poll without moving the camera */
function refreshModalFigure(u) {
  if (!modalScene || !modalCam || !modalControls) return;
  buildFigure(u.parts).then(function (g) {
    if (!g || !modal.classList.contains("open") || !modalScene) { if (g) disposeGroup(g); return; }
    if (modalGroup) { modalScene.remove(modalGroup); disposeGroup(modalGroup); }
    modalGroup = g;
    modalScene.add(g);
    var W = mcanvas.clientWidth || 560, H = mcanvas.clientHeight || 480;
    modalControls.target.copy(frameCamera(modalCam, g, W, H));
    mfit.textContent = u.fit || "Default avatar";
  }).catch(function () {});
}

var observer = new IntersectionObserver(function (entries) {
  entries.forEach(function (en) {
    if (!en.isIntersecting) return;
    var img = en.target;
    observer.unobserve(img);
    var u = usersByName[img.getAttribute("data-u")];
    if (!u || !u.parts || !u.parts.length) { img.style.display = "none"; return; }
    renderThumb(u.parts, 480, 340).then(function (url) {
      if (url) img.src = url;
      else img.style.display = "none";
    });
  });
}, { rootMargin: "200px" });

function load() {
  fetch(API, { cache: "no-store" }).then(function (r) {
    if (!r.ok) throw new Error("http " + r.status);
    return r.json();
  }).then(function (d) {
    msg.innerHTML = "";
    var users = (d && d.users) || [];
    countEl.textContent = d.count || users.length;
    usersByName = {};
    users.forEach(function (u, i) { usersByName["u" + i] = u; });
    if (!users.length) {
      grid.innerHTML = "";
      msg.innerHTML = '<div class="sub" style="margin-top:22px">Nobody\'s sharing right now — be the first.</div>';
      return;
    }
    grid.innerHTML = users.map(function (u, i) {
      var has3d = u.parts && u.parts.length;
      return '<div class="card">' +
        (has3d ? '<img class="vp" data-u="u' + i + '" alt="avatar viewport">' : '<div class="seen">3d preview appears once your character spawns in game</div>') +
        '<div class="name">' + esc(u.name || "?") + '</div>' +
        '<div class="fit">' + esc(u.fit || "Default avatar") + '</div>' +
        '<div class="seen">' + esc(ago(u.seen || 0)) + '</div></div>';
    }).join("");
    grid.querySelectorAll("img.vp").forEach(function (img) {
      observer.observe(img);
      img.addEventListener("click", function () {
        var u = usersByName[img.getAttribute("data-u")];
        if (u) openModal(u);
      });
    });
    if (modal.classList.contains("open") && modalUserName && modalControls && modalControls.autoRotate) {
      var mu = null;
      users.forEach(function (u) { if ((u.name || "?") === modalUserName && u.parts && u.parts.length) mu = u; });
      if (mu) refreshModalFigure(mu);
    }
  }).catch(function () {
    countEl.textContent = "0";
    grid.innerHTML = "";
    msg.innerHTML = '<div class="err">Board offline — the relay is unreachable. Try again in a bit.</div>';
  });
}
load();
setInterval(load, 5000);
</script>
</body>
</html>
