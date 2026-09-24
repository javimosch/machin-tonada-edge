// Three.js scene: the tonada-edge box GLB on a studio backdrop, LED driven by the engine.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function initScene(container, glbUrl, onReady) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d12);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

  const cam = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
  cam.position.set(1.9, 1.25, 2.6);
  cam.lookAt(0, 0.2, 0);

  // ground + backdrop
  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6, 0.02, 64),
    new THREE.MeshStandardMaterial({ color: 0x1a140d, roughness: 0.7 }));
  ground.position.y = -0.02;
  scene.add(ground);
  const key = new THREE.DirectionalLight(0xfff0dd, 2.2); key.position.set(-2.5, 3.5, -2.0); scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.7); fill.position.set(2.8, 1.8, -1.2); scene.add(fill);
  const ledLight = new THREE.PointLight(0x3fd8e0, 0.0, 1.5); ledLight.position.set(0.05, 0.25, -0.7); scene.add(ledLight);

  let ledMat = null, box = null;
  // glb: URL string (dev) or ArrayBuffer (embedded single-file build — no fetch under strict CSP)
  const loader = new GLTFLoader();
  const onGLB = (g) => {
    box = g.scene;
    scene.add(box);
    box.traverse((o) => {
      if (o.name === 'TopPlate' && o.material) {
        o.material = o.material.clone();
        o.material.color.multiplyScalar(0.35);
        o.material.roughness = 0.75;
      }
      if (o.name === 'Enclosure' && o.material) {
        o.material = o.material.clone();
        o.material.color.multiplyScalar(0.7);
        o.material.roughness = 0.6;
      }
      if (o.name === 'StatusLED' && o.material) {
        ledMat = o.material.clone();           // own instance so we can animate it
        ledMat.emissive = new THREE.Color(0x3fd8e0);
        ledMat.emissiveIntensity = 2.0;
        o.material = ledMat;
      }
      if (o.name === 'LEDBezel' && o.material) { o.material = o.material.clone(); o.material.metalness = 0.8; }
    });
    onReady?.();
  };
  if (typeof glbUrl === 'string') loader.load(glbUrl, onGLB);
  else loader.parse(glbUrl, '', onGLB, (e) => console.error('GLB parse failed', e));

  // LED state: color + pulse (bpm), offline blink pattern
  const led = { color: new THREE.Color(0x3fd8e0), pulseHz: 1.2, mode: 'breathe', level: 1, powered: false };
  function setPower(on) { led.powered = on; }
  function setLED(d) {
    if (!d) return;
    const moodColors = { calm: 0x35c8d0, warm: 0xffb454, bright: 0x7ee787, driving: 0xe0489a, celebratory: 0xffd24d, late: 0x4d6bff };
    led.color.set(d.source === 'cache' ? 0xffb454 : (moodColors[d.mood] ?? 0x3fd8e0));
    led.pulseHz = Math.max(0.4, (d.bpm || 90) / 60);
    led.mode = d.source === 'cache' ? 'blink' : 'breathe';
    led.level = 0.4 + 0.6 * (d.energy ?? 0.5);
  }

  // subtle idle motion + LED animation
  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    const t = clock.getElapsedTime();
    if (ledMat) {
      if (!led.powered) {
        ledMat.emissiveIntensity = 0; ledLight.intensity = 0;
      } else {
        let k;
        if (led.mode === 'blink') {
          k = (t % 1.4 < 0.12 || (t % 1.4 > 0.25 && t % 1.4 < 0.37)) ? 1.0 : 0.05;  // offline double-blink
        } else {
          k = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * led.pulseHz * Math.PI * 2)) ** 2;
        }
        ledMat.emissive.copy(led.color);
        ledMat.emissiveIntensity = (0.4 + 1.6 * k) * led.level + 0.2;
        ledLight.color.copy(led.color);
        ledLight.intensity = 1.1 * k * led.level;
      }
    }
    if (box) box.rotation.y = Math.sin(t * 0.15) * 0.06;
    renderer.render(scene, cam);
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize(); frame();
  return { setLED, setPower };
}
