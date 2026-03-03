/**
 * past-missions.js
 * ----------------
 * 3-D globe with static radius rings at fixed locations.
 * Pure Three.js. No API keys. No external tile services.
 *
 * Dependencies: three — that's it.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { MISSIONS } from './missions-data.js';
import './styles.css';

// ── constants ────────────────────────────────────────────────
const GLOBE_RADIUS = 1;
const HOVER_PX = 40;

// ── coordinate helpers ───────────────────────────────────────

function latLngTo3D(lat, lng, r = GLOBE_RADIUS) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

function toScreen(vec3, camera, w, h) {
  const v = vec3.clone().project(camera);
  return { x: ((v.x + 1) / 2) * w, y: (-(v.y - 1) / 2) * h };
}

/** Compute the centroid [lng, lat] of a mission's path. */
function pathCenter(path) {
  let lng = 0, lat = 0;
  for (const [lo, la] of path) { lng += lo; lat += la; }
  return [lng / path.length, lat / path.length];
}

// ── globe ────────────────────────────────────────────────────

// Atmosphere / roughness tunables
const ATMOS_DAY_COLOR   = new THREE.Color('#4db2ff');    // exact Three.js example
const ATMOS_TWILIGHT_COLOR = new THREE.Color('#bc490b'); // exact Three.js example
const ROUGHNESS_LOW  = 0.25;
const ROUGHNESS_HIGH = 0.35;

function buildGlobe(scene, renderer, sunLight, base) {
  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // ── Earth surface ──
  const geo = new THREE.SphereGeometry(GLOBE_RADIUS, 128, 128);

  const dayTex = loader.load(base + 'earth-day.webp');
  dayTex.colorSpace = THREE.SRGBColorSpace;
  dayTex.anisotropy = maxAniso;

  const bumpTex = loader.load(base + 'earth-bump.webp');
  bumpTex.anisotropy = maxAniso;

  const mat = new THREE.MeshStandardMaterial({
    map: dayTex,
    bumpMap: bumpTex,
    bumpScale: 0.03,
    roughnessMap: bumpTex,
    roughness: 1.0,
    metalness: 0.05,
    emissiveMap: dayTex,
    emissive: new THREE.Color(0.08, 0.1, 0.15),
    displacementMap: bumpTex,
    displacementScale: 0.015,
  });

  // Remap roughness + darken ocean for ring contrast
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRoughnessLow  = { value: ROUGHNESS_LOW };
    shader.uniforms.uRoughnessHigh = { value: ROUGHNESS_HIGH };
    shader.uniforms.uOceanDarken   = { value: 0.45 };  // 0 = black ocean, 1 = no change

    shader.fragmentShader = 'uniform float uRoughnessLow;\nuniform float uRoughnessHigh;\nuniform float uOceanDarken;\n' + shader.fragmentShader;

    // Darken ocean areas (low bump = ocean) after diffuse color is read
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
        #include <map_fragment>
        float elev = texture2D(bumpMap, vBumpMapUv).r;
        float oceanMask = 1.0 - smoothstep(0.02, 0.12, elev);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(uOceanDarken), oceanMask);
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = uRoughnessLow + roughnessFactor * (uRoughnessHigh - uRoughnessLow);
      `
    );
  };

  scene.add(new THREE.Mesh(geo, mat));

  // ── Cloud layer (Solar System Scope 2K clouds) ──
  const cloudGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.006, 96, 96);
  const cloudTex = loader.load(base + 'earth-clouds.webp');
  cloudTex.anisotropy = maxAniso;

  const cloudMat = new THREE.MeshStandardMaterial({
    alphaMap: cloudTex,
    color: 0xffffff,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
  });

  const clouds = new THREE.Mesh(cloudGeo, cloudMat);
  scene.add(clouds);

  // ── Atmosphere (Fresnel rim with day / twilight color) ──
  const atmosGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.04, 64, 64);
  const atmosMat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir:          { value: new THREE.Vector3() },
      uDayColor:        { value: ATMOS_DAY_COLOR },
      uTwilightColor:   { value: ATMOS_TWILIGHT_COLOR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vNormalW  = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vPosW    = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uDayColor;
      uniform vec3 uTwilightColor;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vPosW);
        vec3 normal  = normalize(vNormalW);

        // Fresnel (matches Three.js TSL earth example)
        float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);

        // Sun orientation
        float sunDot = dot(normal, uSunDir);

        // Day/twilight color blend
        float dayStrength = smoothstep(-0.25, 0.75, sunDot);
        vec3 atmosColor = mix(uTwilightColor, uDayColor, dayStrength);

        // Alpha: remap fresnel from (0.73,1) → (1,0), then pow 3
        // This makes the rim thin and bright, fading toward center
        float alphaFresnel = clamp((fresnel - 0.73) / (1.0 - 0.73), 0.0, 1.0);
        alphaFresnel = 1.0 - alphaFresnel;
        float alpha = pow(alphaFresnel, 3.0);

        // Fade on shadow side
        alpha *= smoothstep(-0.5, 1.0, sunDot);

        gl_FragColor = vec4(atmosColor, alpha);
      }
    `,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
  });

  const atmosphere = new THREE.Mesh(atmosGeo, atmosMat);
  scene.add(atmosphere);

  return { clouds, atmosMat, sunLight };
}

function buildGrid(scene) {
  const mat = new THREE.LineBasicMaterial({ color: 0x4466aa, transparent: true, opacity: 0.06 });
  const r = GLOBE_RADIUS + 0.001;
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = [];
    for (let lng = 0; lng <= 360; lng += 3) pts.push(latLngTo3D(lat, lng - 180, r));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
  for (let lng = -180; lng < 180; lng += 30) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 3) pts.push(latLngTo3D(lat, lng, r));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
}

function buildStars(scene) {
  const N = 2000;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 5 + Math.random() * 10;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    pos[i * 3 + 2] = r * Math.cos(ph);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.015, transparent: true, opacity: 0.5 })));
}

// ── radius rings (nautical miles → angular radius on globe) ──

const NMI_TO_RAD = (1.852 / 6371);
const NORTH_POLE = new THREE.Vector3(0, 1, 0);

function createRingPositions(nmi, segments = 128) {
  const a = nmi * NMI_TO_RAD;
  const r = GLOBE_RADIUS + 0.022;
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

const ring1000Positions = createRingPositions(1000);
const ring200Positions  = createRingPositions(200);

// ── submarine placement bounds ──────────────────────────────
const SUB_INNER_NMI = 200;
const SUB_OUTER_NMI = 1000;

// ── ocean detection from earth texture ──────────────────────

let oceanData = null;
let oceanW = 0, oceanH = 0;

function loadOceanData(base) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const c = document.createElement('canvas');
    oceanW = img.width;
    oceanH = img.height;
    c.width = oceanW; c.height = oceanH;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    oceanData = ctx.getImageData(0, 0, oceanW, oceanH).data;
  };
  img.src = base + 'earth-day.webp';
}

function vec3ToLatLng(v) {
  const r = v.length();
  const lat = 90 - Math.acos(v.y / r) * (180 / Math.PI);
  let lng = Math.atan2(v.z, -v.x) * (180 / Math.PI) - 180;
  if (lng < -180) lng += 360;
  return [lat, lng];
}

function isOcean(lat, lng) {
  if (!oceanData) return true;
  const u = ((lng + 180) % 360) / 360;
  const v = (90 - lat) / 180;
  const px = Math.min(Math.floor(u * oceanW), oceanW - 1);
  const py = Math.min(Math.floor(v * oceanH), oceanH - 1);
  const idx = (py * oceanW + px) * 4;
  const r = oceanData[idx], g = oceanData[idx + 1], b = oceanData[idx + 2];
  // Ocean: blue channel dominant over red
  return b > 40 && b > r * 1.1;
}

// ══════════════════════════════════════════════════════════════
//  PUBLIC INIT
// ══════════════════════════════════════════════════════════════

export function initPastMissions(containerEl, { assetsBase = '/' } = {}) {
  if (!containerEl) return;

  // Normalise base path — ensure trailing slash
  const base = assetsBase.endsWith('/') ? assetsBase : assetsBase + '/';
  loadOceanData(base);

  /* ── state ──────────────────────────────────────────────── */
  let hoveredMission = null;
  let rafId = null;

  /* ── DOM ────────────────────────────────────────────────── */
  containerEl.classList.add('pm');
  containerEl.innerHTML = `
    <div class="pm__canvas-wrap" id="pm-cw"></div>
    <div class="pm__panel" id="pm-panel">
      <span class="pm__panel-badge" id="pm-badge"></span>
      <h3 class="pm__panel-title" id="pm-title"></h3>
      <p class="pm__panel-dates" id="pm-dates"></p>
      <p class="pm__panel-desc" id="pm-desc"></p>
    </div>
  `;

  const cw = document.getElementById('pm-cw');
  const panelEl = document.getElementById('pm-panel');
  const badgeEl = document.getElementById('pm-badge');
  const titleEl = document.getElementById('pm-title');
  const datesEl = document.getElementById('pm-dates');
  const descEl = document.getElementById('pm-desc');

  /* ── Three.js ───────────────────────────────────────────── */
  const w0 = cw.clientWidth || window.innerWidth;
  const h0 = cw.clientHeight || window.innerHeight;

  const scene = new THREE.Scene();

  // ── Gradient background (#0E1213 → #345697) ──
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 2; bgCanvas.height = 512;
  const bgCtx = bgCanvas.getContext('2d');
  const grad = bgCtx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#0E1213');   // top
  grad.addColorStop(1, '#345697');   // bottom
  bgCtx.fillStyle = grad;
  bgCtx.fillRect(0, 0, 2, 512);
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = bgTex;

  // Scale camera distance so globe fills the viewport on any screen size
  function getCameraDistance() {
    const aspect = (cw.clientWidth || window.innerWidth) / (cw.clientHeight || window.innerHeight);
    if (aspect < 0.6) return 3.8;       // tall phone portrait
    if (aspect < 0.9) return 3.4;       // tablet portrait
    if (aspect < 1.2) return 3.0;       // tablet landscape / small desktop
    return 2.8;                          // desktop
  }

  const camera = new THREE.PerspectiveCamera(45, w0 / h0, 0.01, 50);
  const camDist = getCameraDistance();
  // Globe aligned to bottom of screen, tilted so top leans away from user
  camera.position.set(0, camDist * 0.35, camDist * 0.95);
  camera.lookAt(0, 0.5, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w0, h0);
  renderer.setClearColor(0x0E1213, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  cw.appendChild(renderer.domElement);

  // ── Post-processing (bloom) ──
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w0, h0),
    0.4,    // strength — subtle glow
    0.8,    // radius — moderate bloom spread
    0.85,   // threshold — only brightest areas bloom
  );
  composer.addPass(bloomPass);

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
  controls.touches = { ONE: THREE.TOUCH.ROTATE }; // single-finger rotate on mobile

  scene.add(new THREE.AmbientLight(0x8899bb, 2.0));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 3, 4);
  scene.add(dirLight);

  const { clouds, atmosMat } = buildGlobe(scene, renderer, dirLight, base);
  buildGrid(scene);
  buildStars(scene);

  /* ── static rings at each mission location ─────────────── */
  const missionEntries = [];
  const lineMaterials = [];
  const outerRingMats = [];   // 1000 nmi materials for opacity pulse
  const ringGroups = [];

  const subTex = new THREE.TextureLoader().load(base + 'Vector.png');
  const subPlaneGeo = new THREE.PlaneGeometry(0.04, 0.02);
  const SUB_R = GLOBE_RADIUS + 0.004;
  const innerRad = SUB_INNER_NMI * NMI_TO_RAD;
  const outerRad = SUB_OUTER_NMI * NMI_TO_RAD;
  const SUBS_PER_RING = 8;

  // Find a random ocean point within the ring zone
  function findOceanPoint(group) {
    const _wv = new THREE.Vector3();
    for (let tries = 0; tries < 300; tries++) {
      const a = innerRad + Math.random() * (outerRad - innerRad);
      const th = Math.random() * Math.PI * 2;
      const p = new THREE.Vector3(
        SUB_R * Math.sin(a) * Math.cos(th),
        SUB_R * Math.cos(a),
        SUB_R * Math.sin(a) * Math.sin(th),
      );
      _wv.copy(p);
      group.localToWorld(_wv);
      const [lat, lng] = vec3ToLatLng(_wv);
      if (isOcean(lat, lng)) return p;
    }
    // Fallback — random point regardless
    const a = innerRad + Math.random() * (outerRad - innerRad);
    const th = Math.random() * Math.PI * 2;
    return new THREE.Vector3(
      SUB_R * Math.sin(a) * Math.cos(th),
      SUB_R * Math.cos(a),
      SUB_R * Math.sin(a) * Math.sin(th),
    );
  }

  const submarines = [];
  let subsReady = false;

  for (const m of MISSIONS) {
    const [lng, lat] = pathCenter(m.path);
    const center3D = latLngTo3D(lat, lng);
    const dir = center3D.clone().normalize();

    const ringGroup = new THREE.Group();   // lines only — this rotates
    const subGroup  = new THREE.Group();   // submarines — static, no rotation

    // 1000 nmi — dotted outer ring
    const geo1000 = new LineGeometry();
    geo1000.setPositions(ring1000Positions);
    const mat1000 = new LineMaterial({
      color: 0x447DEB,
      linewidth: 3,
      transparent: true,
      opacity: 0.55,
      dashed: true,
      dashSize: 0.008,
      gapSize: 0.018,
      dashScale: 1,
    });
    mat1000.resolution.set(w0, h0);
    const line1000 = new Line2(geo1000, mat1000);
    line1000.computeLineDistances();
    ringGroup.add(line1000);

    // 200 nmi — solid inner ring
    const geo200 = new LineGeometry();
    geo200.setPositions(ring200Positions);
    const mat200 = new LineMaterial({
      color: 0x447DEB,
      linewidth: 1.5,
      transparent: true,
      opacity: 0.7,
    });
    mat200.resolution.set(w0, h0);
    ringGroup.add(new Line2(geo200, mat200));

    lineMaterials.push(mat1000, mat200);
    outerRingMats.push(mat1000);

    // ── Submarine meshes (hidden until ocean data loads) ──
    for (let i = 0; i < SUBS_PER_RING; i++) {
      const subMat = new THREE.MeshBasicMaterial({
        map: subTex,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(subPlaneGeo, subMat);
      mesh.visible = false;
      subGroup.add(mesh);

      submarines.push({
        sprite: mesh,
        group: subGroup,
        home: new THREE.Vector3(),      // fixed ocean position
        phase: Math.random() * Math.PI * 2,  // stagger the bob
        bobSpeed: 0.4 + Math.random() * 0.3, // subtle variation
      });
    }

    // Orient both groups so north pole aligns with location direction
    ringGroup.quaternion.setFromUnitVectors(NORTH_POLE, dir);
    subGroup.quaternion.setFromUnitVectors(NORTH_POLE, dir);

    // Ring group rotates, sub group stays static
    scene.add(ringGroup);
    scene.add(subGroup);
    ringGroups.push({ group: ringGroup, axis: dir });
    missionEntries.push({ mission: m, center3D });
  }

  /* ── hover ──────────────────────────────────────────────── */
  const mouse = { x: -9999, y: -9999 };
  cw.addEventListener('pointermove', (e) => {
    const r = cw.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
  });

  function checkHover() {
    const w = cw.clientWidth;
    const h = cw.clientHeight;
    let best = null;
    let bestD = HOVER_PX;
    for (const entry of missionEntries) {
      const s = toScreen(entry.center3D, camera, w, h);
      const d = Math.hypot(s.x - mouse.x, s.y - mouse.y);
      if (d < bestD) { bestD = d; best = entry.mission; }
    }
    if (best && best !== hoveredMission) {
      hoveredMission = best;
      badgeEl.textContent = best.name;
      badgeEl.style.background = 'rgba(68,125,235,.25)';
      badgeEl.style.color = '#447DEB';
      titleEl.textContent = best.name;
      datesEl.textContent = best.dates;
      descEl.textContent = best.description;
      panelEl.classList.add('is-visible');
    } else if (!best && hoveredMission) {
      hoveredMission = null;
      panelEl.classList.remove('is-visible');
    }
  }

  /* ── resize ─────────────────────────────────────────────── */
  function onResize() {
    const w = cw.clientWidth;
    const h = cw.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloomPass.resolution.set(w, h);
    for (const mat of lineMaterials) mat.resolution.set(w, h);

    // Reposition camera distance for new aspect ratio
    const dist = getCameraDistance();
    camera.position.set(0, dist * 0.35, dist * 0.95);
  }
  window.addEventListener('resize', onResize);

  /* ── orient submarine mesh tangent to sphere ────────────── */
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

  /* ── render loop ────────────────────────────────────────── */
  const _sunDir = new THREE.Vector3();
  const _bobTangent = new THREE.Vector3();
  function tick() {
    rafId = requestAnimationFrame(tick);
    const now = performance.now();

    controls.update();
    clouds.rotation.y += 0.0001;

    // Slowly rotate ring groups around their own axis
    for (const { group, axis } of ringGroups) {
      group.rotateOnWorldAxis(axis, 0.002);
    }

    // Pulse outer ring opacity (sine wave between 0.2 and 0.55)
    const pulse = 0.375 + 0.175 * Math.sin(now * 0.002);
    for (const m of outerRingMats) m.opacity = pulse;

    // Once ocean data is loaded, place submarines at fixed ocean spots
    if (!subsReady && oceanData) {
      for (const sub of submarines) {
        sub.home = findOceanPoint(sub.group);
        sub.sprite.position.copy(sub.home);
        orientSub(sub.sprite);
        sub.sprite.visible = true;
      }
      subsReady = true;
    }

    // Submarines bob back and forth in place
    if (subsReady) {
      const t = now * 0.001;
      for (const sub of submarines) {
        const offset = Math.sin(t * sub.bobSpeed + sub.phase) * 0.008;
        _bobTangent.set(0, 1, 0).cross(sub.home).normalize();
        sub.sprite.position.copy(sub.home).addScaledVector(_bobTangent, offset);
        sub.sprite.position.normalize().multiplyScalar(SUB_R);
        orientSub(sub.sprite);
      }
    }

    // Update atmosphere sun direction
    _sunDir.copy(dirLight.position).normalize();
    atmosMat.uniforms.uSunDir.value.copy(_sunDir);
    checkHover();
    composer.render();
  }
  tick();

  return function destroy() {
    cancelAnimationFrame(rafId);
    renderer.dispose();
    controls.dispose();
    window.removeEventListener('resize', onResize);
  };
}
