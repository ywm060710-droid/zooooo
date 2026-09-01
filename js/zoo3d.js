/* ============================================================
   尤尤的動物樂園 · zoo3d.js（v2）
   3D 沙盒開放式動物園 RPG：
   開放世界地圖（寵物之家／大草原／海洋館／森林／極地館）
   ＋ 10⭐ 行動 ＋ 走近動物互動 ＋ 隨機事件標記 ＋ 沙盒建設
   依賴：three.min.js（UMD 版，window.THREE）
   ============================================================ */
window.Zoo3D = (function () {
"use strict";

var hooks = null;        // 與 app.js 的接口
var wrap = null;         // 掛載容器（#zoo3dWrap）
var built = false;       // 場景是否已建立
var running = false;
var raf = 0;

var renderer, scene, camera, clock;
var mode = "play";       // play | build
var selItem = null;
var camMode = "follow";  // follow | top

/* ---------- 世界常量 ---------- */
var BOUND = 30.5;
var ZONE_RECTS = {
  pet:    { x1: -11, z1: -8,  x2: 11,  z2: 8,   color: 0xead9a6 },
  grass:  { x1: -31, z1: -12, x2: -13, z2: 12,  color: 0xa5d67c },
  forest: { x1: 13,  z1: -12, x2: 31,  z2: 12,  color: 0x7ab85e },
  ocean:  { x1: -13, z1: -31, x2: 13,  z2: -10, color: 0x8fd4f2 },
  polar:  { x1: -13, z1: 10,  x2: 13,  z2: 31,  color: 0xf4f8fc }
};
var GATES = {            // 各區通往中央廣場的閘口位置
  grass:  { x: -12, z: 0 },
  forest: { x: 12,  z: 0 },
  ocean:  { x: 0,   z: -9 },
  polar:  { x: 0,   z: 9 }
};
/* 建設格網（與 2D 地圖 12×8 共用同一組 "x,y" 座標，舊存檔無縫接入） */
var GX1 = -9, GZ1 = -6, TILE = 1.5, GW = 12, GH = 8;

/* ---------- 實體 ---------- */
var player = { group: null, yaw: 0, legs: [], moving: false, bob: 0 };
var camYaw = 0, camYawOff = 0;
var animals = [];        // {a, group, sprite, label, marker, pos, target, pause, zoneId, resident}
var decos = {};          // key -> group
var worldGroup, animalGroup, decoGroup, gridGroup, lockGroup, ghostGroup;
var ghost = null;
var keys = {};
var joy = { active: false, id: null, dx: 0, dy: 0 };
var drag = { active: false, id: null, x: 0, moved: 0 };
var raycaster, groundPlane, ndc;
var emojiTexCache = {};
var nearest = null;
var hud = {};

/* ============================================================
   小工具
   ============================================================ */
function zoneById(id) {
  return hooks.data.zones.filter(function (z) { return z.id === id; })[0];
}
function itemById(id) {
  return hooks.data.buildItems.filter(function (b) { return b.id === id; })[0];
}
function zoneAt(x, z) {
  var order = ["grass", "forest", "ocean", "polar", "pet"];
  for (var i = 0; i < order.length; i++) {
    var r = ZONE_RECTS[order[i]];
    if (x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2) return order[i];
  }
  return null;
}
function randIn(r, m) {
  return {
    x: r.x1 + m + Math.random() * (r.x2 - r.x1 - m * 2),
    z: r.z1 + m + Math.random() * (r.z2 - r.z1 - m * 2)
  };
}
function lerpAngle(a, b, t) {
  var d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function mat(color, opts) {
  var o = opts || {};
  return new THREE.MeshLambertMaterial({
    color: color,
    transparent: !!o.transparent,
    opacity: o.opacity == null ? 1 : o.opacity,
    emissive: o.emissive || 0x000000
  });
}
function box(w, h, d, color, x, y, z, opts) {
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x || 0, y || 0, z || 0);
  return m;
}
function blobShadow(r) {
  var m = new THREE.Mesh(
    new THREE.CircleGeometry(r || 0.55, 20),
    new THREE.MeshBasicMaterial({ color: 0x3a5a2a, transparent: true, opacity: 0.22 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  return m;
}

/* ---------- 表情符號貼圖 ---------- */
function emojiTexture(emoji) {
  if (emojiTexCache[emoji]) return emojiTexCache[emoji];
  var cv = document.createElement("canvas");
  cv.width = cv.height = 160;
  var ctx = cv.getContext("2d");
  ctx.font = "120px 'PingFang TC','Microsoft JhengHei',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 80, 90);
  var tex = new THREE.CanvasTexture(cv);
  emojiTexCache[emoji] = tex;
  return tex;
}
function emojiSprite(emoji, scale, y) {
  var sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: emojiTexture(emoji), transparent: true, depthWrite: false
  }));
  sp.scale.set(scale, scale, 1);
  sp.position.y = y || 1;
  return sp;
}
function labelSprite(text) {
  var cv = document.createElement("canvas");
  cv.width = 256; cv.height = 72;
  var ctx = cv.getContext("2d");
  ctx.fillStyle = "rgba(255,253,248,.92)";
  ctx.strokeStyle = "#d9a25e";
  ctx.lineWidth = 5;
  var r = 30;
  ctx.beginPath();
  ctx.moveTo(r, 3); ctx.lineTo(256 - r, 3); ctx.quadraticCurveTo(253, 3, 253, r);
  ctx.lineTo(253, 69 - r); ctx.quadraticCurveTo(253, 69, 256 - r, 69);
  ctx.lineTo(r, 69); ctx.quadraticCurveTo(3, 69, 3, 69 - r);
  ctx.lineTo(3, r); ctx.quadraticCurveTo(3, 3, r, 3);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#7a4a20";
  ctx.font = "bold 34px 'PingFang TC','Microsoft JhengHei',sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 38);
  var sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false
  }));
  sp.scale.set(1.9, 0.53, 1);
  return sp;
}

/* ============================================================
   場景建立（只做一次）
   ============================================================ */
function buildScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe6ff);
  scene.fog = new THREE.Fog(0xbfe6ff, 46, 95);
  camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);
  camera.position.set(0, 6, 9);
  clock = new THREE.Clock();
  raycaster = new THREE.Raycaster();
  ndc = new THREE.Vector2();

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";

  /* 燈光 */
  scene.add(new THREE.HemisphereLight(0xffffff, 0x87a862, 1.05));
  var sun = new THREE.DirectionalLight(0xfff3dd, 0.9);
  sun.position.set(18, 32, 12);
  scene.add(sun);

  /* 地面 */
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mat(0xb9dc8f));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  groundPlane.rotation.x = -Math.PI / 2;
  scene.add(groundPlane);

  worldGroup = new THREE.Group(); scene.add(worldGroup);
  animalGroup = new THREE.Group(); scene.add(animalGroup);
  decoGroup = new THREE.Group(); scene.add(decoGroup);
  gridGroup = new THREE.Group(); gridGroup.visible = false; scene.add(gridGroup);
  lockGroup = new THREE.Group(); scene.add(lockGroup);
  ghostGroup = new THREE.Group(); scene.add(ghostGroup);

  buildTerrain();
  buildPlayer();
}

/* ---------- 地形與地區 ---------- */
function patch(r, color, y) {
  var w = r.x2 - r.x1, d = r.z2 - r.z1;
  var m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color));
  m.rotation.x = -Math.PI / 2;
  m.position.set((r.x1 + r.x2) / 2, y || 0.01, (r.z1 + r.z2) / 2);
  return m;
}
function buildTerrain() {
  for (var id in ZONE_RECTS) worldGroup.add(patch(ZONE_RECTS[id], ZONE_RECTS[id].color));
  /* 小徑：中央通往四區 */
  var pathColor = 0xe6d3a3;
  worldGroup.add(patch({ x1: -13, z1: -2, x2: 13, z2: 2 }, pathColor, 0.015));
  worldGroup.add(patch({ x1: -2, z1: -10, x2: 2, z2: 10 }, pathColor, 0.015));
  /* 外圍圍欄 */
  fenceRun(-31, -31, 31, -31);
  fenceRun(31, -31, 31, 31);
  fenceRun(31, 31, -31, 31);
  fenceRun(-31, 31, -31, -31);
  /* 各區圍欄（面向廣場一邊留閘口） */
  zoneFences("grass");
  zoneFences("forest");
  zoneFences("ocean");
  zoneFences("polar");
  /* 海洋館：玻璃水缸 */
  var oc = ZONE_RECTS.ocean;
  var tank = box(oc.x2 - oc.x1 - 4, 3.2, oc.z2 - oc.z1 - 4, 0x4fb3e8,
    (oc.x1 + oc.x2) / 2, 1.6, (oc.z1 + oc.z2) / 2,
    { transparent: true, opacity: 0.34 });
  worldGroup.add(tank);
  var water = patch({ x1: oc.x1 + 2, z1: oc.z1 + 2, x2: oc.x2 - 2, z2: oc.z2 - 2 }, 0x2e9bd6, 0.03);
  worldGroup.add(water);
  /* 森林：大樹 */
  var fc = ZONE_RECTS.forest;
  [[16, -8], [24, -6], [28, 2], [17, 7], [26, 9], [21, 0]].forEach(function (p) {
    worldGroup.add(makeDecoModel("pine", p[0], p[1]));
  });
  /* 大草原：花叢 */
  var gc = ZONE_RECTS.grass;
  [[-16, -7], [-24, -3], [-19, 5], [-27, 8], [-15, 9]].forEach(function (p) {
    worldGroup.add(makeDecoModel("bush", p[0], p[1]));
  });
  /* 極地館：冰塊 */
  var pc = ZONE_RECTS.polar;
  [[-8, 14], [7, 17], [-3, 25], [6, 27]].forEach(function (p) {
    var ice = box(1.6, 1.1, 1.6, 0xd9f0fb, p[0], 0.55, p[1]);
    ice.rotation.y = Math.random();
    worldGroup.add(ice);
  });
  /* 廣場中央噴水池裝飾（純裝飾） */
  var pond = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.25, 24), mat(0x7cc4e8));
  pond.position.set(0, 0.12, 0);
  worldGroup.add(pond);
}
function fenceRun(x1, z1, x2, z2, gap) {
  var dx = x2 - x1, dz = z2 - z1;
  var len = Math.sqrt(dx * dx + dz * dz);
  var n = Math.floor(len / 2);
  for (var i = 0; i < n; i++) {
    var t = (i + 0.5) / n;
    var x = x1 + dx * t, z = z1 + dz * t;
    if (gap && Math.abs(x - gap.x) < 2.4 && Math.abs(z - gap.z) < 2.4) continue;
    var seg = box(1.7, 0.9, 0.22, 0xffffff, x, 0.45, z);
    seg.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
    worldGroup.add(seg);
  }
}
function zoneFences(zoneId) {
  var r = ZONE_RECTS[zoneId], g = GATES[zoneId];
  fenceRun(r.x1, r.z1, r.x2, r.z1, g);
  fenceRun(r.x2, r.z1, r.x2, r.z2, g);
  fenceRun(r.x2, r.z2, r.x1, r.z2, g);
  fenceRun(r.x1, r.z2, r.x1, r.z1, g);
}

/* ---------- 小狐狸橙橙（低多邊形） ---------- */
function buildPlayer() {
  var g = new THREE.Group();
  var ORANGE = 0xf7944d, CREAM = 0xfff3e2, DARK = 0xc96a26;
  var body = box(0.85, 0.6, 1.25, ORANGE, 0, 0.82, 0); g.add(body);
  var belly = box(0.7, 0.4, 1.0, CREAM, 0, 0.62, 0); g.add(belly);
  var head = box(0.62, 0.56, 0.58, ORANGE, 0, 1.32, 0.72); g.add(head);
  var snout = box(0.3, 0.24, 0.3, CREAM, 0, 1.22, 1.08); g.add(snout);
  var nose = box(0.12, 0.1, 0.08, 0x5b4636, 0, 1.3, 1.24); g.add(nose);
  var earL = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 4), mat(DARK));
  earL.position.set(-0.2, 1.74, 0.66); g.add(earL);
  var earR = earL.clone(); earR.position.x = 0.2; g.add(earR);
  var eyeL = box(0.07, 0.07, 0.04, 0x3a2a1a, -0.16, 1.4, 1.02); g.add(eyeL);
  var eyeR = eyeL.clone(); eyeR.position.x = 0.16; g.add(eyeR);
  var tail = box(0.34, 0.34, 0.85, ORANGE, 0, 0.95, -0.95);
  tail.rotation.x = -0.5; g.add(tail);
  var tip = box(0.3, 0.3, 0.28, CREAM, 0, 1.18, -1.28);
  tip.rotation.x = -0.5; g.add(tip);
  player.legs = [];
  [[-0.28, 0.42], [0.28, 0.42], [-0.28, -0.42], [0.28, -0.42]].forEach(function (p) {
    var leg = box(0.2, 0.55, 0.2, DARK, p[0], 0.28, p[1]);
    player.legs.push(leg); g.add(leg);
  });
  g.add(blobShadow(0.7));
  g.position.set(0, 0, 5);
  player.group = g;
  scene.add(g);
}

/* ============================================================
   建設物品 3D 模型
   ============================================================ */
function makeDecoModel(itemId, x, z, forGhost) {
  var g = new THREE.Group();
  function add(m) { g.add(m); return m; }
  switch (itemId) {
    case "flower":
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5), mat(0x4e8c3a))).position.y = 0.25;
      add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mat(0xff8fb3))).position.y = 0.58;
      break;
    case "bush":
      add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), mat(0x67a84e))).position.y = 0.4;
      break;
    case "mushroom":
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.4), mat(0xfff3e2))).position.y = 0.2;
      add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe86a6a))).position.y = 0.4;
      break;
    case "rock":
      add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.5), mat(0x9a9a94))).position.y = 0.32;
      break;
    case "fence": {
      var f1 = box(0.12, 0.7, 0.12, 0xb08954, -0.5, 0.35, 0); add(f1);
      var f2 = box(0.12, 0.7, 0.12, 0xb08954, 0.5, 0.35, 0); add(f2);
      add(box(1.2, 0.14, 0.08, 0xc79a63, 0, 0.5, 0));
      add(box(1.2, 0.14, 0.08, 0xc79a63, 0, 0.25, 0));
      break;
    }
    case "ball":
      add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), mat(0xffffff))).position.y = 0.42;
      break;
    case "tree":
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.9), mat(0x8a5a30))).position.y = 0.45;
      add(new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 10), mat(0x6cb050))).position.y = 1.35;
      break;
    case "bench":
      add(box(1.3, 0.12, 0.5, 0xc79a63, 0, 0.42, 0));
      add(box(1.3, 0.5, 0.1, 0xc79a63, 0, 0.65, -0.22));
      add(box(0.12, 0.42, 0.4, 0x8a5a30, -0.5, 0.21, 0));
      add(box(0.12, 0.42, 0.4, 0x8a5a30, 0.5, 0.21, 0));
      break;
    case "lamp":
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.6), mat(0x6b6b6b))).position.y = 0.8;
      add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mat(0xffe9a0, { emissive: 0xffd97a }))).position.y = 1.7;
      break;
    case "pine":
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.7), mat(0x8a5a30))).position.y = 0.35;
      add(new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.0, 8), mat(0x3f7a3a))).position.y = 1.1;
      add(new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.85, 8), mat(0x4e8c46))).position.y = 1.75;
      break;
    case "pond":
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.18, 20), mat(0x7cc4e8))).position.y = 0.09;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.1, 20), mat(0xd8c9a0))).position.y = 0.05;
      break;
    case "hut":
      add(box(1.1, 0.8, 1.1, 0xd9b380, 0, 0.4, 0));
      add(new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.6, 4), mat(0xc96a26))).position.y = 1.1;
      break;
    case "sign":
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0), mat(0x8a5a30))).position.y = 0.5;
      add(box(0.9, 0.45, 0.08, 0xe8cf9e, 0, 1.1, 0));
      break;
    case "aid":
      add(box(0.9, 0.7, 0.9, 0xffffff, 0, 0.35, 0));
      add(box(0.4, 0.12, 0.12, 0xe86a6a, 0, 0.75, 0.2));
      add(box(0.12, 0.12, 0.4, 0xe86a6a, 0, 0.75, 0.2));
      add(new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.35, 4), mat(0xe86a6a))).position.y = 0.9;
      break;
    case "trophy":
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.2, 0.1, 12), mat(0xd9a52e))).position.y = 0.05;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.25, 8), mat(0xd9a52e))).position.y = 0.2;
      add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), mat(0xffd97a, { emissive: 0x8a6b1e }))).position.y = 0.5;
      break;
    case "fountain":
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.2, 20), mat(0x7cc4e8))).position.y = 0.1;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.8, 10), mat(0xd8c9a0))).position.y = 0.5;
      add(new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), mat(0xaee3ff, { transparent: true, opacity: 0.85 }))).position.y = 1.0;
      break;
    case "pavilion": {
      [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].forEach(function (p) {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.3), mat(0xc96a26))).position.set(p[0], 0.65, p[1]);
      });
      add(box(1.7, 0.16, 1.7, 0xe86a6a, 0, 1.4, 0));
      add(new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.5, 4), mat(0xd8543a))).position.y = 1.7;
      break;
    }
    default:
      add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), mat(0xcccccc))).position.y = 0.4;
  }
  var it = itemById(itemId);
  if (it && !forGhost) g.add(emojiSprite(it.emoji, 0.85, itemId === "pond" || itemId === "fountain" ? 1.6 : 2.1));
  g.position.set(x || 0, 0, z || 0);
  return g;
}

/* ============================================================
   動物實體
   ============================================================ */
function spawnAnimal(a, resident) {
  var state = hooks.getState();
  var met = (state.friendship[a.id] || 0) > 0;
  var hasEvent = a.event && !state.eventDone[a.id] && (state.friendship[a.id] || 0) >= 2;
  var g = new THREE.Group();
  g.add(blobShadow(0.5));
  var sp = emojiSprite(a.emoji, 1.5, 1.0);
  sp.userData.animalId = a.id;
  g.add(sp);
  if (met) {
    var lb = labelSprite(a.emoji + " " + a.name);
    lb.position.y = 2.15;
    g.add(lb);
  }
  var marker = null;
  if (hasEvent) { marker = emojiSprite("❗", 0.6, 2.75); g.add(marker); }
  else if (!met) { marker = emojiSprite("❓", 0.55, 2.55); g.add(marker); }
  var rect = resident ? ZONE_RECTS.pet : ZONE_RECTS[a.zone];
  var start = randIn(rect, 2);
  g.position.set(start.x, 0, start.z);
  animalGroup.add(g);
  animals.push({
    a: a, group: g, sprite: sp, marker: marker,
    rect: rect, resident: resident,
    target: randIn(rect, 2), pause: Math.random() * 3
  });
}
function rebuildAnimals() {
  animals.forEach(function (e) { animalGroup.remove(e.group); });
  animals = [];
  var state = hooks.getState();
  hooks.data.animals.forEach(function (a) {
    if (state.residents.indexOf(a.id) >= 0) spawnAnimal(a, true);
    else spawnAnimal(a, false);
  });
}
function updateAnimals(dt, t) {
  animals.forEach(function (e) {
    var p = e.group.position;
    if (e.pause > 0) { e.pause -= dt; }
    else {
      var dx = e.target.x - p.x, dz = e.target.z - p.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.3) {
        e.target = randIn(e.rect, 2);
        e.pause = 1 + Math.random() * 3.5;
      } else {
        var sp = 1.1 * dt;
        p.x += dx / d * sp;
        p.z += dz / d * sp;
        e.sprite.position.y = 1.0 + Math.abs(Math.sin(t * 6 + p.x)) * 0.08;
      }
    }
    if (e.marker) e.marker.position.y = e.marker.userData.baseY || (e.marker.userData.baseY = e.marker.position.y),
      e.marker.position.y = e.marker.userData.baseY + Math.sin(t * 3 + p.z) * 0.15;
  });
}

/* ============================================================
   建設模式
   ============================================================ */
function tileKey(tx, ty) { return tx + "," + ty; }
function tileCenter(tx, ty) {
  return { x: GX1 + (tx + 0.5) * TILE, z: GZ1 + (ty + 0.5) * TILE };
}
function pointToTile(p) {
  var tx = Math.floor((p.x - GX1) / TILE), ty = Math.floor((p.z - GZ1) / TILE);
  if (tx < 0 || tx >= GW || ty < 0 || ty >= GH) return null;
  return { tx: tx, ty: ty };
}
function rebuildDecos() {
  for (var k in decos) decoGroup.remove(decos[k]);
  decos = {};
  var tiles = hooks.getState().zoo.tiles;
  for (var key in tiles) {
    var parts = key.split(",");
    var c = tileCenter(parseInt(parts[0], 10), parseInt(parts[1], 10));
    var g = makeDecoModel(tiles[key], c.x, c.z);
    decoGroup.add(g);
    decos[key] = g;
  }
  rebuildGrid();
}
function rebuildGrid() {
  while (gridGroup.children.length) gridGroup.remove(gridGroup.children[0]);
  var tiles = hooks.getState().zoo.tiles;
  for (var ty = 0; ty < GH; ty++) for (var tx = 0; tx < GW; tx++) {
    var c = tileCenter(tx, ty);
    var occ = !!tiles[tileKey(tx, ty)];
    var cell = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE * 0.88, TILE * 0.88),
      new THREE.MeshBasicMaterial({
        color: occ ? 0xffb37e : 0xffffff,
        transparent: true, opacity: occ ? 0.35 : 0.18
      })
    );
    cell.rotation.x = -Math.PI / 2;
    cell.position.set(c.x, 0.03, c.z);
    gridGroup.add(cell);
  }
}
function setGhost(itemId) {
  if (ghost) { ghostGroup.remove(ghost); ghost = null; }
  if (!itemId) return;
  ghost = makeDecoModel(itemId, 0, 0, true);
  ghost.traverse(function (m) {
    if (m.material) {
      m.material = m.material.clone();
      m.material.transparent = true;
      m.material.opacity = 0.55;
    }
  });
  ghost.visible = false;
  ghostGroup.add(ghost);
}
function enterBuild() {
  mode = "build";
  selItem = null;
  gridGroup.visible = true;
  hud.palette.classList.remove("hidden");
  hud.btnBuild.textContent = "✅ 完成";
  renderPalette();
}
function exitBuild() {
  mode = "play";
  selItem = null;
  setGhost(null);
  gridGroup.visible = false;
  hud.palette.classList.add("hidden");
  hud.btnBuild.textContent = "🏗️ 建設";
}
function renderPalette() {
  var html = "";
  hooks.data.buildItems.forEach(function (it) {
    var un = hooks.itemUnlocked(it);
    html += '<button class="z3pal' + (selItem === it.id ? " sel" : "") + '" data-i="' + it.id + '"' + (un ? "" : " disabled") + '>' +
      '<span>' + (un ? it.emoji : "🔒") + '</span>' + it.name +
      '<i>' + (un ? it.cost + "⭐" : "未解鎖") + '</i></button>';
  });
  hud.palItems.innerHTML = html;
  hud.palItems.querySelectorAll(".z3pal").forEach(function (b) {
    if (b.disabled) return;
    b.addEventListener("click", function () {
      var id = b.getAttribute("data-i");
      selItem = selItem === id ? null : id;
      setGhost(selItem);
      renderPalette();
    });
  });
}

/* ============================================================
   地區鎖定顯示
   ============================================================ */
function rebuildLocks() {
  while (lockGroup.children.length) lockGroup.remove(lockGroup.children[0]);
  ["grass", "forest", "ocean", "polar"].forEach(function (zoneId) {
    var z = zoneById(zoneId);
    var g = GATES[zoneId];
    if (!hooks.zoneUnlocked(z)) {
      var barrier = box(4.6, 2.2, 0.3, 0xe86a6a, g.x, 1.1, g.z, { transparent: true, opacity: 0.3 });
      barrier.rotation.y = (zoneId === "grass" || zoneId === "forest") ? Math.PI / 2 : 0;
      lockGroup.add(barrier);
      var sign = emojiSprite("🔒", 1.3, 2.9);
      sign.position.set(g.x, 2.9, g.z);
      lockGroup.add(sign);
    } else {
      var flag = emojiSprite(z.emoji, 1.1, 2.6);
      flag.position.set(g.x, 2.6, g.z);
      lockGroup.add(flag);
    }
  });
}

/* ============================================================
   HUD（DOM 覆蓋層）
   ============================================================ */
function buildHUD() {
  wrap.innerHTML =
    '<div class="z3stage"></div>' +
    '<div class="z3top">' +
    '  <span class="z3zone" id="z3zone">🏡 寵物之家</span>' +
    '  <span class="z3quest" id="z3quest"></span>' +
    '</div>' +
    '<div class="z3tip" id="z3tip">🕹️ 搖桿或 WASD 移動・走近動物按「互動」・拖動畫面轉視角</div>' +
    '<div class="z3btns">' +
    '  <button class="z3btn" id="z3Action">🧭 行動<span id="z3Cost"></span></button>' +
    '  <button class="z3btn alt" id="z3Interact" disabled>✋ 互動</button>' +
    '  <button class="z3btn alt2" id="z3Build">🏗️ 建設</button>' +
    '  <button class="z3btn alt2" id="z3Cam">🎥 高空</button>' +
    '</div>' +
    '<div class="z3joy" id="z3joy"><div class="z3knob" id="z3knob"></div></div>' +
    '<div class="z3palette hidden" id="z3palette">' +
    '  <div class="z3palHint">選物品 → 點廣場空格放置；點已有物品可拆走（全數退⭐）</div>' +
    '  <div class="z3palRow" id="z3palItems"></div>' +
    '</div>';
  hud.stage = wrap.querySelector(".z3stage");
  hud.zone = wrap.querySelector("#z3zone");
  hud.quest = wrap.querySelector("#z3quest");
  hud.tip = wrap.querySelector("#z3tip");
  hud.btnAction = wrap.querySelector("#z3Action");
  hud.cost = wrap.querySelector("#z3Cost");
  hud.btnInteract = wrap.querySelector("#z3Interact");
  hud.btnBuild = wrap.querySelector("#z3Build");
  hud.btnCam = wrap.querySelector("#z3Cam");
  hud.joy = wrap.querySelector("#z3joy");
  hud.knob = wrap.querySelector("#z3knob");
  hud.palette = wrap.querySelector("#z3palette");
  hud.palItems = wrap.querySelector("#z3palItems");
  hud.stage.appendChild(renderer.domElement);

  hud.btnAction.addEventListener("click", function () {
    if (mode === "build") return;
    var zid = zoneAt(player.group.position.x, player.group.position.z) || "pet";
    hooks.onExplore(zid);
  });
  hud.btnInteract.addEventListener("click", function () {
    if (nearest) hooks.onMeet(nearest.a);
  });
  hud.btnBuild.addEventListener("click", function () {
    if (mode === "build") exitBuild(); else enterBuild();
  });
  hud.btnCam.addEventListener("click", function () {
    camMode = camMode === "follow" ? "top" : "follow";
    hud.btnCam.textContent = camMode === "follow" ? "🎥 高空" : "🎥 跟隨";
  });
  bindJoystick();
  bindCanvas();
}
function updateHUD() {
  var p = player.group.position;
  var zid = zoneAt(p.x, p.z);
  if (zid) {
    var z = zoneById(zid);
    hud.zone.textContent = z.emoji + " " + z.name;
  } else {
    hud.zone.textContent = "🌼 林蔭小徑";
  }
  hud.quest.textContent = "🎯 " + hooks.questText();
  var cost = hooks.exploreCost();
  hud.cost.textContent = cost ? " " + cost + "⭐" : " 免費";
  hud.btnInteract.disabled = !nearest;
  if (nearest) {
    var met = (hooks.getState().friendship[nearest.a.id] || 0) > 0;
    hud.btnInteract.textContent = "✋ " + (met ? nearest.a.name : "新朋友");
  } else {
    hud.btnInteract.textContent = "✋ 互動";
  }
}

/* ---------- 搖桿 ---------- */
function bindJoystick() {
  var R = 46;
  function setKnob(dx, dy) {
    hud.knob.style.transform = "translate(" + dx * R * 0.55 + "px," + dy * R * 0.55 + "px)";
  }
  function handle(e) {
    var r = hud.joy.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1) { dx /= len; dy /= len; }
    joy.dx = dx; joy.dy = dy;
    setKnob(dx, dy);
  }
  hud.joy.addEventListener("pointerdown", function (e) {
    joy.active = true; joy.id = e.pointerId;
    hud.joy.setPointerCapture(e.pointerId);
    handle(e);
    e.preventDefault();
  });
  hud.joy.addEventListener("pointermove", function (e) {
    if (joy.active && e.pointerId === joy.id) handle(e);
  });
  function end(e) {
    if (e.pointerId !== joy.id) return;
    joy.active = false; joy.dx = 0; joy.dy = 0;
    setKnob(0, 0);
  }
  hud.joy.addEventListener("pointerup", end);
  hud.joy.addEventListener("pointercancel", end);
}

/* ---------- 畫布觸控／點擊 ---------- */
function canvasPoint(e) {
  var r = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}
function rayGround(e) {
  canvasPoint(e);
  raycaster.setFromCamera(ndc, camera);
  var hits = raycaster.intersectObject(groundPlane);
  return hits.length ? hits[0].point : null;
}
function bindCanvas() {
  var cv = renderer.domElement;
  cv.addEventListener("pointerdown", function (e) {
    drag.active = true; drag.id = e.pointerId; drag.x = e.clientX; drag.moved = 0;
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", function (e) {
    if (mode === "build") {
      var gp = rayGround(e);
      if (gp && ghost) {
        var t = pointToTile(gp);
        if (t) {
          var c = tileCenter(t.tx, t.ty);
          ghost.position.set(c.x, 0, c.z);
          ghost.visible = true;
        } else ghost.visible = false;
      }
      return;
    }
    if (drag.active && e.pointerId === drag.id) {
      var dx = e.clientX - drag.x;
      drag.x = e.clientX;
      drag.moved += Math.abs(dx);
      camYawOff -= dx * 0.006;
    }
  });
  cv.addEventListener("pointerup", function (e) {
    if (e.pointerId !== drag.id) return;
    drag.active = false;
    if (drag.moved > 8) return;   // 拖動視角，不算點擊
    if (mode === "build") { buildTap(e); return; }
    animalTap(e);
  });
}
function buildTap(e) {
  var gp = rayGround(e);
  if (!gp) return;
  var t = pointToTile(gp);
  if (!t) { hooks.toast("只能在中央廣場的格仔內建設喔！"); return; }
  var key = tileKey(t.tx, t.ty);
  var tiles = hooks.getState().zoo.tiles;
  if (tiles[key]) {
    var it = itemById(tiles[key]);
    if (confirm("拆走 " + it.emoji + " " + it.name + "？會退回 " + it.cost + "⭐")) {
      hooks.onRemove(key);
      rebuildDecos();
    }
    return;
  }
  if (!selItem) { hooks.toast("先在上面選一件物品！"); return; }
  if (hooks.onPlace(key, selItem)) rebuildDecos();
}
function animalTap(e) {
  canvasPoint(e);
  raycaster.setFromCamera(ndc, camera);
  var sprites = [];
  animals.forEach(function (en) { sprites.push(en.sprite); });
  var hits = raycaster.intersectObjects(sprites);
  if (!hits.length) return;
  var id = hits[0].object.userData.animalId;
  var en = animals.filter(function (x) { return x.a.id === id; })[0];
  if (!en) return;
  var d = en.group.position.distanceTo(player.group.position);
  if (d > 5) { hooks.toast("行近少少，先可以同" + en.a.name + "互動！"); return; }
  hooks.onMeet(en.a);
}

/* ============================================================
   主循環
   ============================================================ */
function onKey(down) {
  return function (e) {
    if (!running) return;
    var k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].indexOf(k) >= 0) {
      keys[k] = down;
      e.preventDefault();
    }
  };
}
var keyDownFn = onKey(true), keyUpFn = onKey(false);

function inputVector() {
  var ix = 0, iz = 0;
  if (keys["w"] || keys["arrowup"]) iz += 1;
  if (keys["s"] || keys["arrowdown"]) iz -= 1;
  if (keys["a"] || keys["arrowleft"]) ix -= 1;
  if (keys["d"] || keys["arrowright"]) ix += 1;
  ix += joy.dx;
  iz -= joy.dy;
  var len = Math.sqrt(ix * ix + iz * iz);
  if (len > 1) { ix /= len; iz /= len; }
  return { x: ix, z: iz };
}
function tryMove(dt) {
  var iv = inputVector();
  var moving = Math.abs(iv.x) > 0.05 || Math.abs(iv.z) > 0.05;
  player.moving = moving && mode === "play";
  if (!player.moving) return;
  var yaw = camYaw + camYawOff;
  var fx = Math.sin(yaw), fz = Math.cos(yaw);
  var rx = Math.cos(yaw), rz = -Math.sin(yaw);
  var dx = (fx * iv.z + rx * iv.x), dz = (fz * iv.z + rz * iv.x);
  var len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.001) return;
  dx /= len; dz /= len;
  var sp = 5.2 * dt;
  var p = player.group.position;
  var nx = Math.max(-BOUND, Math.min(BOUND, p.x + dx * sp));
  var nz = Math.max(-BOUND, Math.min(BOUND, p.z + dz * sp));
  /* 地區鎖定：不能走進未解鎖地區（分軸嘗試，貼住圍欄滑行） */
  function blocked(x, z) {
    var zid = zoneAt(x, z);
    return zid && !hooks.zoneUnlocked(zoneById(zid));
  }
  if (!blocked(nx, nz)) { p.x = nx; p.z = nz; }
  else if (!blocked(nx, p.z)) { p.x = nx; lockTip(); }
  else if (!blocked(p.x, nz)) { p.z = nz; lockTip(); }
  else lockTip();
  player.yaw = lerpAngle(player.yaw, Math.atan2(dx, dz), Math.min(1, dt * 10));
}
var lastLockTip = 0;
function lockTip() {
  var now = Date.now();
  if (now - lastLockTip < 3000) return;
  lastLockTip = now;
  var p = player.group.position;
  var zid = zoneAt(p.x, p.z) || nearestLocked(p);
  hooks.toast("🔒 完成更多章節，就可以解鎖新地區！");
}
function nearestLocked() { return null; }
function updateCamera(dt) {
  var p = player.group.position;
  if (camMode === "top") {
    camera.position.lerp(new THREE.Vector3(p.x, 26, p.z + 3), Math.min(1, dt * 4));
    camera.lookAt(p.x, 0, p.z);
    return;
  }
  camYaw = lerpAngle(camYaw, player.yaw, Math.min(1, dt * 2.2));
  var yaw = camYaw + camYawOff;
  var tx = p.x - Math.sin(yaw) * 7.5;
  var tz = p.z - Math.cos(yaw) * 7.5;
  var ty = 5.2;
  camera.position.lerp(new THREE.Vector3(tx, ty, tz), Math.min(1, dt * 5));
  camera.lookAt(p.x, 1.2, p.z);
}
function updatePlayer(dt, t) {
  player.group.rotation.y = player.yaw;
  if (player.moving) {
    player.bob += dt * 11;
    for (var i = 0; i < player.legs.length; i++) {
      player.legs[i].rotation.x = Math.sin(player.bob + (i % 2) * Math.PI) * 0.55;
    }
    player.group.position.y = Math.abs(Math.sin(player.bob * 0.5)) * 0.06;
  } else {
    for (var j = 0; j < player.legs.length; j++) player.legs[j].rotation.x *= 0.8;
    player.group.position.y = 0;
  }
}
function updateNearest() {
  nearest = null;
  var best = 2.8;
  var p = player.group.position;
  animals.forEach(function (e) {
    var d = e.group.position.distanceTo(p);
    if (d < best) { best = d; nearest = e; }
  });
}
function loop() {
  if (!running) return;
  raf = requestAnimationFrame(loop);
  var dt = Math.min(clock.getDelta(), 0.05);
  var t = clock.elapsedTime;
  resize();   // 尺寸不變時會自動跳過，開頭隱藏容器顯示後亦能修正
  tryMove(dt);
  updatePlayer(dt, t);
  updateAnimals(dt, t);
  updateNearest();
  updateCamera(dt);
  updateHUD();
  renderer.render(scene, camera);
}
function resize() {
  if (!renderer || !hud.stage) return;
  var w = hud.stage.clientWidth || wrap.clientWidth;
  var h = hud.stage.clientHeight || wrap.clientHeight;
  if (!w || !h) return;
  var pr = renderer.getPixelRatio();
  if (renderer.domElement.width === Math.floor(w * pr) &&
      renderer.domElement.height === Math.floor(h * pr) &&
      Math.abs(camera.aspect - w / h) < 0.001) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
var resizeFn = function () { resize(); };

/* ============================================================
   公開接口
   ============================================================ */
return {
  supported: function () {
    if (!window.THREE) return false;
    try {
      var cv = document.createElement("canvas");
      return !!(cv.getContext("webgl") || cv.getContext("experimental-webgl"));
    } catch (e) { return false; }
  },
  mount: function (el, h) {
    hooks = h;
    if (!built) {
      buildScene();
      built = true;
    }
    wrap = el;
    buildHUD();
    resize();
  },
  refresh: function () {
    if (!built) return;
    rebuildAnimals();
    rebuildDecos();
    rebuildLocks();
    if (mode === "build") exitBuild();
  },
  start: function () {
    if (!built || running) return;
    running = true;
    window.addEventListener("keydown", keyDownFn);
    window.addEventListener("keyup", keyUpFn);
    window.addEventListener("resize", resizeFn);
    clock.getDelta();
    resize();
    loop();
  },
  stop: function () {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", keyDownFn);
    window.removeEventListener("keyup", keyUpFn);
    window.removeEventListener("resize", resizeFn);
    joy.active = false; joy.dx = 0; joy.dy = 0;
    for (var k in keys) keys[k] = false;
  }
};
})();
