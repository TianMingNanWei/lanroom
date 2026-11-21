import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry, Position } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import type { MapCountry, MapLink, MapMember, ServerNode } from "./api";
import { alphaFromId } from "./iso";

const GLOBE_RADIUS = 1;
const DEG2RAD = Math.PI / 180;

export type SelectedEntity =
  | { kind: "server"; server: ServerNode }
  | { kind: "member"; member: MapMember }
  | { kind: "link"; link: MapLink };

export type Globe3DHandle = {
  focusLatLon: (lat: number, lon: number, distance?: number) => void;
  focusServer: () => void;
  fitAll: () => void;
};

type Globe3DProps = {
  server: ServerNode | null;
  members: MapMember[];
  links: MapLink[];
  countries: MapCountry[];
  isLoginMode: boolean;
  autoRotate: boolean;
  showControlLinks: boolean;
  selectedId: string | null;
  onSelect: (entity: SelectedEntity | null) => void;
};

type PositionedMember = {
  member: MapMember;
  lat: number;
  lon: number;
  id: string;
};

type HoverState = {
  x: number;
  y: number;
  title: string;
  subtitle: string;
  badge?: string;
  badgeColor?: string;
};

type AnimatedPulse = {
  mesh: THREE.Mesh;
  curve: THREE.QuadraticBezierCurve3;
  speed: number;
  offset: number;
  reverse: boolean;
};

type AnimatedRing = {
  mesh: THREE.Mesh;
  phase: number;
  speed: number;
  maxScale: number;
  baseOpacity: number;
};

type TrackedLabel = {
  id: string;
  text: string;
  sub?: string;
  kind: "server" | "node";
  color: string;
  position: THREE.Vector3;
  priority: number;
};

type PickMeta =
  | { kind: "server"; server: ServerNode; title: string; subtitle: string; badge: string; badgeColor: string }
  | { kind: "member"; member: MapMember; title: string; subtitle: string; badge: string; badgeColor: string }
  | { kind: "link"; link: MapLink; title: string; subtitle: string; badge: string; badgeColor: string };

const worldFeatures = (() => {
  const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  return feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>;
})();

function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (lon + 180) * DEG2RAD;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function buildEarthTexture(countries: MapCountry[]): THREE.CanvasTexture {
  const width = 2048;
  const height = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // Deep ocean gradient
  const ocean = ctx.createLinearGradient(0, 0, 0, height);
  ocean.addColorStop(0, "#040b18");
  ocean.addColorStop(0.25, "#07152b");
  ocean.addColorStop(0.5, "#0a1c38");
  ocean.addColorStop(0.75, "#07152b");
  ocean.addColorStop(1, "#040b18");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, width, height);

  // Subtle lat/lon grid painted onto ocean surface
  ctx.strokeStyle = "rgba(56, 189, 248, 0.065)";
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 15) {
    const x = ((lon + 180) / 360) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const y = ((90 - lat) / 180) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const countMap = new Map(countries.map((c) => [c.country, c.count]));
  const maxCount = Math.max(1, ...countries.map((c) => c.count));

  const project = ([lon, lat]: Position): [number, number] => [
    ((lon + 180) / 360) * width,
    ((90 - lat) / 180) * height,
  ];

  const traceRing = (ring: Position[]) => {
    if (ring.length < 2) return;
    let [prevX, prevY] = project(ring[0]);
    ctx.moveTo(prevX, prevY);
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = project(ring[i]);
      // Avoid anti-meridian horizontal streak
      if (Math.abs(x - prevX) > width * 0.5) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      prevX = x;
      prevY = y;
    }
    ctx.closePath();
  };

  for (const feat of worldFeatures.features) {
    const code = alphaFromId(String(feat.id ?? ""));
    const active = countMap.get(code) || 0;
    const geom = feat.geometry;
    if (!geom) continue;

    ctx.beginPath();
    if (geom.type === "Polygon") {
      geom.coordinates.forEach(traceRing);
    } else if (geom.type === "MultiPolygon") {
      geom.coordinates.forEach((poly) => poly.forEach(traceRing));
    }

    if (active > 0) {
      const ratio = active / maxCount;
      ctx.fillStyle = `rgba(14, 165, 233, ${0.24 + ratio * 0.34})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(56, 189, 248, ${0.65 + ratio * 0.3})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    } else {
      ctx.fillStyle = "#10203a";
      ctx.fill();
      ctx.strokeStyle = "rgba(96, 165, 250, 0.24)";
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function createAtmosphereMesh(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.13, 64, 64);
  const mat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vPositionNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPositionNormal = normalize((modelViewMatrix * vec4(position, 1.0)).xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vPositionNormal;
      void main() {
        float intensity = pow(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.2);
        vec3 glow = mix(vec3(0.14, 0.52, 0.95), vec3(0.22, 0.82, 0.98), clamp(intensity * 1.4, 0.0, 1.0));
        gl_FragColor = vec4(glow, clamp(intensity * 1.05, 0.0, 0.85));
      }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

function createStarfield(): THREE.Points {
  const count = 1200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 10 + Math.random() * 18;
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    const tint = Math.random();
    const c = tint > 0.7 ? new THREE.Color("#7dd3fc") : tint > 0.4 ? new THREE.Color("#c4b5fd") : new THREE.Color("#e2e8f0");
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.055,
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

function spreadMembers(members: MapMember[], server: ServerNode | null): { list: PositionedMember[]; coordById: Map<string, [number, number]> } {
  const coordById = new Map<string, [number, number]>();
  const buckets = new Map<string, MapMember[]>();
  const serverKey =
    server && server.lat != null && server.lon != null ? `${server.lat.toFixed(2)},${server.lon.toFixed(2)}` : "";

  for (const member of members) {
    if (member.lat == null || member.lon == null) continue;
    const key = `${member.lat.toFixed(2)},${member.lon.toFixed(2)}`;
    const group = buckets.get(key) ?? [];
    group.push(member);
    buckets.set(key, group);
  }

  const list: PositionedMember[] = [];
  for (const [key, group] of buckets.entries()) {
    const sharesServer = key === serverKey;
    const total = group.length;
    group.forEach((member, idx) => {
      const id = member.id || `${member.room}:${member.mac}:${idx}`;
      let lat = member.lat as number;
      let lon = member.lon as number;
      if (total > 1 || sharesServer) {
        const angle = (idx / Math.max(total, 1)) * Math.PI * 2 + (sharesServer ? 0.55 : 0.25);
        const radiusDeg = sharesServer ? 1.15 : Math.min(1.2, 0.5 + total * 0.12);
        lat = Math.max(-84, Math.min(84, lat + Math.sin(angle) * radiusDeg));
        lon = lon + Math.cos(angle) * radiusDeg;
      }
      coordById.set(id, [lat, lon]);
      list.push({ member, lat, lon, id });
    });
  }
  return { list, coordById };
}

function orientToSurface(obj: THREE.Object3D, surfacePos: THREE.Vector3) {
  const normal = surfacePos.clone().normalize();
  obj.position.copy(surfacePos);
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
}

function modeColor(member: MapMember, isLoginMode: boolean): string {
  if (isLoginMode) {
    if (member.mac === "ok") return "#22d3ee";
    if (member.mac === "logout") return "#94a3b8";
    return "#f43f5e";
  }
  if (member.mode === "direct" || member.direct) return "#10b981";
  if (member.mode === "relay" || member.tcpRelay) return "#f59e0b";
  return "#38bdf8";
}

function modeLabel(member: MapMember, isLoginMode: boolean): string {
  if (isLoginMode) {
    if (member.mac === "ok") return "登录成功";
    if (member.mac === "logout") return "主动退出";
    return "登录失败";
  }
  if (member.mode === "direct" || member.direct) return "P2P 直连";
  if (member.mode === "relay" || member.tcpRelay) return "服务器中转";
  return "单节点待机";
}

function disposeGroup(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    child.traverse((node) => {
      if ((node as THREE.Mesh).geometry) {
        (node as THREE.Mesh).geometry.dispose();
      }
      const mat = (node as THREE.Mesh).material;
      if (Array.isArray(mat)) {
        mat.forEach((m) => m.dispose());
      } else if (mat) {
        mat.dispose();
      }
    });
  }
}

export const Globe3D = forwardRef<Globe3DHandle, Globe3DProps>(function Globe3D(
  { server, members, links, countries, isLoginMode, autoRotate, showControlLinks, selectedId, onSelect },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [webglError, setWebglError] = useState("");

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;
  const serverRef = useRef(server);
  serverRef.current = server;
  const membersRef = useRef(members);
  membersRef.current = members;

  // Scene refs for incremental data updates without recreating WebGL context
  const sceneCtxRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    earthMat: THREE.MeshPhongMaterial;
    dynamicGroup: THREE.Group;
    pickables: THREE.Object3D[];
    pulses: AnimatedPulse[];
    rings: AnimatedRing[];
    serverCrystal: THREE.Mesh | null;
    labels: TrackedLabel[];
    flyTarget: { startPos: THREE.Vector3; endPos: THREE.Vector3; startTime: number; duration: number } | null;
    isDragging: boolean;
  } | null>(null);

  const flyToLatLon = (lat: number, lon: number, distance = 2.45) => {
    const ctx = sceneCtxRef.current;
    if (!ctx) return;
    const targetDir = latLonToVec3(lat, lon, 1).normalize();
    const endPos = targetDir.multiplyScalar(distance);
    ctx.flyTarget = {
      startPos: ctx.camera.position.clone(),
      endPos,
      startTime: performance.now(),
      duration: 900,
    };
  };

  useImperativeHandle(ref, () => ({
    focusLatLon: (lat, lon, distance) => flyToLatLon(lat, lon, distance ?? 2.35),
    focusServer: () => {
      const s = serverRef.current;
      if (s && s.lat != null && s.lon != null) {
        flyToLatLon(s.lat, s.lon, 2.35);
      } else {
        flyToLatLon(34, 108, 2.7);
      }
    },
    fitAll: () => {
      const pts: [number, number][] = [];
      const s = serverRef.current;
      if (s && s.lat != null && s.lon != null) pts.push([s.lat, s.lon]);
      for (const m of membersRef.current) {
        if (m.lat != null && m.lon != null) pts.push([m.lat, m.lon]);
      }
      if (pts.length === 0) {
        flyToLatLon(26, 108, 2.85);
        return;
      }
      let sumVec = new THREE.Vector3();
      for (const [la, lo] of pts) {
        sumVec.add(latLonToVec3(la, lo, 1));
      }
      if (sumVec.lengthSq() < 0.001) {
        flyToLatLon(pts[0][0], pts[0][1], 3.1);
        return;
      }
      sumVec.normalize();
      const lat = 90 - Math.acos(Math.max(-1, Math.min(1, sumVec.y))) / DEG2RAD;
      const lon = Math.atan2(sumVec.z, -sumVec.x) / DEG2RAD - 180;
      const normLon = ((lon + 540) % 360) - 180;
      let maxAngle = 0;
      for (const [la, lo] of pts) {
        const v = latLonToVec3(la, lo, 1);
        maxAngle = Math.max(maxAngle, sumVec.angleTo(v));
      }
      const dist = Math.min(3.55, Math.max(2.35, 2.15 + maxAngle * 1.15));
      flyToLatLon(lat, normLon, dist);
    },
  }));

  // 1. Initialize Three.js scene once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      setWebglError("当前浏览器不支持 WebGL，请切换至 2D 平面视图。");
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(42, Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight), 0.1, 100);
    // Start facing Asia / Beijing so the globe looks immediately meaningful
    camera.position.copy(latLonToVec3(26, 110, 2.58));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.rotateSpeed = 0.58;
    controls.zoomSpeed = 0.85;
    controls.minDistance = 1.42;
    controls.maxDistance = 4.6;
    controls.autoRotate = autoRotateRef.current;
    controls.autoRotateSpeed = 0.35;

    // Lighting
    const ambient = new THREE.AmbientLight("#a8c8f0", 1.55);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight("#e0f2fe", 1.35);
    keyLight.position.set(5, 3, 5);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight("#6366f1", 0.7);
    rimLight.position.set(-5, -2, -4);
    scene.add(rimLight);

    // Stars
    const stars = createStarfield();
    scene.add(stars);

    // Earth sphere
    const earthGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 72, 72);
    const earthTexture = buildEarthTexture([]);
    const earthMat = new THREE.MeshPhongMaterial({
      map: earthTexture,
      specular: new THREE.Color("#1d4ed8"),
      shininess: 14,
      emissive: new THREE.Color("#071429"),
      emissiveIntensity: 0.42,
    });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earthMesh);

    // Fresnel atmosphere
    const atmosphere = createAtmosphereMesh();
    scene.add(atmosphere);

    // Dynamic markers & 3D arcs group
    const dynamicGroup = new THREE.Group();
    scene.add(dynamicGroup);

    const ctx = {
      scene,
      camera,
      controls,
      earthMat,
      dynamicGroup,
      pickables: [] as THREE.Object3D[],
      pulses: [] as AnimatedPulse[],
      rings: [] as AnimatedRing[],
      serverCrystal: null as THREE.Mesh | null,
      labels: [] as TrackedLabel[],
      flyTarget: null as { startPos: THREE.Vector3; endPos: THREE.Vector3; startTime: number; duration: number } | null,
      isDragging: false,
    };
    sceneCtxRef.current = ctx;

    // Interaction: pause autoRotate during drag & raycast hover/click
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onControlStart = () => {
      ctx.isDragging = true;
      ctx.flyTarget = null;
    };
    const onControlEnd = () => {
      ctx.isDragging = false;
    };
    controls.addEventListener("start", onControlStart);
    controls.addEventListener("end", onControlEnd);

    const pickAt = (clientX: number, clientY: number): PickMeta | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(ctx.pickables, false);
      if (hits.length === 0) return null;
      return (hits[0].object.userData as PickMeta) || null;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (ctx.isDragging) {
        setHover(null);
        return;
      }
      const meta = pickAt(e.clientX, e.clientY);
      const rect = renderer.domElement.getBoundingClientRect();
      if (meta) {
        renderer.domElement.style.cursor = "pointer";
        setHover({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          title: meta.title,
          subtitle: meta.subtitle,
          badge: meta.badge,
          badgeColor: meta.badgeColor,
        });
      } else {
        renderer.domElement.style.cursor = "grab";
        setHover(null);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 6) return; // dragged, not clicked
      const meta = pickAt(e.clientX, e.clientY);
      if (!meta) return;
      if (meta.kind === "server") {
        onSelectRef.current({ kind: "server", server: meta.server });
        if (meta.server.lat != null && meta.server.lon != null) {
          flyToLatLon(meta.server.lat, meta.server.lon, 2.25);
        }
      } else if (meta.kind === "member") {
        onSelectRef.current({ kind: "member", member: meta.member });
        if (meta.member.lat != null && meta.member.lon != null) {
          flyToLatLon(meta.member.lat, meta.member.lon, 2.25);
        }
      } else if (meta.kind === "link") {
        onSelectRef.current({ kind: "link", link: meta.link });
      }
    };

    const onPointerLeave = () => setHover(null);

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    // Resize observer
    const ro = new ResizeObserver(() => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    // Animation loop
    let rafId = 0;
    const tempVec = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    const labelNodes = new Map<string, HTMLDivElement>();

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      const t = now * 0.001;

      controls.autoRotate = autoRotateRef.current && !ctx.isDragging && !ctx.flyTarget;

      // Smooth spherical fly-to tween
      if (ctx.flyTarget) {
        const progress = Math.min(1, (now - ctx.flyTarget.startTime) / ctx.flyTarget.duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const startLen = ctx.flyTarget.startPos.length();
        const endLen = ctx.flyTarget.endPos.length();
        const dirA = ctx.flyTarget.startPos.clone().normalize();
        const dirB = ctx.flyTarget.endPos.clone().normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(dirA, dirB);
        const stepQ = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), q, eased);
        const curDir = dirA.applyQuaternion(stepQ).normalize();
        const curLen = startLen + (endLen - startLen) * eased;
        camera.position.copy(curDir.multiplyScalar(curLen));
        camera.lookAt(0, 0, 0);
        if (progress >= 1) {
          ctx.flyTarget = null;
        }
      }

      controls.update();

      // Rotate floating server octahedron
      if (ctx.serverCrystal) {
        ctx.serverCrystal.rotation.y = t * 1.4;
        ctx.serverCrystal.rotation.x = Math.sin(t * 0.9) * 0.25;
      }

      // Animate expanding pulse rings
      for (const ring of ctx.rings) {
        const cycle = (t * ring.speed + ring.phase) % 1;
        const scale = 1 + cycle * ring.maxScale;
        ring.mesh.scale.set(scale, scale, 1);
        const mat = ring.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = (1 - cycle) * (1 - cycle) * ring.baseOpacity;
      }

      // Animate streaming light pulses along 3D arcs
      for (const pulse of ctx.pulses) {
        const raw = (t * pulse.speed + pulse.offset) % 1;
        const u = pulse.reverse ? 1 - raw : raw;
        pulse.curve.getPoint(u, pulse.mesh.position);
        const edgeFade = Math.sin(u * Math.PI);
        const s = 0.65 + edgeFade * 0.7;
        pulse.mesh.scale.setScalar(s);
      }

      stars.rotation.y = t * 0.008;

      renderer.render(scene, camera);

      // Update projected 2D HTML labels (direct DOM transform, zero React overhead)
      const labelRoot = labelLayerRef.current;
      if (labelRoot) {
        const width = container.clientWidth;
        const height = container.clientHeight;
        camDir.copy(camera.position).normalize();
        const activeIds = new Set<string>();

        for (const item of ctx.labels) {
          activeIds.add(item.id);
          let el = labelNodes.get(item.id);
          if (!el) {
            el = document.createElement("div");
            el.className =
              item.kind === "server"
                ? "pointer-events-none absolute left-0 top-0 -translate-x-1/2 -translate-y-full rounded-full border border-violet-400/50 bg-[#0d1026]/90 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-violet-100 shadow-[0_0_20px_rgba(139,92,246,0.5)] backdrop-blur-md whitespace-nowrap"
                : "pointer-events-none absolute left-0 top-0 -translate-x-1/2 -translate-y-full rounded-full border border-slate-500/30 bg-[#071122]/85 px-2 py-0.5 text-[10px] text-slate-200 shadow-lg backdrop-blur-sm whitespace-nowrap";
            el.innerHTML =
              item.kind === "server"
                ? `<span style="display:inline-block;width:6px;height:6px;border-radius:99px;background:${item.color};margin-right:6px;box-shadow:0 0 8px ${item.color}"></span>${item.text}`
                : `<span style="display:inline-block;width:5px;height:5px;border-radius:99px;background:${item.color};margin-right:5px"></span>${item.text}`;
            labelRoot.appendChild(el);
            labelNodes.set(item.id, el);
          }

          // Hide when behind the Earth horizon
          const dot = item.position.clone().normalize().dot(camDir);
          if (dot < 0.08) {
            el.style.opacity = "0";
            continue;
          }
          tempVec.copy(item.position).project(camera);
          const x = (tempVec.x * 0.5 + 0.5) * width;
          const y = (-tempVec.y * 0.5 + 0.5) * height - (item.kind === "server" ? 14 : 10);
          el.style.opacity = String(Math.min(1, (dot - 0.08) * 3.2));
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
        }

        for (const [id, el] of labelNodes.entries()) {
          if (!activeIds.has(id)) {
            el.remove();
            labelNodes.delete(id);
          }
        }
      }
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.removeEventListener("start", onControlStart);
      controls.removeEventListener("end", onControlEnd);
      controls.dispose();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      disposeGroup(dynamicGroup);
      earthGeo.dispose();
      earthMat.map?.dispose();
      earthMat.dispose();
      (atmosphere.geometry as THREE.BufferGeometry).dispose();
      (atmosphere.material as THREE.Material).dispose();
      (stars.geometry as THREE.BufferGeometry).dispose();
      (stars.material as THREE.Material).dispose();
      renderer.dispose();
      if (labelLayerRef.current) labelLayerRef.current.innerHTML = "";
      sceneCtxRef.current = null;
    };
  }, []);

  // 2. Refresh earth texture when active countries change
  useEffect(() => {
    const ctx = sceneCtxRef.current;
    if (!ctx) return;
    const nextTex = buildEarthTexture(countries);
    const prevTex = ctx.earthMat.map;
    ctx.earthMat.map = nextTex;
    ctx.earthMat.needsUpdate = true;
    prevTex?.dispose();
  }, [countries]);

  // 3. Rebuild 3D server spire, client node beacons, and 3D communication arcs when telemetry updates
  useEffect(() => {
    const ctx = sceneCtxRef.current;
    if (!ctx) return;

    disposeGroup(ctx.dynamicGroup);
    ctx.pickables = [];
    ctx.pulses = [];
    ctx.rings = [];
    ctx.serverCrystal = null;
    ctx.labels = [];

    const { list: positionedMembers, coordById } = spreadMembers(members, server);

    // A. Render Server 3D Spire
    if (server && server.lat != null && server.lon != null) {
      const basePos = latLonToVec3(server.lat, server.lon, GLOBE_RADIUS + 0.004);
      const serverGroup = new THREE.Group();
      orientToSurface(serverGroup, basePos);

      // Base glowing disc
      const baseDisc = new THREE.Mesh(
        new THREE.CircleGeometry(0.024, 32),
        new THREE.MeshBasicMaterial({ color: "#a855f7", transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      );
      baseDisc.rotation.x = -Math.PI / 2;
      serverGroup.add(baseDisc);

      // Vertical glowing spire beam
      const spireHeight = 0.14;
      const spire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0025, 0.011, spireHeight, 16),
        new THREE.MeshBasicMaterial({
          color: "#8b5cf6",
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      spire.position.y = spireHeight / 2;
      serverGroup.add(spire);

      // Floating rotating diamond crystal at spire top
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.024, 0),
        new THREE.MeshBasicMaterial({ color: "#e9d5ff" }),
      );
      crystal.position.y = spireHeight + 0.022;
      serverGroup.add(crystal);
      ctx.serverCrystal = crystal;

      // Outer wireframe halo on crystal
      const crystalHalo = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.036, 0),
        new THREE.MeshBasicMaterial({ color: "#a855f7", wireframe: true, transparent: true, opacity: 0.7 }),
      );
      crystalHalo.position.y = spireHeight + 0.022;
      serverGroup.add(crystalHalo);

      // Double expanding radar rings
      for (let i = 0; i < 2; i++) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.022, 0.032, 40),
          new THREE.MeshBasicMaterial({
            color: "#c084fc",
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.002;
        serverGroup.add(ring);
        ctx.rings.push({ mesh: ring, phase: i * 0.5, speed: 0.45, maxScale: 3.4, baseOpacity: 0.85 });
      }

      // Hit sphere for picking
      const hitMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.065, 12, 12),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hitMesh.position.y = spireHeight * 0.6;
      hitMesh.userData = {
        kind: "server",
        server,
        title: server.name || "Lanroom 主节点",
        subtitle: `${server.city || "机房"} ${server.country || ""} · ${server.ip}`,
        badge: "SERVER",
        badgeColor: "#a855f7",
      } satisfies PickMeta;
      serverGroup.add(hitMesh);
      ctx.pickables.push(hitMesh);

      ctx.dynamicGroup.add(serverGroup);

      const labelPos = latLonToVec3(server.lat, server.lon, GLOBE_RADIUS + spireHeight + 0.055);
      ctx.labels.push({
        id: "server-label",
        text: `${server.name || "SERVER"}${server.city ? ` · ${server.city}` : ""}`,
        kind: "server",
        color: "#c084fc",
        position: labelPos,
        priority: 100,
      });
    }

    // B. Render Client Node 3D Beacons
    positionedMembers.forEach(({ member, lat, lon, id }, index) => {
      const color = modeColor(member, isLoginMode);
      const isSelected = selectedId === id;
      const basePos = latLonToVec3(lat, lon, GLOBE_RADIUS + 0.004);
      const nodeGroup = new THREE.Group();
      orientToSurface(nodeGroup, basePos);

      const pinHeight = isSelected ? 0.075 : 0.048;

      // Glowing vertical light pin
      const pin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.002, 0.006, pinHeight, 10),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.88,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      pin.position.y = pinHeight / 2;
      nodeGroup.add(pin);

      // Glowing head orb
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(isSelected ? 0.019 : 0.013, 16, 16),
        new THREE.MeshBasicMaterial({ color }),
      );
      head.position.y = pinHeight;
      nodeGroup.add(head);

      // Expanding pulse ring
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.012, 0.019, 32),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.78,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.002;
      nodeGroup.add(ring);
      ctx.rings.push({
        mesh: ring,
        phase: (index * 0.27) % 1,
        speed: isSelected ? 0.85 : 0.55,
        maxScale: isSelected ? 3.5 : 2.6,
        baseOpacity: 0.8,
      });

      // Invisible larger hit collider
      const hitMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 10, 10),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hitMesh.position.y = pinHeight * 0.6;
      hitMesh.userData = {
        kind: "member",
        member,
        title: isLoginMode ? `${member.owner} (${member.source})` : `${member.room} · ${member.virtualIp}`,
        subtitle: `${member.city || "未定位"} ${member.country || ""} · ${member.source}`,
        badge: modeLabel(member, isLoginMode),
        badgeColor: color,
      } satisfies PickMeta;
      nodeGroup.add(hitMesh);
      ctx.pickables.push(hitMesh);

      ctx.dynamicGroup.add(nodeGroup);

      // Show crisp floating label for up to 14 active member nodes (or selected)
      if (!isLoginMode && (positionedMembers.length <= 14 || isSelected)) {
        const labelPos = latLonToVec3(lat, lon, GLOBE_RADIUS + pinHeight + 0.025);
        ctx.labels.push({
          id: `node-${id}`,
          text: `${member.virtualIp}${member.city ? ` · ${member.city}` : ""}`,
          kind: "node",
          color,
          position: labelPos,
          priority: isSelected ? 90 : 50,
        });
      }
    });

    // C. Render 3D Elevated Communication Arcs + Streaming Light Pulses
    if (!isLoginMode) {
      const visibleLinks = links.filter((link) => showControlLinks || link.kind !== "control");
      visibleLinks.forEach((link, idx) => {
        const fromSpread = coordById.get(link.fromId);
        const toSpread = link.toId === "server" ? null : coordById.get(link.toId);
        const fromLat = fromSpread ? fromSpread[0] : link.from.lat;
        const fromLon = fromSpread ? fromSpread[1] : link.from.lon;
        const toLat = toSpread ? toSpread[0] : link.to.lat;
        const toLon = toSpread ? toSpread[1] : link.to.lon;

        const start = latLonToVec3(fromLat, fromLon, GLOBE_RADIUS + 0.012);
        const end = latLonToVec3(toLat, toLon, GLOBE_RADIUS + (link.toId === "server" ? 0.095 : 0.012));

        const angle = start.clone().normalize().angleTo(end.clone().normalize());
        const baseLift = link.kind === "direct" ? 0.22 : link.kind === "relay" ? 0.18 : 0.12;
        const lift = Math.min(0.62, Math.max(baseLift, angle * 0.42));

        const mid = start.clone().add(end);
        if (mid.lengthSq() < 1e-4) {
          mid.set(0, 1, 0);
        }
        mid.normalize().multiplyScalar(GLOBE_RADIUS + lift);

        const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
        const isSelected = selectedId === link.id;
        const arcColor =
          link.kind === "direct" ? "#10b981" : link.kind === "relay" ? "#f59e0b" : "#38bdf8";
        const pulseColor =
          link.kind === "direct" ? "#6ee7b7" : link.kind === "relay" ? "#fde68a" : "#7dd3fc";

        if (link.kind === "control") {
          const pts = curve.getPoints(48);
          const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
          const lineMat = new THREE.LineDashedMaterial({
            color: arcColor,
            dashSize: 0.025,
            gapSize: 0.02,
            transparent: true,
            opacity: isSelected ? 0.85 : 0.3,
          });
          const line = new THREE.Line(lineGeo, lineMat);
          line.computeLineDistances();
          ctx.dynamicGroup.add(line);
        } else {
          // Outer soft glowing 3D tube
          const tubeRadius = isSelected ? 0.0068 : 0.0042;
          const tube = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 56, tubeRadius, 8, false),
            new THREE.MeshBasicMaterial({
              color: arcColor,
              transparent: true,
              opacity: isSelected ? 0.95 : 0.65,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          );
          ctx.dynamicGroup.add(tube);

          // Crisp bright core line
          const pts = curve.getPoints(56);
          const coreLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({
              color: pulseColor,
              transparent: true,
              opacity: isSelected ? 1 : 0.8,
              blending: THREE.AdditiveBlending,
            }),
          );
          ctx.dynamicGroup.add(coreLine);

          // Bidirectional streaming data light pulses along the 3D arc
          const pulseCount = 2;
          for (let p = 0; p < pulseCount; p++) {
            const pulseMesh = new THREE.Mesh(
              new THREE.SphereGeometry(0.011, 10, 10),
              new THREE.MeshBasicMaterial({
                color: "#ffffff",
                transparent: true,
                opacity: 0.95,
              }),
            );
            const haloMesh = new THREE.Mesh(
              new THREE.SphereGeometry(0.022, 10, 10),
              new THREE.MeshBasicMaterial({
                color: pulseColor,
                transparent: true,
                opacity: 0.5,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
              }),
            );
            pulseMesh.add(haloMesh);
            ctx.dynamicGroup.add(pulseMesh);
            ctx.pulses.push({
              mesh: pulseMesh,
              curve,
              speed: link.kind === "direct" ? 0.42 : 0.32,
              offset: (idx * 0.19 + p * 0.5) % 1,
              reverse: p % 2 === 1,
            });
          }

          // Thicker invisible tube for easy hovering/clicking on 3D arc
          const hitTube = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 24, 0.018, 6, false),
            new THREE.MeshBasicMaterial({ visible: false }),
          );
          hitTube.userData = {
            kind: "link",
            link,
            title: `${link.from.label} ↔ ${link.to.label}`,
            subtitle: `房间 ${link.room}${link.relayCount ? ` · 累计中转 ${link.relayCount} 帧` : ""}`,
            badge: link.kind === "direct" ? "P2P 3D 直连" : "服务器 3D 中转",
            badgeColor: arcColor,
          } satisfies PickMeta;
          ctx.dynamicGroup.add(hitTube);
          ctx.pickables.push(hitTube);
        }
      });
    }
  }, [server, members, links, isLoginMode, showControlLinks, selectedId]);

  if (webglError) {
    return (
      <div className="grid h-full min-h-[540px] place-items-center rounded-2xl border border-slate-700/40 bg-[#060d1c] p-8 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-sm font-medium text-slate-200">{webglError}</p>
          <p className="text-xs text-slate-400">可点击右上角切换到 2D 平面视图查看节点与链路。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(ellipse_at_center,#0b1936_0%,#050a14_72%)]">
      <div ref={mountRef} className="h-full w-full cursor-grab active:cursor-grabbing" />
      <div ref={labelLayerRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
      {hover && (
        <div
          className="hud-glass pointer-events-none absolute z-30 max-w-xs rounded-xl px-3 py-2 text-xs text-slate-100 transition-opacity duration-100"
          style={{
            left: Math.min(hover.x + 14, (mountRef.current?.clientWidth ?? 800) - 240),
            top: Math.max(12, hover.y - 12),
          }}
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white">{hover.title}</span>
            {hover.badge && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: `${hover.badgeColor}24`,
                  color: hover.badgeColor,
                  border: `1px solid ${hover.badgeColor}55`,
                }}
              >
                {hover.badge}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-300">{hover.subtitle}</p>
        </div>
      )}
    </div>
  );
});
