import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

const BODY_PART_MAP = {
  knee:     { position: new THREE.Vector3(0, -0.6, 0.1) },
  chest:    { position: new THREE.Vector3(0, 0.3, 0.1) },
  shoulder: { position: new THREE.Vector3(0.4, 0.5, 0) },
  head:     { position: new THREE.Vector3(0, 1.2, 0) },
  abdomen:  { position: new THREE.Vector3(0, 0.1, 0.1) },
  ankle:    { position: new THREE.Vector3(0, -1.4, 0) },
  arm:      { position: new THREE.Vector3(0.5, 0.2, 0) },
  hip:      { position: new THREE.Vector3(0.2, -0.3, 0) },
};

function getHighlight(bodyPart) {
  if (!bodyPart) return null;
  const key = bodyPart.toLowerCase();
  for (const [k, v] of Object.entries(BODY_PART_MAP)) {
    if (key.includes(k)) return v;
  }
  return null;
}

export default function BodyMap({ bodyPart }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const glowSphereRef = useRef(null);

  useEffect(() => {
    const container = mountRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // ── SCENE ──
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1421);
    sceneRef.current = scene;

    // ── CAMERA ──
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0.5, 3);

    // ── RENDERER ──
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // ── LIGHTS ──
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(2, 4, 3);
    scene.add(dir);
    const rim = new THREE.DirectionalLight(0x4488ff, 0.4);
    rim.position.set(-2, 1, -2);
    scene.add(rim);

    // ── CONTROLS ──
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1;
    controls.maxDistance = 8;
    controls.target.set(0, 0.5, 0);

    // ── GLOW SPHERE (shows affected area) ──
    const glowGeo = new THREE.SphereGeometry(0.08, 16, 16);
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xff2222,
      emissive: 0xff0000,
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 0.85,
    });
    const glowSphere = new THREE.Mesh(glowGeo, glowMat);
    glowSphere.visible = false;
    scene.add(glowSphere);
    glowSphereRef.current = glowSphere;

    // ── LOAD GLB ──
    const loader = new GLTFLoader();
    loader.load(
      // 👇 replace this with your actual filename
      '/male_body.glb',
      (gltf) => {
        const model = gltf.scene;

        // auto center + scale
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 2.5 / maxDim;
        model.scale.setScalar(scale);
        model.position.sub(center.multiplyScalar(scale));

        scene.add(model);

        // log mesh names so you can map them
        model.traverse(child => {
          if (child.isMesh) console.log('mesh:', child.name);
        });

        // place glow on body part
        const highlight = getHighlight(bodyPart);
        if (highlight) {
          glowSphere.position.copy(highlight.position);
          glowSphere.visible = true;
        }
      },
      (xhr) => console.log('Loading:', Math.round(xhr.loaded / xhr.total * 100) + '%'),
      (err) => console.error('GLB load error:', err)
    );

    // ── ANIMATE ──
    let frameId;
    let t = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      t += 0.05;
      // pulse the glow
      if (glowSphereRef.current && glowSphereRef.current.visible) {
        glowSphereRef.current.material.emissiveIntensity = 1 + Math.sin(t) * 0.6;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // ── RESIZE ──
    const onResize = () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', onResize);
      container.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [bodyPart]);

  return (
    <div style={styles.wrapper}>
      <span style={styles.label}>3d body map</span>
      <div ref={mountRef} style={styles.canvas} />
      <span style={styles.hint}>drag to rotate · scroll to zoom</span>
    </div>
  );
}

const styles = {
  wrapper: {
    width: '100%',
    background: '#0d1421',
    border: '0.5px solid #1e2a3a',
    borderRadius: 10,
    position: 'relative',
    minHeight: 340,
    display: 'flex',
    flexDirection: 'column',
  },
  canvas: {
    flex: 1,
    minHeight: 300,
    borderRadius: 10,
    overflow: 'hidden',
  },
  label: {
    position: 'absolute',
    top: 10, left: 12,
    fontSize: 10,
    fontFamily: "'IBM Plex Mono', monospace",
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    zIndex: 1,
  },
  hint: {
    position: 'absolute',
    bottom: 10, left: 0, right: 0,
    textAlign: 'center',
    fontSize: 10,
    fontFamily: "'IBM Plex Mono', monospace",
    color: '#334155',
    zIndex: 1,
  },
};