import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (s) => document.querySelector(s);
const chapters = [...document.querySelectorAll('.chapter')];
const dots = [...document.querySelectorAll('.chapter-nav a')];
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = motionQuery.matches, active = -1, renderer, scene, camera, controls, model;
let paint = [], ready = false, failed = false, visible = true, frame, shadow;
let heroShadow, keyLight, fillLight, cabinLight, rimLight, floorGlow, reflectionRig, previousShadowDoors = -1;
let arrivalRig, arrivalActive = false, arrivalSettle = null, previousArrivalZ = Infinity;
let arrivalFromZ = 0, arrivalElapsed = 0, arrivalLastTime = null;
const wheelHinges = [];
const reflectionNodes = [], reflectionMaterials = [];
const reflectionStrength = { value:0 };
let storyProgress = 0, doorAmount = 0, doorRequested = false;
let viewerActive = false, drawFrame, lastTime = 0;
function requestRender() { if (ready && drawFrame && visible && !failed && !frame) frame = requestAnimationFrame(drawFrame); }
const doorHinges = [];
const sceneNames = ['Presentación', 'Silueta compacta', 'Tomas de aire', 'Alerón trasero', 'Habitáculo', 'Explorar en 3D'];
const mobile = () => innerWidth <= 800;
const touchQuery = matchMedia('(pointer: coarse)');
function updateInteractionHint() {
  $('.gesture-help').textContent = $('#tab-zoom').getAttribute('aria-selected') === 'true'
    ? 'Usa + para acercar y − para alejar.'
    : mobile() || touchQuery.matches
      ? 'Desliza sobre el Exige para girarlo. Ajusta la distancia en Zoom.'
      : 'Arrastra para girar. Para acercar o alejar, abre Zoom.';
}
touchQuery.addEventListener('change', updateInteractionHint);
updateInteractionHint();
const loadDone = () => $('#loader').classList.add('done');
function fail(error) {
  failed = true; finishArrival(); loadDone(); $('#fallback').hidden = false; document.body.dataset.model = 'failed';
  setInteraction(false); $('#toggle-interaction').disabled = true;
  $('#car-poster').removeAttribute('aria-hidden'); $('#car').setAttribute('aria-hidden', 'true');
  $('#viewer-help').textContent = 'Puedes seguir el recorrido. La vista 3D no está disponible por ahora.';
  $('#viewer-status').textContent = 'Mostrando una imagen'; $('#toggle-interaction').textContent = '3D no disponible';
  console.error('La vista 3D no pudo iniciarse:', error);
}
$('#retry').addEventListener('click', () => location.reload());
function updateMotion() {
  document.body.classList.toggle('reduced', reduced);
  $('#motion').setAttribute('aria-pressed', String(reduced));
  $('#motion').setAttribute('aria-label', reduced ? 'Activar movimiento' : 'Reducir movimiento');
  $('#motion span').textContent = reduced ? 'Movimiento reducido' : 'Movimiento activo';
  document.documentElement.style.scrollBehavior = reduced ? 'auto' : 'smooth';
  if (reduced) finishArrival();
  else if (ready && !arrivalActive && !failed) {
    $('#replay-arrival').disabled = false;
    $('#replay-arrival').setAttribute('aria-label', 'Repetir la animación de entrada del Exige');
  }
  if (active >= 0) scrollState();
  requestRender();
}
$('#motion').addEventListener('click', () => { reduced = !reduced; updateMotion(); });
motionQuery.addEventListener('change', e => { reduced = e.matches; updateMotion(); });
updateMotion();

function scrollState() {
  const scroll = window.scrollY;
  let section = 0;
  while (section < chapters.length - 2 && scroll >= chapters[section + 1].offsetTop) section++;
  const next = Math.min(section + 1, chapters.length - 1);
  const segment = THREE.MathUtils.clamp((scroll - chapters[section].offsetTop) / Math.max(1, chapters[next].offsetTop - chapters[section].offsetTop), 0, 1);
  storyProgress = section + segment;
  const i = Math.round(storyProgress);
  if (arrivalActive && scroll > 20 && !arrivalSettle) {
    arrivalSettle = { elapsed:0, z:arrivalRig.position.z, yaw:arrivalRig.rotation.y, pitch:arrivalRig.rotation.x };
    $('#skip-arrival').hidden = true;
  }
  if (i !== active) {
    if (viewerActive) setInteraction(false);
    active = i; document.body.dataset.chapter = String(i);
    chapters.forEach((c, n) => { c.classList.toggle('is-current', i === n); c.inert = i !== n; });
    dots.forEach((d, n) => { d.classList.toggle('active', i === n); if (i === n) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current'); });
    $('#scene-number').textContent = String(i + 1);
    $('#scene-label').textContent = sceneNames[i];
  }
  $('#toggle-interaction').disabled = !ready || failed;
  if (controls) controls.enabled = viewerActive && i === 5;
  $('#car').style.touchAction = viewerActive ? 'none' : 'pan-y';
  document.body.dataset.interactive = String(viewerActive);
  chapters.forEach((c, n) => {
    const distance = Math.abs(storyProgress - n);
    const opacity = reduced ? Number(n === i) : 1 - THREE.MathUtils.smootherstep(distance, .12, .46);
    const shift = reduced ? 0 : THREE.MathUtils.clamp(n - storyProgress, -1, 1) * 18;
    const copy = c.querySelector('.copy');
    c.classList.toggle('is-visible', opacity > .001);
    copy.style.opacity = opacity;
    copy.style.setProperty('--copy-opacity', opacity.toFixed(4));
    copy.style.setProperty('--copy-shift', `${shift.toFixed(2)}px`);
    copy.style.transform = `translateY(${shift.toFixed(2)}px)`;
  });
  updateStorySurface();
  $('#progress').style.width = `${100 * scroll / Math.max(1, document.documentElement.scrollHeight - innerHeight)}%`;
  if (reduced || !ready) updateScenery(targetPose());
  requestRender();
}

// Purpose-built studio compositions for the six editorial chapters.
const poses = [
  { theta:1.07, phi:1.36, radius:6.0, offset:0, vertical:-.12, y:.50, roll:0, shadow:1 },
  { theta:1.57, phi:1.48, radius:7.5, offset:-.18, vertical:-.06, y:.52, roll:0, shadow:1 },
  { theta:1.37, phi:1.42, radius:6.8, offset:-.22, vertical:-.03, y:.55, roll:0, shadow:1 },
  { theta:2.83, phi:1.36, radius:6.7, offset:-.23, vertical:-.04, y:.53, roll:0, shadow:1 },
  { theta:-.95, phi:1.18, radius:6.5, offset:-.22, vertical:0, y:.57, roll:0, shadow:1 },
  { theta:.76, phi:1.27, radius:7.2, offset:.12, vertical:0, y:.52, roll:0, shadow:1 },
];
poses.forEach((p, n) => {
  p.mobileVertical = [-.07, -.24, -.25, -.23, -.24, -.03][n];
  p.mobileOffset = 0;
  p.focusX = 0;
  p.focusZ = 0;
  p.columnFit = n === 2 ? 1 : 0;
  p.doors = n === 4 ? 1 : 0;
  p.cabin = n === 4 ? 1 : 0;
  p.viewer = n === 5 ? 1 : 0;
});
const current = { ...poses[0] };
const storySurfaces = [[255,255,255],[255,255,255],[8,8,8],[255,255,255],[8,8,8],[8,8,8]];
function updateStorySurface() {
  const progress = reduced ? active : storyProgress;
  const index = Math.min(5, Math.floor(progress)), next = Math.min(5, index + 1);
  const blend = THREE.MathUtils.smootherstep(progress - index, .22, .78);
  const rgb = storySurfaces[index].map((value, channel) => Math.round(THREE.MathUtils.lerp(value, storySurfaces[next][channel], blend)));
  const linear = rgb.map(value => { const s=value/255; return s<=.04045 ? s/12.92 : ((s+.055)/1.055)**2.4; });
  const luminance = linear[0]*.2126 + linear[1]*.7152 + linear[2]*.0722;
  const ink = luminance > .18 ? '#080808' : '#ffffff';
  const style = document.body.style;
  style.setProperty('--story-surface', `rgb(${rgb.join(' ')})`);
  style.setProperty('--story-ink', ink);
  style.setProperty('--glass-surface', luminance > .18 ? '#ffffff94' : '#08080894');
  style.setProperty('--hero-glow', (index === 0 ? 1 - blend : 0).toFixed(4));
  style.setProperty('--story-control-line', `${ink}c7`);
  const dark = 1 - THREE.MathUtils.smootherstep(luminance, .02, .6);
  const night = THREE.MathUtils.smootherstep(progress, 4.15, 4.95);
  style.setProperty('--night-studio', night.toFixed(4));
  style.setProperty('--dark-glow', (dark * (1-night)).toFixed(4));
  style.setProperty('--studio-line-opacity', (THREE.MathUtils.lerp(.35, .12, dark) * (1-night)).toFixed(4));
  style.setProperty('--story-word', (THREE.MathUtils.lerp(.045, .022, dark) * (index === 0 ? blend : 1) * (1-night)).toFixed(4));
}
function targetPose() {
  if (reduced) return poses[active];
  const i = Math.min(4, Math.floor(storyProgress));
  const next = i + 1;
  const t = THREE.MathUtils.clamp(storyProgress - i, 0, 1);
  const e = THREE.MathUtils.smootherstep(t, 0, 1);
  return Object.fromEntries(Object.keys(poses[0]).map(k => [k, THREE.MathUtils.lerp(poses[i][k], poses[next][k], e)]));
}
function updateScenery(p) {
  const cabin = p.cabin ?? 0, night = p.viewer ?? 0;
  if (keyLight) keyLight.intensity = 2.3 - .85 * cabin - .5 * night;
  if (fillLight) fillLight.intensity = 1.3 + .3 * cabin - .2 * night;
  if (cabinLight) cabinLight.intensity = 3.2 * cabin;
  if (rimLight) rimLight.intensity = 1.3 + .65 * night;
  reflectionStrength.value = .10 * night;
  if (reflectionRig) reflectionRig.visible = night > .001;
  if (floorGlow) { floorGlow.visible = night > .001; floorGlow.material.opacity = .8 * night; }
  if (scene) scene.environmentIntensity = .85 - .19 * cabin - .13 * night;
  if (shadow) shadow.material.opacity = .52 * p.shadow;
  if (heroShadow) heroShadow.material.opacity = .20 * p.shadow;
}

// Begin just beyond the right edge in the current camera, rather than using
// a fixed distance that leaves a long blank lead-in on different screens.
function arrivalStartDistance() {
  arrivalRig.position.set(0, 0, 0); arrivalRig.rotation.set(0, 0, 0);
  applyPose(poses[0]); camera.updateMatrixWorld(true);
  model.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(model);
  const corners = [];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const point = new THREE.Vector3();
  for (let distance = 0; distance >= -40; distance -= .25) {
    const outside = corners.every(corner => {
      point.copy(corner); point.z += distance; point.project(camera);
      return point.x > 1.06;
    });
    if (outside) return distance;
  }
  return -40;
}
// The car travels along +Z, with wheels turning in their original local axes.
function startArrival() {
  if (!ready || failed || reduced || active !== 0 || scrollY > 20) return;
  arrivalFromZ = arrivalStartDistance();
  arrivalActive = true; arrivalElapsed = 0; arrivalLastTime = null; arrivalSettle = null;
  previousArrivalZ = Infinity;
  arrivalRig.position.z = arrivalFromZ;
  document.body.dataset.arrival = 'running';
  $('#skip-arrival').hidden = false;
  $('#replay-arrival').disabled = true;
  requestRender();
}
function finishArrival() {
  arrivalActive = false; arrivalElapsed = 0; arrivalLastTime = null; arrivalSettle = null;
  if (arrivalRig) { arrivalRig.position.set(0,0,0); arrivalRig.rotation.set(0,0,0); }
  if (shadow) { shadow.position.z = 0; shadow.rotation.z = 0; }
  for (const h of wheelHinges) h.node.quaternion.copy(h.closed);
  $('#skip-arrival').hidden = true;
  $('#replay-arrival').disabled = !ready || reduced || failed;
  $('#replay-arrival').setAttribute('aria-label', reduced ? 'Animación desactivada con movimiento reducido' : 'Repetir la animación de entrada del Exige');
  document.body.dataset.arrival = 'finished';
  if (renderer) renderer.shadowMap.needsUpdate = true;
  requestRender();
}
$('#replay-arrival').addEventListener('click', startArrival);
$('#skip-arrival').addEventListener('click', () => { finishArrival(); $('#replay-arrival').focus(); });
function updateArrival(time) {
  if (!arrivalActive) return false;
  // Count presented frames, so shader work, a slow frame or a hidden tab
  // cannot consume the entrance and teleport the car towards its stop.
  const delta = arrivalLastTime === null ? 0 : Math.min(80, Math.max(0, time - arrivalLastTime));
  arrivalLastTime = time;
  arrivalElapsed += delta;
  if (arrivalSettle) arrivalSettle.elapsed += delta;
  const t = Math.min(1, arrivalSettle ? arrivalSettle.elapsed / 550 : arrivalElapsed / 4200);
  const remaining = Math.pow(1-t, 3);
  const distance = (arrivalSettle ? arrivalSettle.z : arrivalFromZ) * remaining;
  arrivalRig.position.z = distance;
  arrivalRig.rotation.y = arrivalSettle ? arrivalSettle.yaw * remaining : 0;
  arrivalRig.rotation.x = arrivalSettle ? arrivalSettle.pitch * remaining : 0;
  for (const h of wheelHinges) h.node.quaternion.copy(h.rotation.setFromAxisAngle(h.axis,distance/.3)).multiply(h.closed);
  shadow.position.z = distance;
  shadow.rotation.z = arrivalRig.rotation.y;
  if (Math.abs(previousArrivalZ-distance) > .012 || t === 1) { renderer.shadowMap.needsUpdate = true; previousArrivalZ = distance; }
  if (t === 1) { finishArrival(); shadow.position.z=0; shadow.rotation.z=0; return false; }
  return true;
}
function applyPose(p) {
  const fit = mobile() ? Math.max(1, 1.1 / camera.aspect) : 1;
  // Fit the air-intake composition into the right column without masking
  // the canvas. Taller desktop windows need more camera distance.
  const columnFit = mobile() ? 1 : THREE.MathUtils.lerp(1, Math.max(1, 14 / (camera.aspect * p.radius)), p.columnFit);
  const radius = p.radius * fit * columnFit * (mobile() ? 1 + p.viewer * .20 : 1);
  camera.position.set(p.focusX + Math.sin(p.theta) * Math.sin(p.phi) * radius, Math.cos(p.phi) * radius + p.y, p.focusZ + Math.cos(p.theta) * Math.sin(p.phi) * radius);
  camera.up.set(0, 1, 0);
  camera.lookAt(p.focusX, p.y, p.focusZ);
  camera.rotateZ(p.roll);
  const verticalOffset = mobile() ? p.mobileVertical : p.vertical;
  const horizontalOffset = mobile() ? p.mobileOffset : p.offset;
  camera.setViewOffset(innerWidth, innerHeight, innerWidth * horizontalOffset, innerHeight * verticalOffset, innerWidth, innerHeight);
}
function resetView() {
  if (!camera || !controls) return;
  const fit = mobile() ? Math.max(1, 1.1 / camera.aspect) : 1;
  controls.minDistance = 3.3 * fit; controls.maxDistance = 10.5 * fit;
  Object.assign(current, poses[5]);
  if (mobile() && viewerActive) current.mobileVertical = innerHeight < 740 ? .18 : .08;
  applyPose(current); updateScenery(current);
  controls.target.set(0, .52, 0); controls.update();
  setDoorState(false);
  markView('front');
  $('#detail-card').hidden = true; $('#hotspots').hidden = !viewerActive;
  document.body.dataset.detail = 'false'; $('.viewer-tools').hidden = !viewerActive;
  requestRender();
}
function setInteraction(enabled) {
  viewerActive = enabled && ready && !failed;
  if (controls) controls.enabled = viewerActive;
  document.body.dataset.interactive = String(viewerActive);
  $('#toggle-interaction').setAttribute('aria-pressed', String(viewerActive));
  $('#toggle-interaction').textContent = viewerActive ? 'Salir del visor ×' : 'Activar visor ↗';
  $('#viewer-status').textContent = viewerActive ? 'Visor activado' : 'Listo para explorar';
  $('#viewer-help').textContent = viewerActive ? 'Gira el Exige o selecciona un punto para ver más.' : 'Activa el visor para girar el Exige, cambiar su color y abrir las puertas.';
  $('.viewer-tools').hidden = !viewerActive;
  $('#hotspots').hidden = !viewerActive; $('#detail-card').hidden = true;
  document.body.dataset.detail = 'false';
  $('#car').style.touchAction = viewerActive ? 'none' : 'pan-y';
  $('#car').tabIndex = viewerActive ? 0 : -1;
  $('#car').setAttribute('role', viewerActive ? 'group' : 'img');
  $('#car').setAttribute('aria-label', viewerActive ? 'Lotus Exige interactivo. Flechas para girar, más y menos para zoom, Escape para salir.' : 'Vista 3D del Lotus Exige 240');
  if (viewerActive) resetView();
  requestRender();
}
$('#toggle-interaction').addEventListener('click', () => setInteraction(!viewerActive));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('#features-dialog').open) return;
    $('#chapters-menu').open = false;
    if (!$('#detail-card').hidden) { resetView(); lastHotspot?.focus(); return; }
    if (viewerActive) { setInteraction(false); $('#toggle-interaction').focus(); }
  }
});
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const t of tabs) {
    const selected = tab === t;
    t.setAttribute('aria-selected', String(selected)); t.tabIndex = selected ? 0 : -1;
    $('#' + t.getAttribute('aria-controls')).hidden = !selected;
  }
  updateInteractionHint();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[next]); tabs[next].focus();
  });
});
dots.forEach(dot => {
  dot.setAttribute('aria-label', dot.querySelector('span').textContent);
  dot.addEventListener('click', () => { $('#chapters-menu').open = false; });
});
document.addEventListener('click', e => { if (!e.target.closest('#chapters-menu')) $('#chapters-menu').open = false; });
addEventListener('scroll', scrollState, { passive: true });
scrollState();
$('#reset-view').addEventListener('click', resetView);
function markView(name) {
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
}
function setDoorState(open) {
  doorRequested = open;
  $('#toggle-doors').setAttribute('aria-pressed', String(open));
  $('#doors-help').textContent = open ? 'Puertas abiertas. Gira el Exige para mirar dentro.' : 'Abre las puertas para ver el interior.';
  $('#toggle-doors').innerHTML = `${open ? 'Cerrar' : 'Abrir'} puertas <span>${open ? '↙' : '↗'}</span>`;
  requestRender();
}
$('#toggle-doors').addEventListener('click', () => setDoorState(!doorRequested));
const viewSettings = {
  front: { theta:.76, phi:1.27, radius:7.2, y:.52 },
  side: { theta:1.57, phi:1.48, radius:7.3, y:.52 },
  rear: { theta:3.10, phi:1.36, radius:7.1, y:.53 },
  interior: { theta:-1.05, phi:1.22, radius:5.8, y:.58 },
};
function chooseView(name) {
  if (!controls?.enabled) return;
  Object.assign(current, poses[5], viewSettings[name]);
  if (mobile()) current.mobileVertical = innerHeight < 740 ? .18 : .08;
  applyPose(current); controls.target.set(0, current.y, 0); controls.update();
  setDoorState(name === 'interior'); markView(name);
  $('#detail-card').hidden = true; $('#hotspots').hidden = false;
  document.body.dataset.detail = 'false'; $('.viewer-tools').hidden = false; requestRender();
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => chooseView(b.dataset.view)));
const details = {
  air: { title:'Tomas de aire.', description:'Las tomas laterales se sitúan detrás de las puertas. Su acabado oscuro contrasta con la carrocería.', point:[.86,.58,-.38], pose:{theta:1.2,phi:1.4,radius:2.8,y:.55,focusX:.7,focusZ:-.35} },
  wing: { title:'La firma trasera.', description:'El alerón elevado y los cuatro pilotos circulares definen la vista trasera.', point:[.3,1.05,-1.68], pose:{theta:2.65,phi:1.25,radius:3.9,y:.85,focusX:0,focusZ:-1.5} },
  cabin: { title:'Dos plazas.', description:'Las puertas abiertas dejan ver los dos asientos deportivos y el puesto de conducción.', point:[-.45,.88,.05], pose:{theta:-1.1,phi:1.23,radius:5.0,y:.57,focusX:0,focusZ:.05} },
};
let lastHotspot;
document.querySelectorAll('.hotspot[data-detail]').forEach(button => button.addEventListener('click', () => {
  const d = details[button.dataset.detail]; lastHotspot = button;
  $('#detail-title').textContent = d.title; $('#detail-description').textContent = d.description;
  $('#detail-card').hidden = false; $('#hotspots').hidden = true;
  document.body.dataset.detail = 'true'; if (mobile()) $('.viewer-tools').hidden = true;
  Object.assign(current, poses[5], d.pose);
  controls.minDistance = 2.1 * (mobile() ? Math.max(1, 1.1 / camera.aspect) : 1);
  applyPose(current); controls.target.set(current.focusX, current.y, current.focusZ); controls.update();
  markView(''); setDoorState(button.dataset.detail === 'cabin');
  $('#detail-close').focus(); requestRender();
}));
$('#detail-close').addEventListener('click', () => { resetView(); lastHotspot?.focus(); });
function updateHotspots() {
  if (!viewerActive || !$('#detail-card').hidden) return;
  document.querySelectorAll('.hotspot[data-detail]').forEach(button => {
    const p = new THREE.Vector3(...details[button.dataset.detail].point).project(camera);
    const behind = p.z > 1 || p.z < -1;
    const occluded = button.dataset.detail === 'air' && camera.position.x < .3 || button.dataset.detail === 'wing' && camera.position.z > 1.5 && camera.position.y < 1.8;
    button.hidden = behind || occluded;
    button.style.left = `${(p.x + 1) * innerWidth / 2}px`;
    button.style.top = `${(1 - p.y) * innerHeight / 2}px`;
  });
}
$('#features-open').addEventListener('click', () => $('#features-dialog').showModal());
$('#features-close').addEventListener('click', () => $('#features-dialog').close());
document.querySelectorAll('.swatch').forEach(button => button.addEventListener('click', () => {
  paint.forEach(m => m.color.set(button.dataset.color));
  $('#finish-name').textContent = button.dataset.name;
  document.querySelectorAll('.swatch').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  requestRender();
}));

// A faint inverted copy shares geometry and maps with the original. Its
// unlit materials fade with depth below the floor, rather than acting as a mirror.
function createFloorReflection() {
  const mirrored = model.clone(true), sourceNodes = [], mirrorNodes = [], cache = new Map();
  model.traverse(node => sourceNodes.push(node));
  mirrored.traverse(node => mirrorNodes.push(node));
  sourceNodes.forEach((source, index) => {
    const target = mirrorNodes[index];
    reflectionNodes.push({ source, target });
    if (!source.isMesh) return;
    target.castShadow = false; target.receiveShadow = false; target.renderOrder = -2;
    const materialFor = original => {
      if (cache.has(original)) return cache.get(original);
      const material = new THREE.MeshBasicMaterial({color:original.color ?? 0xffffff,
        map:original.map, alphaMap:original.alphaMap, transparent:true,
        opacity:original.opacity ?? 1, depthWrite:false, side:original.side});
      material.onBeforeCompile = shader => {
        shader.uniforms.uFloorReflection = reflectionStrength;
        shader.vertexShader = 'varying float vFloorDepth;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
          '#include <project_vertex>\nvFloorDepth = (modelMatrix * vec4(transformed, 1.0)).y;');
        shader.fragmentShader = 'uniform float uFloorReflection; varying float vFloorDepth;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>',
          'diffuseColor.a *= uFloorReflection * smoothstep(-1.15, -0.02, vFloorDepth);\n#include <alphatest_fragment>');
      };
      material.customProgramCacheKey = () => 'exige-floor-fade-v1';
      cache.set(original, material); reflectionMaterials.push({source:original, target:material});
      return material;
    };
    target.material = Array.isArray(source.material) ? source.material.map(materialFor) : materialFor(source.material);
  });
  // Write only the closest reflected surface first. A transparent copy alone
  // exposes overlapping interior meshes and makes the floor look like an X-ray.
  const depthCopy = model.clone(true), depthNodes = [], depthCache = new Map();
  depthCopy.traverse(node => depthNodes.push(node));
  sourceNodes.forEach((source, index) => {
    const target = depthNodes[index]; reflectionNodes.push({source, target});
    if (!source.isMesh) return;
    target.castShadow = false; target.receiveShadow = false; target.renderOrder = -3;
    const depthFor = original => {
      if (depthCache.has(original)) return depthCache.get(original);
      const material = new THREE.MeshBasicMaterial({map:original.map, alphaMap:original.alphaMap,
        opacity:original.opacity ?? 1, alphaTest:.5, colorWrite:false, depthWrite:true, side:original.side});
      depthCache.set(original, material); return material;
    };
    target.material = Array.isArray(source.material) ? source.material.map(depthFor) : depthFor(source.material);
  });
  reflectionRig = new THREE.Group(); reflectionRig.scale.y = -1; reflectionRig.position.y = -.018;
  reflectionRig.add(depthCopy, mirrored); reflectionRig.visible = false; scene.add(reflectionRig);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  const halo = context.createRadialGradient(64,64,0,64,64,64);
  halo.addColorStop(0,'rgba(255,255,255,.07)');
  halo.addColorStop(.42,'rgba(255,14,73,.075)');
  halo.addColorStop(1,'rgba(255,14,73,0)');
  context.fillStyle = halo; context.fillRect(0,0,128,128);
  floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(9,11), new THREE.MeshBasicMaterial({
    map:new THREE.CanvasTexture(canvas), transparent:true, opacity:0, depthWrite:false, toneMapped:false}));
  floorGlow.rotation.x = -Math.PI / 2; floorGlow.position.y = -.014;
  floorGlow.renderOrder = -1; floorGlow.visible = false; scene.add(floorGlow);
}
function syncFloorReflection() {
  if (!reflectionRig?.visible) return;
  for (const {source, target} of reflectionNodes) {
    target.position.copy(source.position); target.quaternion.copy(source.quaternion); target.scale.copy(source.scale);
    target.visible = source.visible;
  }
  for (const {source, target} of reflectionMaterials) if (source.color) target.color.copy(source.color);
}

async function init() {
  renderer = new THREE.WebGLRenderer({ canvas: $('#car'), alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile() ? 1.5 : 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, .1, 150);
  applyPose(current);
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(room, .04).texture;
  scene.environmentIntensity = .85;
  room.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x333333, 1.25));
  keyLight = new THREE.DirectionalLight(0xffffff, 2.3); keyLight.position.set(3, 6, 4); scene.add(keyLight);
  keyLight.castShadow = true; keyLight.shadow.mapSize.set(1024,1024);
  Object.assign(keyLight.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.5,far:20});
  keyLight.shadow.camera.updateProjectionMatrix(); keyLight.shadow.bias = -.0002; keyLight.shadow.normalBias = .015; keyLight.shadow.radius = 2;
  rimLight = new THREE.DirectionalLight(0xffffff, 1.3); rimLight.position.set(-4, 3, -2); scene.add(rimLight);
  fillLight = new THREE.DirectionalLight(0xffffff, 1.3); fillLight.position.set(1, 2, -5); scene.add(fillLight);
  // Soft overhead fill reveals the seats without flooding the white body.
  cabinLight = new THREE.SpotLight(0xffffff, 0, 4, .5, .9, 2);
  cabinLight.position.set(0, 2, .15); cabinLight.target.position.set(0, .55, .15);
  scene.add(cabinLight, cabinLight.target);
  heroShadow = new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.ShadowMaterial({color:0x000000,opacity:.28}));
  heroShadow.rotation.x = -Math.PI/2; heroShadow.position.y = -.012; heroShadow.receiveShadow = true; scene.add(heroShadow);
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128;
  const ctx = shadowCanvas.getContext('2d'); const gradient = ctx.createRadialGradient(64, 64, 1, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0,0,0,.8)'); gradient.addColorStop(.5, 'rgba(0,0,0,.45)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 5.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false, opacity: .65 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.005; scene.add(shadow);
  controls = new OrbitControls(camera, $('#orbit-surface')); controls.enabled = false; controls.enableDamping = true;
  controls.enablePan = false; controls.minDistance = 3.3; controls.maxDistance = 10.5;
  controls.minPolarAngle = .45; controls.maxPolarAngle = Math.PI / 2 - .02;
  controls.rotateSpeed = .7; controls.enableZoom = false;
  controls.addEventListener('start', () => markView(''));
  controls.addEventListener('change', requestRender);
  // Wheel and two-finger scrolling continue to navigate the story.
  $('#zoom-in').addEventListener('click', () => zoom(.85));
  $('#zoom-out').addEventListener('click', () => zoom(1.18));
  function zoom(factor) { const v = camera.position.clone().sub(controls.target); v.setLength(THREE.MathUtils.clamp(v.length() * factor, controls.minDistance, controls.maxDistance)); camera.position.copy(controls.target).add(v); controls.update(); requestRender(); }
  $('#car').addEventListener('keydown', e => {
    if (!viewerActive) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(.85); }
    if (e.key === '-') { e.preventDefault(); zoom(1.18); }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const sphere = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    if (e.key === 'ArrowLeft') sphere.theta -= .12;
    if (e.key === 'ArrowRight') sphere.theta += .12;
    if (e.key === 'ArrowUp') sphere.phi = Math.max(controls.minPolarAngle, sphere.phi - .1);
    if (e.key === 'ArrowDown') sphere.phi = Math.min(controls.maxPolarAngle, sphere.phi + .1);
    camera.position.copy(new THREE.Vector3().setFromSpherical(sphere).add(controls.target)); controls.update(); markView(''); requestRender();
  });
  const draco = new DRACOLoader(); draco.setDecoderPath('./vendor/draco/');
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync('./assets/lotus-exige-240.glb', e => {
    const percent = e.total ? Math.round(e.loaded / e.total * 95) : 45;
    $('#load-bar').style.width = `${percent}%`; $('#load-label').textContent = `${percent}% · Cargando modelo 3D`;
  });
  model = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(model), center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x; model.position.z -= center.z; model.position.y -= bounds.min.y;
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    materials.forEach(m => {
      if (m.name === 'CAR_chassis.5') { m.roughness = .22; paint.push(m); }
      if (m.name === 'CAR_RIM.3') m.roughness = .32;
      if (m.emissiveIntensity > 1.5) m.emissiveIntensity = 1.5;
    });
  });
  paint = [...new Set(paint)];
  arrivalRig = new THREE.Group(); arrivalRig.add(model); scene.add(arrivalRig);
  model.updateMatrixWorld(true);
  ['WHEEL_LF','WHEEL_RF','WHEEL_LR','WHEEL_RR'].forEach(name=>{
    const node=model.getObjectByName(name); if (!node) return;
    const inverseParent=node.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    wheelHinges.push({node,closed:node.quaternion.clone(),axis:new THREE.Vector3(1,0,0).applyQuaternion(inverseParent),rotation:new THREE.Quaternion()});
  });
  ['DOOR_L','DOOR_R'].forEach((name,index)=>{
    const node=model.getObjectByName(name); if (!node) return;
    const inverseParent=node.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    doorHinges.push({node,closed:node.quaternion.clone(),axis:new THREE.Vector3(0,1,0).applyQuaternion(inverseParent),angle:index===0?-1.05:1.05,rotation:new THREE.Quaternion()});
  });
  createFloorReflection();
  if (!doorHinges.length) { $('#toggle-doors').hidden = true; $('#tab-doors').hidden = true; }
  // Prepare shaders, textures and shadows before starting the visible clock.
  // Keep this warm-up render hidden, then clear it to prevent a parked-car flash.
  document.body.dataset.model = 'preparing';
  $('#load-label').textContent = 'Preparando la vista 3D…';
  scrollState(); Object.assign(current, targetPose());
  applyPose(current); updateScenery(current);
  // Include the reflection in warm-up without displaying it in other chapters.
  reflectionRig.visible = true; floorGlow.visible = true; syncFloorReflection();
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera); renderer.clear();
  updateScenery(current);
  ready = true; scrollState();
  $('#load-bar').style.width = '100%'; loadDone(); draco.dispose();
  $('#car-poster').setAttribute('aria-hidden', 'true');
  lastTime = performance.now();
  drawFrame = function animate(time = performance.now()) {
    frame = 0;
    if (!visible || failed) return;
    let moving = updateArrival(time);
    const easing = 1 - Math.exp(-Math.min(80, time - lastTime) / 95); lastTime = time;
    if (!controls.enabled) {
      const p = targetPose();
      for (const k of Object.keys(current)) {
        if (Math.abs(current[k] - p[k]) > .0001) moving = true;
        current[k] = reduced || Math.abs(current[k] - p[k]) < .0001 ? p[k] : THREE.MathUtils.lerp(current[k], p[k], easing);
      }
      applyPose(current); updateScenery(current);
    } else moving = controls.update();
    const doorTarget = controls.enabled ? Number(doorRequested) : current.doors;
    doorAmount = reduced ? doorTarget : THREE.MathUtils.lerp(doorAmount, doorTarget, easing);
    if (Math.abs(doorAmount - doorTarget) > .001) moving = true;
    else doorAmount = doorTarget;
    for (const h of doorHinges) h.node.quaternion.copy(h.rotation.setFromAxisAngle(h.axis,h.angle*doorAmount)).multiply(h.closed);
    if (Math.abs(previousShadowDoors - doorAmount) > .01) {
      renderer.shadowMap.needsUpdate = true; previousShadowDoors = doorAmount;
    }
    syncFloorReflection();
    renderer.render(scene, camera);
    document.body.dataset.model = 'ready';
    updateHotspots();
    if (moving) requestRender();
  };
  if (active === 0 && !reduced && scrollY <= 20) startArrival(); else finishArrival();
  requestRender();
}
addEventListener('resize', () => {
  updateInteractionHint();
  if (!renderer) return;
  renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  active === 5 ? resetView() : applyPose(current); scrollState();
});
document.addEventListener('visibilitychange', () => { visible = !document.hidden; arrivalLastTime = null; if (visible) requestRender(); });
$('#car').addEventListener('webglcontextlost', e => { e.preventDefault(); cancelAnimationFrame(frame); fail('Se perdió el contexto WebGL.'); });
init().catch(fail);
