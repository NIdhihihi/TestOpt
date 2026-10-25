import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const PALETTE = [0x8b5cf6, 0x38bdf8, 0xfbbf24, 0xf97316, 0x34d399, 0xe879f9];
export default function VisualScene({ city = false, analysis, tests = [], changedFiles = [], phase = 0, paused = false }) {
  const host = useRef(null);
  const state = useRef({ phase, paused });
  useEffect(() => { state.current = { phase, paused }; }, [phase, paused]);
  // Rebuild geometry only when the real source/test graph changes, not on animation frames.
  const graph = JSON.stringify({ analysis, tests: tests.map(test => ({ path: test.path, modules: test.modules, score: test.score, decision: test.decision, status: test.result?.status })), changedFiles });
  useEffect(() => {
    const element = host.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
    catch { element.dataset.fallback = 'true'; return undefined; }
    const data = JSON.parse(graph);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(city ? 50 : 55, 1, 0.1, 300);
    renderer.setClearColor(0x070b16); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const geometries = [], materials = [], shapes = [], floors = [], buildings = [], labels = [];
    const material = (color, opacity = 1) => { const item = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity }); materials.push(item); return item; };
    const lineMaterial = color => { const item = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }); materials.push(item); return item; };
    const geometry = item => { geometries.push(item); return item; };
    let ring, crystal, wave;
    if (!city) {
      camera.position.z = 30;
      const geo = geometry(new THREE.IcosahedronGeometry(1, 0));
      for (let index = 0; index < 38; index++) {
        const seed = index * 2.399963;
        const mesh = new THREE.Mesh(geo, material(PALETTE[index % 5], 0.28)); mesh.material.wireframe = true;
        mesh.position.set(Math.sin(seed * 1.7) * 35, Math.cos(seed * 1.3) * 20, -25 + (index % 10) * 3);
        mesh.scale.setScalar(0.5 + (index % 8) * 0.23); scene.add(mesh);
        shapes.push({ mesh, speed: 0.1 + (index % 6) * 0.1, phase: seed, y: mesh.position.y });
      }
    } else {
      scene.fog = new THREE.Fog(0x070b16, 38, 120);
      const grid = new THREE.GridHelper(44, 44, 0x1d2745, 0x121a31); scene.add(grid);
      geometries.push(grid.geometry); materials.push(grid.material);
      const names = data.analysis?.modules || [];
      const side = Math.max(3, Math.ceil(Math.sqrt(names.length + 1)));
      names.slice(0, 60).forEach((name, index) => {
        let x = (index % side - (side - 1) / 2) * 5;
        const z = (Math.floor(index / side) - (side - 1) / 2) * 5;
        if (Math.abs(x) < 0.5 && Math.abs(z) < 0.5) x += 5;
        const related = data.tests.filter(test => test.modules.includes(name));
        const count = Math.max(1, related.length), height = count * 0.4 + 0.2;
        const pos = new THREE.Vector3(x, 0, z);
        const changed = data.changedFiles.includes(name);
        const impacted = related.some(test => test.decision === 'Run');
        const edge = new THREE.LineSegments(geometry(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.3, height, 2.3))), lineMaterial(0x2e3a5c));
        edge.position.set(x, height / 2, z); scene.add(edge);
        const road = new THREE.Mesh(geometry(new THREE.BoxGeometry(pos.length(), 0.025, 0.16)), material(0x222b47));
        road.position.set(x / 2, 0.02, z / 2); road.rotation.y = -Math.atan2(z, x); scene.add(road);
        for (let floor = 0; floor < Math.min(related.length || 1, 30); floor++) {
          const mesh = new THREE.Mesh(geometry(new THREE.BoxGeometry(2.1, 0.3, 2.1)), material(0x232b45, 0.95));
          mesh.position.set(x, 0.25 + floor * 0.4, z); scene.add(mesh); floors.push({ mesh, changed, impacted, test: related[floor] });
        }
        const label = document.createElement('span'); label.className = 'city-label'; label.textContent = name.replace(/^src\//, ''); element.appendChild(label); labels.push(label);
        let beam;
        if (changed) { beam = new THREE.Mesh(geometry(new THREE.CylinderGeometry(0.12, 0.12, 25, 8)), material(0xc4b5fd, 0.25)); beam.position.set(x, 12.5, z); scene.add(beam); }
        buildings.push({ name, pos, edge, road, changed, impacted, top: height + 0.8, label, beam });
      });
      const base = new THREE.Mesh(geometry(new THREE.CylinderGeometry(1.4, 1.6, 0.5, 8)), material(0x1a2340)); base.position.y = 0.25; scene.add(base);
      ring = new THREE.Mesh(geometry(new THREE.TorusGeometry(1.45, 0.07, 8, 48)), material(0x8b5cf6)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.52; scene.add(ring);
      crystal = new THREE.Mesh(geometry(new THREE.OctahedronGeometry(0.8, 0)), material(0x7dd3fc)); crystal.material.wireframe = true; crystal.position.y = 2.2; scene.add(crystal);
      wave = new THREE.Mesh(geometry(new THREE.TorusGeometry(1, 0.04, 6, 64)), material(0xe879f9, 0)); wave.rotation.x = Math.PI / 2; wave.position.y = 0.08; scene.add(wave);
    }
    const resize = () => { const width = element.clientWidth || window.innerWidth, height = element.clientHeight || window.innerHeight; renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); };
    let pointerX = 0, pointerY = 0, frame, clock = 0, last = performance.now();
    const pointer = event => { pointerX = event.clientX / window.innerWidth - 0.5; pointerY = event.clientY / window.innerHeight - 0.5; };
    const vector = new THREE.Vector3();
    resize(); window.addEventListener('resize', resize); window.addEventListener('pointermove', pointer);
    const loop = now => {
      const delta = Math.min(0.05, (now - last) / 1000); last = now;
      if (!reduced && !state.current.paused) clock += delta;
      if (!city) {
        shapes.forEach(item => { item.mesh.rotation.x = clock * item.speed; item.mesh.rotation.y = clock * item.speed * 1.3; item.mesh.position.y = item.y + (reduced ? 0 : Math.sin(clock * 0.5 + item.phase) * 1.5); });
        camera.position.x += (pointerX * 6 - camera.position.x) * 0.03; camera.position.y += (-pointerY * 4 - camera.position.y) * 0.03; camera.lookAt(0, 0, 0);
      } else {
        const stage = state.current.phase;
        floors.forEach(item => {
          let color = 0x232b45;
          if (stage === 0) color = item.changed ? 0x8b5cf6 : 0x232b45;
          if (stage === 1) color = item.changed || item.impacted ? 0x38bdf8 : 0x232b45;
          if (stage === 2) color = item.test?.score != null ? item.test.score >= 0.5 ? 0xfbbf24 : 0x60a5fa : 0x232b45;
          if (stage >= 3) color = item.test?.decision === 'Run' ? 0xf97316 : 0x3a4258;
          if (stage >= 4 && item.test?.status) color = item.test.status === 'PASSED' ? 0x34d399 : ['FAILED', 'ERROR'].includes(item.test.status) ? 0xfb7185 : 0x64748b;
          item.mesh.material.color.lerp(new THREE.Color(color), 0.12);
        });
        buildings.forEach(item => { item.edge.material.color.setHex(item.changed && stage === 0 ? 0xc4b5fd : item.impacted && stage < 4 ? 0x38bdf8 : 0x2e3a5c); if (item.beam) item.beam.material.opacity = stage === 0 ? 0.2 + Math.sin(clock * 2) * 0.12 : 0; });
        ring.material.color.setHex(PALETTE[stage] || PALETTE[0]); crystal.rotation.y = clock; crystal.rotation.x = clock * 0.5; crystal.position.y = 2.2 + Math.sin(clock * 1.5) * 0.15;
        const pulse = (clock * 0.2) % 1; wave.visible = stage === 3 || stage === 5; wave.scale.setScalar(1 + pulse * 16); wave.material.opacity = (1 - pulse) * 0.6;
        const radius = Math.max(24, 17 / camera.aspect, Math.sqrt(buildings.length) * 6);
        const angle = (reduced ? 0.6 : clock * 0.045) + pointerX * 0.4;
        camera.position.set(Math.sin(angle) * radius, radius * 0.55, Math.cos(angle) * radius); camera.lookAt(0, 1.5, 0); camera.updateMatrixWorld();
        buildings.forEach(item => { vector.set(item.pos.x, item.top, item.pos.z).project(camera); item.label.style.left = `${(vector.x * 0.5 + 0.5) * element.clientWidth}px`; item.label.style.top = `${(-vector.y * 0.5 + 0.5) * element.clientHeight}px`; item.label.hidden = vector.z > 1; });
      }
      renderer.render(scene, camera); frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); window.removeEventListener('pointermove', pointer); labels.forEach(label => label.remove()); geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); renderer.dispose(); renderer.domElement.remove(); };
  }, [city, graph]);
  return <div ref={host} className={city ? 'scene city-scene' : 'scene backdrop'} aria-hidden="true" />;
}
