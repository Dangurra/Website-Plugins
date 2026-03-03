/**
 * wireframe-globe.js
 * ------------------
 * Black & white wireframe globe with clickable submarine icons.
 * No heavy textures — pure geometry.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { MISSIONS } from './missions-data.js';
import './wireframe-styles.css';

const GLOBE_RADIUS = 1;
const NMI_TO_RAD = 1.852 / 6371;
const NORTH_POLE = new THREE.Vector3(0, 1, 0);

function latLngTo3D(lat, lng, r = GLOBE_RADIUS) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

function pathCenter(path) {
  let lng = 0, lat = 0;
  for (const [lo, la] of path) { lng += lo; lat += la; }
  return [lng / path.length, lat / path.length];
}

function createRingPositions(nmi, segments = 128) {
  const a = nmi * NMI_TO_RAD;
  const r = GLOBE_RADIUS + 0.005;
  const positions = [];
  for (let i = 0; i <= segments; i++) {
    const th = (i / segments) * Math.PI * 2;
    positions.push(
      r * Math.sin(a) * Math.cos(th),
      r * Math.cos(a),
      r * Math.sin(a) * Math.sin(th),
    );
  }
  return positions;
}

const ring1000Pos = createRingPositions(1000);
const ring200Pos = createRingPositions(200);

// ── build wireframe globe ──────────────────────────────────

function buildWireframeGlobe(scene, base) {
  // Dark base sphere (solid black core)
  const coreGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  scene.add(new THREE.Mesh(coreGeo, coreMat));

  // Wireframe overlay — subtle triangle grid
  const wireGeo = new THREE.SphereGeometry(GLOBE_RADIUS + 0.001, 48, 48);
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x444444,
    wireframe: true,
    transparent: true,
    opacity: 0.2,
  });
  scene.add(new THREE.Mesh(wireGeo, wireMat));

  // Lat/lon grid lines
  const gridMat = new THREE.LineBasicMaterial({
    color: 0x555555,
    transparent: true,
    opacity: 0.35,
  });
  const r = GLOBE_RADIUS + 0.002;

  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = [];
    for (let lng = 0; lng <= 360; lng += 3) pts.push(latLngTo3D(lat, lng - 180, r));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
  }
  for (let lng = -180; lng < 180; lng += 30) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 3) pts.push(latLngTo3D(lat, lng, r));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
  }

  // Coastline outlines from Natural Earth 110m data
  const coastR = GLOBE_RADIUS + 0.003;
  const coastMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
  });

  fetch(base + 'coastline.json')
    .then(res => res.json())
    .then(lines => {
      for (const coords of lines) {
        const pts = coords.map(([lng, lat]) => latLngTo3D(lat, lng, coastR));
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        scene.add(new THREE.Line(geo, coastMat));
      }
    });

  // Thin Fresnel glow rim around the globe
  const glowGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.015, 64, 64);
  const glowMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xffffff) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vNormalW = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vPosW   = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vPosW);
        float fresnel = 1.0 - max(dot(normalize(vNormalW), viewDir), 0.0);
        float glow = pow(fresnel, 4.0) * 0.5;
        gl_FragColor = vec4(uColor, glow);
      }
    `,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
  });
  scene.add(new THREE.Mesh(glowGeo, glowMat));
}

// ── orient submarine flat to sphere ────────────────────────

const _m4 = new THREE.Matrix4();
const _xAxis = new THREE.Vector3();
const _yAxis = new THREE.Vector3();
const _zAxis = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _parentQuatInv = new THREE.Quaternion();
const _ref = new THREE.Vector3();

function orientSub(mesh) {
  mesh.getWorldPosition(_worldPos);
  _zAxis.copy(_worldPos).normalize();
  _ref.set(Math.abs(_zAxis.y) > 0.99 ? 1 : 0, Math.abs(_zAxis.y) > 0.99 ? 0 : 1, 0);
  _xAxis.crossVectors(_ref, _zAxis).normalize();
  _yAxis.crossVectors(_zAxis, _xAxis).normalize();
  _m4.makeBasis(_xAxis, _yAxis, _zAxis);
  _worldQuat.setFromRotationMatrix(_m4);
  mesh.parent.getWorldQuaternion(_parentQuatInv);
  _parentQuatInv.invert();
  mesh.quaternion.copy(_parentQuatInv.multiply(_worldQuat));
}

// ══════════════════════════════════════════════════════════════
//  PUBLIC INIT
// ══════════════════════════════════════════════════════════════

export function initWireframeGlobe(containerEl, { assetsBase = '/' } = {}) {
  if (!containerEl) return;

  const base = assetsBase.endsWith('/') ? assetsBase : assetsBase + '/';

  let selectedMission = null;
  let rafId = null;

  /* ── DOM ────────────────────────────────────────────────── */
  containerEl.classList.add('wf');
  containerEl.innerHTML = `
    <div class="wf__canvas-wrap" id="wf-cw"></div>
    <div class="wf__panel" id="wf-panel">
      <button class="wf__panel-close" id="wf-close">&times;</button>
      <span class="wf__panel-badge" id="wf-badge"></span>
      <h3 class="wf__panel-title" id="wf-title"></h3>
      <p class="wf__panel-dates" id="wf-dates"></p>
      <p class="wf__panel-desc" id="wf-desc"></p>
      <div class="wf__panel-stats" id="wf-stats"></div>
    </div>
  `;

  const cw = document.getElementById('wf-cw');
  const panelEl = document.getElementById('wf-panel');
  const closeBtn = document.getElementById('wf-close');
  const badgeEl = document.getElementById('wf-badge');
  const titleEl = document.getElementById('wf-title');
  const datesEl = document.getElementById('wf-dates');
  const descEl = document.getElementById('wf-desc');
  const statsEl = document.getElementById('wf-stats');

  /* ── Three.js ───────────────────────────────────────────── */
  const w0 = cw.clientWidth || window.innerWidth;
  const h0 = cw.clientHeight || window.innerHeight;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  function getCameraDistance() {
    const aspect = (cw.clientWidth || window.innerWidth) / (cw.clientHeight || window.innerHeight);
    if (aspect < 0.6) return 3.8;
    if (aspect < 0.9) return 3.4;
    if (aspect < 1.2) return 3.0;
    return 2.8;
  }

  const camera = new THREE.PerspectiveCamera(45, w0 / h0, 0.01, 50);
  const camDist = getCameraDistance();
  camera.position.set(0, camDist * 0.35, camDist * 0.95);
  camera.lookAt(0, 0.5, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w0, h0);
  cw.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.5, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.15;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableRotate = true;
  controls.minPolarAngle = controls.getPolarAngle();
  controls.maxPolarAngle = controls.getPolarAngle();
  controls.touches = { ONE: THREE.TOUCH.ROTATE };

  // Minimal lighting — just enough for the submarine icons
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));

  buildWireframeGlobe(scene, base);

  /* ── mission rings + submarines ─────────────────────────── */
  const lineMaterials = [];
  const ringGroups = [];
  const subMeshes = [];     // { mesh, mission, group, home, phase, bobSpeed }

  const subTex = new THREE.TextureLoader().load(base + 'Vector.png');
  const subPlaneGeo = new THREE.PlaneGeometry(0.05, 0.025);
  const SUB_R = GLOBE_RADIUS + 0.004;
  const innerRad = 200 * NMI_TO_RAD;
  const outerRad = 1000 * NMI_TO_RAD;
  const SUBS_PER_RING = 8;

  for (const m of MISSIONS) {
    const [lng, lat] = pathCenter(m.path);
    const center3D = latLngTo3D(lat, lng);
    const dir = center3D.clone().normalize();

    const ringGroup = new THREE.Group();
    const subGroup = new THREE.Group();

    // Outer ring — dotted white
    const geo1000 = new LineGeometry();
    geo1000.setPositions(ring1000Pos);
    const mat1000 = new LineMaterial({
      color: 0xffffff,
      linewidth: 2,
      transparent: true,
      opacity: 0.25,
      dashed: true,
      dashSize: 0.008,
      gapSize: 0.018,
      dashScale: 1,
    });
    mat1000.resolution.set(w0, h0);
    const line1000 = new Line2(geo1000, mat1000);
    line1000.computeLineDistances();
    ringGroup.add(line1000);

    // Inner ring — solid white
    const geo200 = new LineGeometry();
    geo200.setPositions(ring200Pos);
    const mat200 = new LineMaterial({
      color: 0xffffff,
      linewidth: 1,
      transparent: true,
      opacity: 0.4,
    });
    mat200.resolution.set(w0, h0);
    ringGroup.add(new Line2(geo200, mat200));

    lineMaterials.push(mat1000, mat200);

    // Submarine meshes
    for (let i = 0; i < SUBS_PER_RING; i++) {
      const a = innerRad + Math.random() * (outerRad - innerRad);
      const th = Math.random() * Math.PI * 2;
      const home = new THREE.Vector3(
        SUB_R * Math.sin(a) * Math.cos(th),
        SUB_R * Math.cos(a),
        SUB_R * Math.sin(a) * Math.sin(th),
      );

      const subMat = new THREE.MeshBasicMaterial({
        map: subTex,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(subPlaneGeo, subMat);
      mesh.position.copy(home);
      subGroup.add(mesh);

      subMeshes.push({
        mesh,
        mission: m,
        group: subGroup,
        home,
        phase: Math.random() * Math.PI * 2,
        bobSpeed: 0.4 + Math.random() * 0.3,
        baseMat: subMat,
      });
    }

    ringGroup.quaternion.setFromUnitVectors(NORTH_POLE, dir);
    subGroup.quaternion.setFromUnitVectors(NORTH_POLE, dir);

    scene.add(ringGroup);
    scene.add(subGroup);
    ringGroups.push({ group: ringGroup, axis: dir });
  }

  // Orient all subs after adding to scene
  for (const sub of subMeshes) orientSub(sub.mesh);

  /* ── click / tap detection ─────────────────────────────── */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDown = new THREE.Vector2();
  let isPointerDown = false;

  function onPointerDown(e) {
    isPointerDown = true;
    const rect = cw.getBoundingClientRect();
    pointerDown.set(e.clientX - rect.left, e.clientY - rect.top);
  }

  function onPointerUp(e) {
    if (!isPointerDown) return;
    isPointerDown = false;

    const rect = cw.getBoundingClientRect();
    const upX = e.clientX - rect.left;
    const upY = e.clientY - rect.top;

    // Only count as click if pointer didn't move much (not a drag)
    if (Math.hypot(upX - pointerDown.x, upY - pointerDown.y) > 8) return;

    pointer.x = (upX / rect.width) * 2 - 1;
    pointer.y = -(upY / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);

    // Check submarine meshes first
    const allMeshes = subMeshes.map(s => s.mesh);
    const hits = raycaster.intersectObjects(allMeshes, false);

    if (hits.length > 0) {
      const hitMesh = hits[0].object;
      const sub = subMeshes.find(s => s.mesh === hitMesh);
      if (sub) {
        selectMission(sub.mission);
        return;
      }
    }

    // Click on empty space — deselect
    deselectMission();
  }

  cw.addEventListener('pointerdown', onPointerDown);
  cw.addEventListener('pointerup', onPointerUp);

  function selectMission(mission) {
    selectedMission = mission;

    // Update submarine visuals
    for (const sub of subMeshes) {
      if (sub.mission === mission) {
        sub.baseMat.opacity = 1.0;
        sub.baseMat.color.set(0xffffff);
      } else {
        sub.baseMat.opacity = 0.15;
        sub.baseMat.color.set(0x888888);
      }
    }

    // Show panel
    badgeEl.textContent = mission.category;
    titleEl.textContent = mission.name;
    datesEl.textContent = mission.dates;
    descEl.textContent = mission.description;
    statsEl.innerHTML = `
      <div class="wf__stat">
        <span class="wf__stat-label">Waypoints</span>
        <span class="wf__stat-value">${mission.path.length}</span>
      </div>
      <div class="wf__stat">
        <span class="wf__stat-label">Status</span>
        <span class="wf__stat-value">Completed</span>
      </div>
    `;
    panelEl.classList.add('is-visible');
  }

  function deselectMission() {
    if (!selectedMission) return;
    selectedMission = null;

    for (const sub of subMeshes) {
      sub.baseMat.opacity = 0.6;
      sub.baseMat.color.set(0xffffff);
    }
    panelEl.classList.remove('is-visible');
  }

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deselectMission();
  });

  /* ── resize ─────────────────────────────────────────────── */
  function onResize() {
    const w = cw.clientWidth;
    const h = cw.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    for (const mat of lineMaterials) mat.resolution.set(w, h);

    const dist = getCameraDistance();
    camera.position.set(0, dist * 0.35, dist * 0.95);
  }
  window.addEventListener('resize', onResize);

  /* ── render loop ────────────────────────────────────────── */
  const _bobTangent = new THREE.Vector3();

  function tick() {
    rafId = requestAnimationFrame(tick);
    const now = performance.now();

    controls.update();

    // Slow ring rotation
    for (const { group, axis } of ringGroups) {
      group.rotateOnWorldAxis(axis, 0.002);
    }

    // Submarine bob
    const t = now * 0.001;
    for (const sub of subMeshes) {
      const offset = Math.sin(t * sub.bobSpeed + sub.phase) * 0.008;
      _bobTangent.set(0, 1, 0).cross(sub.home).normalize();
      sub.mesh.position.copy(sub.home).addScaledVector(_bobTangent, offset);
      sub.mesh.position.normalize().multiplyScalar(SUB_R);
      orientSub(sub.mesh);
    }

    renderer.render(scene, camera);
  }
  tick();

  return function destroy() {
    cancelAnimationFrame(rafId);
    renderer.dispose();
    controls.dispose();
    window.removeEventListener('resize', onResize);
    cw.removeEventListener('pointerdown', onPointerDown);
    cw.removeEventListener('pointerup', onPointerUp);
  };
}
