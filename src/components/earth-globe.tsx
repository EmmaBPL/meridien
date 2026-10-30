import { useEffect, useRef } from "react";
import * as THREE from "three";
import { CITIES, nearestCity, type City } from "@/lib/cities";
import { latLonToXYZ, subsolar } from "@/lib/geo";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

export type ThemeName = "orbite" | "contact";

type Focus = { lat: number; lon: number; city: City | null };

const LIVE_KM = 520;
const SNAP_KM = 1450;

function textureUrl(file: string): string {
  const path = `/textures/${file}`;
  if (typeof window === "undefined") return path;
  const { hostname, pathname } = window.location;
  // Android APK WebView serves the shell at https://appassets…/assets/www/.
  if (hostname === "appassets.androidplatform.net" || pathname.startsWith("/assets/www/")) {
    return `/assets/www/textures/${file}`;
  }
  const prefix = previewPathPrefix(hostname, pathname) ?? "";
  return `${prefix}${path}`;
}

function configureMap(texture: THREE.Texture): THREE.Texture {
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function homeCity(): City {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    CITIES.find((c) => c.home && c.tz === tz) ??
    CITIES.find((c) => c.tz === tz) ??
    CITIES.find((c) => c.name === "Paris") ??
    CITIES[0]
  );
}

function facingQuaternion(lat: number, lon: number): THREE.Quaternion {
  const [x, y, z] = latLonToXYZ(lat, lon);
  const local = new THREE.Vector3(x, y, z).normalize();
  const focus = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(local, focus);
  const north = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const nProj = north.sub(focus.clone().multiplyScalar(north.dot(focus)));
  if (nProj.lengthSq() < 1e-8) return q;
  nProj.normalize();
  const upProj = new THREE.Vector3(0, 1, 0).sub(focus.clone().multiplyScalar(focus.y));
  if (upProj.lengthSq() < 1e-8) return q;
  upProj.normalize();
  return new THREE.Quaternion().setFromUnitVectors(nProj, upProj).multiply(q);
}

const earthVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const earthFrag = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDirection;
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 sun = normalize(sunDirection);
    float ndl = dot(n, sun);
    float dayMix = smoothstep(-0.12, 0.28, ndl);
    float terminator = smoothstep(-0.02, 0.08, ndl) * smoothstep(0.42, 0.02, ndl);
    vec3 dayCol = texture2D(dayMap, vUv).rgb;
    vec3 nightCol = texture2D(nightMap, vUv).rgb * vec3(1.25, 1.12, 0.9);
    vec3 color = mix(nightCol, dayCol, dayMix);
    color += vec3(1.0, 0.42, 0.16) * terminator * 0.22;
    gl_FragColor = vec4(color, 1.0);
  }
`;

const atmoVert = /* glsl */ `
  varying vec3 vNormalW;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const atmoFrag = /* glsl */ `
  uniform vec3 atmColor;
  varying vec3 vNormalW;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vNormalW), vec3(0.0, 0.0, 1.0))), 2.6);
    gl_FragColor = vec4(atmColor, fres * 0.85);
  }
`;

export function EarthGlobe({
  theme,
  onFocus,
  onStatus,
  onSpin,
}: {
  theme: ThemeName;
  onFocus: (focus: Focus) => void;
  onStatus: (status: "loading" | "ready" | "error") => void;
  onSpin: () => void;
}) {
  const stageElRef = useRef<HTMLDivElement>(null);
  const zoomApi = useRef<(factor: number) => void>(() => {});
  const themeRef = useRef(theme);
  const onFocusRef = useRef(onFocus);
  const onStatusRef = useRef(onStatus);
  const onSpinRef = useRef(onSpin);
  themeRef.current = theme;
  onFocusRef.current = onFocus;
  onStatusRef.current = onStatus;
  onSpinRef.current = onSpin;

  useEffect(() => {
    const root = stageElRef.current;
    if (!root) return;
    const stage: HTMLDivElement = root;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(themeRef.current === "contact" ? 0x10282c : 0x07080c, 1);
    const canvas = renderer.domElement;
    canvas.className = "globe-canvas";
    stage.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.08, 80);
    camera.position.set(0, 0, 3.4);
    camera.lookAt(0, 0, 0);

    const stars = makeStars();
    scene.add(stars);

    const globe = new THREE.Group();
    scene.add(globe);

    const atmoMat = new THREE.ShaderMaterial({
      uniforms: { atmColor: { value: new THREE.Vector3(0.55, 0.68, 0.95) } },
      vertexShader: atmoVert,
      fragmentShader: atmoFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
    });
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.045, 64, 48), atmoMat);
    scene.add(atmo);
    const orbiteAtm = new THREE.Vector3(0.55, 0.68, 0.95);
    const contactAtm = new THREE.Vector3(0.45, 0.72, 0.68);

    const start = homeCity();
    let facingLat = start.lat;
    let facingLon = start.lon;
    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let pinching = false;
    let coasting = false;
    let snapping = false;
    let snapT = 0;
    let snapFromLat = start.lat;
    let snapFromLon = start.lon;
    let snapToLat = start.lat;
    let snapToLon = start.lon;
    let lastX = 0;
    let lastY = 0;
    let lastMoveAt = 0;
    let vLat = 0;
    let vLon = 0;
    let zoom = 1;
    let zoomTarget = 1;
    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    let lastKey = "";
    let sunStamp = 0;
    let disposed = false;
    let zoomLabel = "";

    const LAT_LIMIT = 84;
    const ZOOM_MIN = 0.68;
    const ZOOM_MAX = 4.4;

    function wrapLon(lon: number): number {
      return ((((lon + 180) % 360) + 360) % 360) - 180;
    }

    function lerpAngle(from: number, to: number, t: number): number {
      const delta = ((((to - from) % 360) + 540) % 360) - 180;
      return wrapLon(from + delta * t);
    }

    function clamp(value: number, min: number, max: number): number {
      return Math.max(min, Math.min(max, value));
    }

    function applyFacing() {
      globe.quaternion.copy(facingQuaternion(facingLat, facingLon));
    }

    applyFacing();

    zoomApi.current = (factor: number) => {
      zoomTarget = clamp(zoomTarget * factor, ZOOM_MIN, ZOOM_MAX);
    };

    let earth: THREE.Mesh | null = null;

    const loader = new THREE.TextureLoader();
    onStatusRef.current("loading");
    void Promise.all([
      loader.loadAsync(textureUrl("earth-day.jpg")),
      loader.loadAsync(textureUrl("earth-night.jpg")),
    ])
      .then(([day, night]) => {
        if (disposed) {
          day.dispose();
          night.dispose();
          return;
        }
        const material = new THREE.ShaderMaterial({
          uniforms: {
            dayMap: { value: configureMap(day) },
            nightMap: { value: configureMap(night) },
            sunDirection: { value: new THREE.Vector3(1, 0, 0) },
          },
          vertexShader: earthVert,
          fragmentShader: earthFrag,
        });
        earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), material);
        globe.add(earth);
        applySun(material, true);
        onStatusRef.current("ready");
        emit(true);
      })
      .catch(() => {
        if (!disposed) onStatusRef.current("error");
      });

    function applySun(material: THREE.ShaderMaterial, force = false) {
      const now = Date.now();
      if (!force && now - sunStamp < 30_000) return;
      sunStamp = now;
      const sun = subsolar(new Date());
      const [x, y, z] = latLonToXYZ(sun.lat, sun.lon);
      material.uniforms.sunDirection.value.set(x, y, z);
    }

    function focusLatLon(): { lat: number; lon: number } {
      return { lat: facingLat, lon: wrapLon(facingLon) };
    }

    function emit(force = false) {
      const { lat, lon } = focusLatLon();
      const city = nearestCity(lat, lon, snapping ? SNAP_KM : LIVE_KM);
      const key = `${city?.name ?? ""}|${lat.toFixed(1)}|${lon.toFixed(1)}`;
      if (!force && key === lastKey) return;
      lastKey = key;
      onFocusRef.current({ lat, lon, city });
    }

    function beginSnap() {
      const { lat, lon } = focusLatLon();
      const city = nearestCity(lat, lon, SNAP_KM);
      emit(true);
      if (!city) return;
      const toLat = clamp(city.lat, -LAT_LIMIT, LAT_LIMIT);
      const toLon = city.lon;
      const dLat = Math.abs(toLat - facingLat);
      const dLon = Math.abs(((((toLon - facingLon) % 360) + 540) % 360) - 180);
      if (reduced || (dLat < 0.35 && dLon < 0.35)) {
        facingLat = toLat;
        facingLon = wrapLon(toLon);
        applyFacing();
        emit(true);
        return;
      }
      snapFromLat = facingLat;
      snapFromLon = facingLon;
      snapToLat = toLat;
      snapToLon = toLon;
      snapT = 0;
      snapping = true;
    }

    function dragScale(): number {
      const height = Math.max(canvas.clientHeight, 1);
      return 170 / height / Math.max(zoom, ZOOM_MIN);
    }

    function pinchSpan(): number {
      const pts = [...pointers.values()];
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }

    function onPointerDown(event: PointerEvent) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      coasting = false;
      snapping = false;
      vLat = 0;
      vLon = 0;
      if (pointers.size >= 2) {
        dragging = false;
        pinching = true;
        pinchStartDist = pinchSpan();
        pinchStartZoom = zoomTarget;
        stage.dataset.dragging = "true";
        return;
      }
      pinching = false;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      lastMoveAt = performance.now();
      stage.dataset.dragging = "true";
      onSpinRef.current();
    }

    function onPointerMove(event: PointerEvent) {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinching && pointers.size >= 2) {
        const span = pinchSpan();
        if (pinchStartDist > 12 && span > 0) {
          const next = clamp(pinchStartZoom * (span / pinchStartDist), ZOOM_MIN, ZOOM_MAX);
          zoom = next;
          zoomTarget = next;
        }
        return;
      }
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (dx === 0 && dy === 0) return;
      const scale = dragScale();
      const dLon = -dx * scale;
      const dLat = dy * scale;
      facingLon = wrapLon(facingLon + dLon);
      const nextLat = facingLat + dLat;
      facingLat = clamp(nextLat, -LAT_LIMIT, LAT_LIMIT);
      if (facingLat !== nextLat) vLat = 0;
      applyFacing();
      const now = performance.now();
      const dtMove = clamp((now - lastMoveAt) / 1000, 0.008, 0.05);
      vLon = dLon / dtMove;
      vLat = facingLat === nextLat ? dLat / dtMove : 0;
      const speed = Math.hypot(vLon, vLat);
      const maxSpeed = 240;
      if (speed > maxSpeed) {
        const k = maxSpeed / speed;
        vLon *= k;
        vLat *= k;
      }
      lastX = event.clientX;
      lastY = event.clientY;
      lastMoveAt = now;
      emit();
    }

    function onPointerUp(event: PointerEvent) {
      pointers.delete(event.pointerId);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (pointers.size >= 2) return;
      if (pinching) {
        pinching = false;
        dragging = false;
        vLat = 0;
        vLon = 0;
        delete stage.dataset.dragging;
        return;
      }
      if (!dragging) {
        delete stage.dataset.dragging;
        return;
      }
      dragging = false;
      delete stage.dataset.dragging;
      if (!reduced && Math.hypot(vLon, vLat) > 14) coasting = true;
      else {
        vLat = 0;
        vLon = 0;
        beginSnap();
      }
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      let delta = event.deltaY;
      if (event.deltaMode === 1) delta *= 16;
      else if (event.deltaMode === 2) delta *= canvas.clientHeight || 800;
      zoomTarget = clamp(zoomTarget * Math.exp(-delta * 0.0016), ZOOM_MIN, ZOOM_MAX);
    }

    function resize() {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (w < 2 || h < 2) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    }

    function targetDistance(): number {
      const aspect = camera.aspect || 1;
      const vFov = (camera.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
      const dist = Math.max(1.18 / Math.tan(vFov / 2), 1.18 / Math.tan(hFov / 2));
      const themeMul = themeRef.current === "contact" ? 0.9 : 1.04;
      const base = dist * themeMul;
      return clamp(base / zoom, 1.38, base * 1.7);
    }

    const clock = new THREE.Timer();
    clock.connect(document);
    resize();
    camera.position.set(0, 0, targetDistance());
    camera.lookAt(0, 0, 0);
    const observer = new ResizeObserver(resize);
    observer.observe(root);

    renderer.setAnimationLoop(() => {
      if (disposed) return;
      clock.update();
      const dt = Math.min(clock.getDelta(), 0.05);
      const themeName = themeRef.current;
      stars.visible = themeName === "orbite";
      renderer.setClearColor(themeName === "contact" ? 0x10282c : 0x07080c, 1);
      const atmColor = atmoMat.uniforms.atmColor.value as THREE.Vector3;
      atmColor.lerp(themeName === "contact" ? contactAtm : orbiteAtm, 1 - Math.exp(-4 * dt));

      zoom += (zoomTarget - zoom) * (1 - Math.exp(-12 * dt));
      const desiredZ = targetDistance();
      const nextZ = camera.position.z + (desiredZ - camera.position.z) * (1 - Math.exp(-9 * dt));
      camera.position.set(0, 0, nextZ);
      camera.lookAt(0, 0, 0);
      const label = zoom.toFixed(2);
      if (label !== zoomLabel) {
        zoomLabel = label;
        stage.dataset.zoom = label;
      }

      if (coasting && !dragging && !pinching) {
        facingLon = wrapLon(facingLon + vLon * dt);
        const nextLat = facingLat + vLat * dt;
        if (nextLat > LAT_LIMIT || nextLat < -LAT_LIMIT) {
          facingLat = clamp(nextLat, -LAT_LIMIT, LAT_LIMIT);
          vLat = 0;
        } else {
          facingLat = nextLat;
        }
        applyFacing();
        const decay = Math.exp(-3.6 * dt);
        vLon *= decay;
        vLat *= decay;
        emit();
        if (Math.hypot(vLon, vLat) < 8) {
          coasting = false;
          vLon = 0;
          vLat = 0;
          beginSnap();
        }
      }

      if (snapping) {
        snapT = Math.min(1, snapT + dt / 0.46);
        const k = snapT * snapT * (3 - 2 * snapT);
        facingLat = snapFromLat + (snapToLat - snapFromLat) * k;
        facingLon = lerpAngle(snapFromLon, snapToLon, k);
        applyFacing();
        emit();
        if (snapT >= 1) {
          snapping = false;
          facingLat = snapToLat;
          facingLon = wrapLon(snapToLon);
          applyFacing();
          emit(true);
        }
      }

      if (earth) applySun(earth.material as THREE.ShaderMaterial);
      renderer.render(scene, camera);
    });

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    emit(true);

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      zoomApi.current = () => {};
      scene.traverse((obj: THREE.Object3D) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        const list = Array.isArray(material) ? material : material ? [material] : [];
        for (const item of list) {
          const shader = item as THREE.ShaderMaterial;
          const maps = shader.uniforms as
            | {
                dayMap?: { value: THREE.Texture | null };
                nightMap?: { value: THREE.Texture | null };
              }
            | undefined;
          maps?.dayMap?.value?.dispose();
          maps?.nightMap?.value?.dispose();
          item.dispose();
        }
      });
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  return (
    <div ref={stageElRef} className="globe-stage" data-theme={theme}>
      <div className="vignette" />
      <div className="meridian" />
      <div className="focus-dot" />
      <div className="zoom-controls">
        <button type="button" aria-label="Zoomer" onClick={() => zoomApi.current(1.22)}>
          +
        </button>
        <button type="button" aria-label="Dézoomer" onClick={() => zoomApi.current(1 / 1.22)}>
          −
        </button>
      </div>
    </div>
  );
}

function makeStars(): THREE.Points {
  const count = 700;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
      .normalize()
      .multiplyScalar(28 + Math.random() * 10);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xf3efe6,
      size: 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    }),
  );
}
