import * as THREE from "three";

import { createSpringBotany } from "./hero-spring-botany";
import { createSpringLife } from "./hero-spring-life";

export function createHeroAtmosphere(canvas: HTMLCanvasElement, hero: HTMLElement): () => void {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 30);
  camera.position.set(0, 0, 10);
  scene.add(new THREE.HemisphereLight(0xf7fff3, 0x8bb098, 2));
  const sunlight = new THREE.DirectionalLight(0xfff8eb, 1.2);
  sunlight.position.set(-3, 5, 6);
  scene.add(sunlight);

  const resources = new Set<{ dispose: () => void }>();
  const track = <T extends { dispose: () => void }>(resource: T): T => {
    resources.add(resource);
    return resource;
  };
  const leafGeometry = track(new THREE.BufferGeometry());
  const vertices: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const rows = 24;
  const columns = 8;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const width = Math.pow(Math.sin(Math.PI * t), 0.85) * 0.27;
    for (let column = 0; column <= columns; column++) {
      const side = (column / columns) * 2 - 1;
      const curve = Math.sin(Math.PI * t) * t * 0.07;
      vertices.push(curve + side * width * (side < 0 ? 0.9 : 1), t, Math.sin(Math.PI * t) * (1 - side * side) * 0.12);
      const shade = 0.78 + 0.13 * t + 0.09 * (1 - Math.abs(side));
      colors.push(shade, shade, shade);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  leafGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  leafGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  leafGeometry.setIndex(indices);
  leafGeometry.computeVertexNormals();

  const leafMaterials = [0.22, 0.14, 0.11, 0.08].map((opacity) =>
    [0x76ac7e, 0x99c69a, 0xb5d4ad].map((color) =>
      track(
        new THREE.MeshLambertMaterial({
          color,
          vertexColors: true,
          transparent: true,
          opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    ),
  );
  const stemMaterials = [0.26, 0.18, 0.15, 0.11].map((opacity) =>
    track(new THREE.MeshBasicMaterial({ color: 0x83ad89, transparent: true, opacity, depthWrite: false })),
  );
  const budGeometry = track(new THREE.SphereGeometry(0.034, 10, 8));
  const budMaterial = track(
    new THREE.MeshBasicMaterial({ color: 0xe8bdc0, transparent: true, opacity: 0.38, depthWrite: false }),
  );
  const budStemGeometry = track(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.035, 0.035, 0),
        new THREE.Vector3(0.06, 0.1, 0),
      ]),
      12,
      0.004,
      4,
      false,
    ),
  );

  const branches: Array<{
    group: THREE.Group;
    phase: number;
    depth: number;
    baseX: number;
    baseY: number;
    baseScale: number;
    angle: number;
    curve: THREE.CatmullRomCurve3;
  }> = [];
  const leaves: Array<{
    mesh: THREE.Mesh;
    baseScale: THREE.Vector3;
    angle: number;
    turn: number;
    phase: number;
    delay: number;
    flex: number;
  }> = [];
  const buds: Array<{ group: THREE.Group; angle: number; phase: number }> = [];
  function addBranch(depth: number, bend: number) {
    const group = new THREE.Group();
    const branchIndex = branches.length;
    const materialIndex = branchIndex % leafMaterials.length;
    const stemCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(bend * 0.15, 0.45, 0.02),
      new THREE.Vector3(bend * 0.58, 0.95, 0.04),
      new THREE.Vector3(bend * 0.82, 1.45, 0),
      new THREE.Vector3(bend, 1.9, -0.02),
    ]);
    group.add(
      new THREE.Mesh(track(new THREE.TubeGeometry(stemCurve, 36, 0.012, 5, false)), stemMaterials[materialIndex]),
    );
    const leafPositions = [0.16, 0.26, 0.39, 0.48, 0.6, 0.69, 0.81, 0.9];
    for (let index = 0; index < 8; index++) {
      const side = index % 2 === 0 ? 1 : -1;
      const leaf = new THREE.Mesh(leafGeometry, leafMaterials[materialIndex][(index + branchIndex) % 3]);
      leaf.position.copy(stemCurve.getPoint(Math.min(0.94, leafPositions[index] + (branchIndex % 2) * 0.015)));
      leaf.position.z += side * 0.025;
      const turn = side * (0.3 + (index % 3) * 0.18);
      const angle = side * (0.72 + ((index + branchIndex) % 4) * 0.1);
      leaf.rotation.set(0.12 * side, turn, angle);
      const size = 0.54 - index * 0.022 + ((index + branchIndex) % 3) * 0.025;
      const willow = branchIndex === 2 || branchIndex === 3;
      leaf.scale.set(size * (willow ? 0.38 : index % 3 === 0 ? 0.62 : 1), size * (willow ? 1.16 : 1), size);
      group.add(leaf);
      leaves.push({
        mesh: leaf,
        baseScale: leaf.scale.clone(),
        angle,
        turn,
        phase: branchIndex * 1.4,
        delay: index * 0.12,
        flex: 0.5 + (index / 7) * 0.5,
      });
    }
    const tip = new THREE.Mesh(leafGeometry, leafMaterials[materialIndex][1]);
    tip.position.copy(stemCurve.getPoint(0.93));
    const tangent = stemCurve.getTangent(0.93);
    tip.rotation.z = -Math.atan2(tangent.x, tangent.y);
    tip.scale.setScalar(0.3);
    group.add(tip);
    if (branchIndex % 2 === 0) {
      [0.76, 0.86].forEach((position, index) => {
        const budTwig = new THREE.Group();
        budTwig.position.copy(stemCurve.getPoint(position));
        budTwig.rotation.z = index === 0 ? 0.55 : -0.25;
        budTwig.add(new THREE.Mesh(budStemGeometry, stemMaterials[materialIndex]));
        const bud = new THREE.Mesh(budGeometry, budMaterial);
        bud.position.set(0.06, 0.1, 0);
        bud.scale.set(0.58, 1.1, 0.55);
        bud.rotation.z = -0.35;
        budTwig.add(bud);
        group.add(budTwig);
        buds.push({ group: budTwig, angle: budTwig.rotation.z, phase: branchIndex * 1.4 + index * 0.45 });
      });
    }
    scene.add(group);
    branches.push({
      group,
      phase: branches.length * 1.2,
      depth,
      baseX: 0,
      baseY: 0,
      baseScale: 1,
      angle: 0,
      curve: stemCurve,
    });
  }
  addBranch(-0.7, 0.28);
  addBranch(-0.4, -0.18);
  addBranch(0.7, 0.22);
  addBranch(-0.25, -0.14);
  addBranch(-0.55, -0.12);

  const fernMaterial = track(
    new THREE.MeshLambertMaterial({
      color: 0x8bb995,
      vertexColors: true,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const fernStem = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.04, 0.3, 0.01),
    new THREE.Vector3(0.12, 0.65, 0.02),
    new THREE.Vector3(0.2, 0.96, 0),
  ]);
  const fernStemGeometry = track(new THREE.TubeGeometry(fernStem, 24, 0.006, 4, false));
  const ferns: Array<{ group: THREE.Group; direction: number; phase: number; baseX: number; scale: number }> = [];
  for (let side = 0; side < 4; side++) {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(fernStemGeometry, stemMaterials[2]));
    for (let index = 0; index < 10; index++) {
      const direction = index % 2 === 0 ? 1 : -1;
      const leaflet = new THREE.Mesh(leafGeometry, fernMaterial);
      leaflet.position.copy(fernStem.getPoint(0.2 + Math.floor(index / 2) * 0.13));
      const angle = direction * (1.02 + (index % 3) * 0.07);
      const turn = direction * 0.25;
      leaflet.rotation.set(0, turn, angle);
      const size = 0.24 - Math.floor(index / 2) * 0.018;
      leaflet.scale.set(size * 0.55, size, size);
      group.add(leaflet);
      leaves.push({
        mesh: leaflet,
        baseScale: leaflet.scale.clone(),
        angle,
        turn,
        phase: side * 1.8 + 2.4,
        delay: index * 0.08,
        flex: 0.8,
      });
    }
    scene.add(group);
    ferns.push({ group, direction: side % 2 === 0 ? 1 : -1, phase: side * 1.8 + 2.4, baseX: 0, scale: 1 });
  }

  const grassGeometry = track(new THREE.BufferGeometry());
  const grassVertices: number[] = [];
  const grassIndices: number[] = [];
  for (let row = 0; row <= 16; row++) {
    const t = row / 16;
    const center = 0.18 * t * t;
    const width = 0.032 * (1 - t);
    grassVertices.push(center - width, t * 0.7, 0, center + width, t * 0.7, 0);
    if (row < 16) {
      const a = row * 2;
      grassIndices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    }
  }
  grassGeometry.setAttribute("position", new THREE.Float32BufferAttribute(grassVertices, 3));
  grassGeometry.setIndex(grassIndices);
  grassGeometry.computeVertexNormals();
  const grassMaterial = track(
    new THREE.MeshBasicMaterial({
      color: 0x96be98,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const grasses: Array<{ group: THREE.Group; phase: number; baseX: number; scale: number }> = [];
  const grassBlades: Array<{ mesh: THREE.Mesh; angle: number; phase: number; delay: number }> = [];
  for (let side = 0; side < 6; side++) {
    const group = new THREE.Group();
    for (let index = 0; index < 5; index++) {
      const blade = new THREE.Mesh(grassGeometry, grassMaterial);
      blade.position.x = (index - 2) * 0.07;
      const angle = (index - 2) * 0.16;
      blade.rotation.z = angle;
      blade.scale.setScalar(0.68 + (index % 3) * 0.14);
      group.add(blade);
      grassBlades.push({ mesh: blade, angle, phase: side * 1.8, delay: index * 0.12 });
    }
    scene.add(group);
    grasses.push({ group, phase: side * 1.8, baseX: 0, scale: 1 });
  }

  const particleGeometry = track(new THREE.SphereGeometry(0.018, 8, 6));
  const particleMaterials = [0x94bb91, 0xc99da4, 0xe5d1c6].map((color) =>
    track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false })),
  );
  const particles: Array<{ mesh: THREE.Mesh; x: number; y: number; phase: number }> = [];
  for (let index = 1; index < 8; index++) {
    const mesh = new THREE.Mesh(particleGeometry, particleMaterials[index % particleMaterials.length]);
    mesh.scale.setScalar(index % 4 === 0 ? 1.3 : 0.75);
    scene.add(mesh);
    particles.push({
      mesh,
      x: ((index * 0.61803398875) % 1) * 2 - 1,
      y: ((index * 0.41421356237) % 1) * 4 - 2,
      phase: index * 0.7,
    });
  }

  const petalGeometry = track(new THREE.BufferGeometry());
  const petalVertices: number[] = [];
  const petalColors: number[] = [];
  const petalIndices: number[] = [];
  const petalRows = 16;
  const petalColumns = 6;
  for (let row = 0; row <= petalRows; row++) {
    const t = row / petalRows;
    const width = Math.pow(Math.sin(Math.PI * t), 0.8) * 0.035;
    for (let column = 0; column <= petalColumns; column++) {
      const side = (column / petalColumns) * 2 - 1;
      petalVertices.push(
        Math.sin(Math.PI * t) * t * 0.009 + side * width * (side < 0 ? 0.88 : 1),
        (t - 0.5) * 0.085,
        Math.sin(Math.PI * t) * (1 - side * side) * 0.012,
      );
      const shade = 0.88 + 0.08 * t + 0.04 * (1 - Math.abs(side));
      petalColors.push(shade, shade, shade);
    }
  }
  for (let row = 0; row < petalRows; row++) {
    for (let column = 0; column < petalColumns; column++) {
      const a = row * (petalColumns + 1) + column;
      const b = a + petalColumns + 1;
      petalIndices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  petalGeometry.setAttribute("position", new THREE.Float32BufferAttribute(petalVertices, 3));
  petalGeometry.setAttribute("color", new THREE.Float32BufferAttribute(petalColors, 3));
  petalGeometry.setIndex(petalIndices);
  petalGeometry.computeVertexNormals();
  const blossomMaterial = track(
    new THREE.MeshBasicMaterial({
      color: 0xecc7c4,
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
  );
  const blossomCenterGeometry = track(new THREE.SphereGeometry(0.009, 8, 6));
  const blossomCenterMaterial = track(
    new THREE.MeshBasicMaterial({ color: 0xd9bb86, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  const blossoms: Array<{
    group: THREE.Group;
    petals: Array<{ mesh: THREE.Mesh; angle: number }>;
    phase: number;
    scale: number;
  }> = [];
  [
    [0, 0.7, 0.75],
    [0, 0.89, 0.6],
    [1, 0.78, 0.65],
    [2, 0.84, 0.65],
  ].forEach(([branchIndex, position, scale], index) => {
    const branch = branches[branchIndex];
    const twig = new THREE.Group();
    twig.position.copy(branch.curve.getPoint(position));
    twig.rotation.z = index % 2 === 0 ? 0.6 : -0.3;
    twig.add(new THREE.Mesh(budStemGeometry, stemMaterials[branchIndex]));
    const flower = new THREE.Group();
    const flowerPetals: Array<{ mesh: THREE.Mesh; angle: number }> = [];
    flower.position.set(0.06, 0.1, 0.015);
    for (let petalIndex = 0; petalIndex < 5; petalIndex++) {
      const angle = (petalIndex / 5) * Math.PI * 2;
      const petal = new THREE.Mesh(petalGeometry, blossomMaterial);
      petal.position.set(Math.sin(angle) * 0.025, Math.cos(angle) * 0.025, 0);
      petal.rotation.z = -angle;
      petal.scale.set(0.45, 0.55, 0.5);
      flower.add(petal);
      flowerPetals.push({ mesh: petal, angle });
    }
    flower.add(new THREE.Mesh(blossomCenterGeometry, blossomCenterMaterial));
    twig.add(flower);
    branch.group.add(twig);
    blossoms.push({ group: flower, petals: flowerPetals, phase: branch.phase + index * 0.45, scale });
  });

  const wildStemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.025, 0.25, 0),
    new THREE.Vector3(0.08, 0.62, 0.01),
  ]);
  const wildStemGeometry = track(new THREE.TubeGeometry(wildStemCurve, 20, 0.005, 4, false));
  const wildPetalMaterial = track(
    new THREE.MeshBasicMaterial({
      color: 0xf2eadd,
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    }),
  );
  const wildflowers: Array<{
    group: THREE.Group;
    heads: THREE.Group[];
    direction: number;
    phase: number;
    baseX: number;
    scale: number;
  }> = [];
  for (let side = 0; side < 3; side++) {
    const group = new THREE.Group();
    const heads: THREE.Group[] = [];
    for (let index = 0; index < 3; index++) {
      const height = 0.68 + (index % 3) * 0.14;
      const stem = new THREE.Mesh(wildStemGeometry, stemMaterials[2]);
      stem.position.x = (index - 1) * 0.12;
      stem.scale.y = height;
      group.add(stem);
      const head = new THREE.Group();
      head.position.set(stem.position.x + 0.08, 0.62 * height, 0.02);
      const petalInstances = track(new THREE.InstancedMesh(petalGeometry, wildPetalMaterial, 5));
      const petalTransform = new THREE.Object3D();
      for (let petalIndex = 0; petalIndex < 5; petalIndex++) {
        const angle = (petalIndex / 5) * Math.PI * 2;
        petalTransform.position.set(Math.sin(angle) * 0.022, Math.cos(angle) * 0.022, 0);
        petalTransform.rotation.z = -angle;
        petalTransform.scale.set(0.38, 0.5, 0.5);
        petalTransform.updateMatrix();
        petalInstances.setMatrixAt(petalIndex, petalTransform.matrix);
      }
      petalInstances.instanceMatrix.needsUpdate = true;
      head.add(petalInstances);
      head.add(new THREE.Mesh(blossomCenterGeometry, blossomCenterMaterial));
      group.add(head);
      heads.push(head);
    }
    scene.add(group);
    wildflowers.push({ group, heads, direction: side % 2 === 0 ? 1 : -1, phase: side * 1.8 + 3, baseX: 0, scale: 1 });
  }

  const petalPalette = [0xe9b5b8, 0xecc6c4, 0xf2d5cf];
  const petals: Array<{
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    x: number;
    y: number;
    phase: number;
    scale: number;
    speed: number;
    depth: number;
  }> = [];
  for (let index = 0; index < 6; index++) {
    const material = track(
      new THREE.MeshBasicMaterial({
        color: petalPalette[index % petalPalette.length],
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
      }),
    );
    const mesh = new THREE.Mesh(petalGeometry, material);
    scene.add(mesh);
    petals.push({
      mesh,
      material,
      x: 0,
      y: 0,
      phase: index * 1.7,
      scale: 1,
      speed: 0.027 + (index % 4) * 0.007,
      depth: [-0.7, 0.2, 0.6, -0.3, 0.4, -0.6][index],
    });
  }

  const springLife = createSpringLife(scene, track);
  const springBotany = createSpringBotany(scene, track);
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const sprig = hero.querySelector<HTMLElement>(".semlo-editor-sprig-sway");
  const sprigFrame = hero.querySelector<HTMLElement>(".semlo-editor-sprig");
  const heroInner = hero.querySelector<HTMLElement>(".semlo-editor-hero-inner");
  const sprigShoots = [
    { element: hero.querySelector<SVGElement>(".semlo-editor-sprig-shoot-back"), phase: 1.1, delay: 0.35, flex: 0.7 },
    { element: hero.querySelector<SVGElement>(".semlo-editor-sprig-shoot-left"), phase: 1.5, delay: 0.45, flex: 1.15 },
    {
      element: hero.querySelector<SVGElement>(".semlo-editor-sprig-shoot-right"),
      phase: 0.65,
      delay: 0.65,
      flex: 0.95,
    },
    { element: hero.querySelector<SVGElement>(".semlo-editor-sprig-shoot-main"), phase: 0.9, delay: 0.2, flex: 0.45 },
  ];
  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let halfWidth = 2;
  let elapsed = 0;
  let movementRate = 1;
  let frame = 0;
  let lastTime = 0;
  let visible = !("IntersectionObserver" in window);
  let disposed = false;

  function breeze(phase: number, delay = 0) {
    if (motion.matches) return 0;
    const time = elapsed - delay;
    const gust = Math.max(0, Math.sin(time * 0.27 - 0.35));
    const swell = gust * gust * (3 - 2 * gust);
    return Math.sin(time * 0.48 + phase) * 0.025 + swell * (0.62 + Math.sin(time * 0.75 + phase) * 0.12);
  }

  function layout(width: number) {
    const mobile = width <= 720;
    const sceneryHalfWidth = halfWidth * Math.min((heroInner?.clientWidth ?? width) / width, 1);
    const heroBounds = hero.getBoundingClientRect();
    const sprigBounds = sprigFrame?.getBoundingClientRect();
    const clusterX = sprigBounds
      ? (((sprigBounds.left - heroBounds.left + sprigBounds.width * 0.4) / width) * 2 - 1) * halfWidth
      : -0.22 * halfWidth;
    springLife.layout(width, sceneryHalfWidth);
    springBotany.layout(width, sceneryHalfWidth);
    const placement = mobile
      ? [
          [-1.25, -2.15, 0.4, -0.55],
          [1.22, -1.15, 0.45, 0.65],
          [1.22, 2.1, 0.35, Math.PI - 0.45],
          [-1.22, 2.02, 0.25, -Math.PI + 0.55],
          [1.18, -2.12, 0.34, 0.4],
        ]
      : [
          [width <= 1050 ? -1.17 : -1.04, -2.12, width <= 1050 ? 0.6 : 0.62, -0.3],
          [0, -2.08, width <= 1050 ? 0.52 : 0.62, -0.25],
          [1.08, 2.15, 0.8, Math.PI - 0.45],
          [width <= 1050 ? -1.19 : -1.1, 2.1, width <= 1050 ? 0.45 : 0.55, -Math.PI + 0.55],
          [1.06, -2.12, 0.72, 0.4],
        ];
    branches.forEach((branch, index) => {
      const [x, y, scale, angle] = placement[index];
      branch.baseX = !mobile && index === 1 ? clusterX + 0.18 : x * sceneryHalfWidth;
      branch.baseY = y;
      branch.baseScale = scale;
      branch.angle = angle;
    });
    ferns.forEach((fern, index) => {
      if (index >= 2) {
        fern.group.visible = true;
        fern.baseX = (index === 2 ? 0.24 : -0.74) * sceneryHalfWidth;
        fern.scale = mobile ? 0.24 : index === 2 ? 0.38 : 0.32;
        return;
      }
      const nearCluster = fern.direction > 0;
      fern.group.visible = !mobile || !nearCluster;
      fern.baseX =
        !mobile && nearCluster ? clusterX - 0.18 : -fern.direction * (mobile ? 0.96 : 0.92) * sceneryHalfWidth;
      fern.scale = mobile ? 0.4 : nearCluster ? (width <= 1050 ? 0.42 : 0.55) : 0.8;
    });
    wildflowers.forEach((flowers, index) => {
      if (index === 2) {
        flowers.group.visible = true;
        flowers.baseX = 0.52 * sceneryHalfWidth;
        flowers.scale = mobile ? 0.27 : 0.58;
        return;
      }
      const nearCluster = flowers.direction > 0;
      flowers.group.visible = !nearCluster || (!mobile && width > 1050);
      flowers.baseX =
        !mobile && nearCluster ? clusterX + 0.12 : -flowers.direction * (mobile ? 0.97 : 0.94) * sceneryHalfWidth;
      flowers.scale = mobile ? 0.4 : nearCluster ? 0.55 : 0.75;
    });
    const groundPositions = mobile ? [-0.84, -0.74, 0.24, 0.57] : [-0.8, -0.74, 0.24, 0.52];
    const groundScales = mobile ? [0.2, 0.24, 0.2, 0.22] : [0.4, 0.32, 0.36, 0.35];
    grasses.forEach((grass, index) => {
      if (index < 2) {
        grass.baseX = !mobile && index === 0 ? clusterX - 0.2 : (index === 0 ? -0.98 : 0.96) * sceneryHalfWidth;
        grass.scale = mobile ? 0.45 * (index === 0 ? 0.65 : 1) : index === 0 ? (width <= 1050 ? 0.45 : 0.6) : 0.85;
      } else {
        grass.baseX = groundPositions[index - 2] * sceneryHalfWidth;
        grass.scale = groundScales[index - 2];
      }
    });
    particles.forEach(({ mesh }, index) => {
      mesh.scale.setScalar((index % 4 === 0 ? 1.3 : 0.75) * (mobile ? 0.5 : 1));
    });
    const petalPlacement = mobile
      ? [
          [0.92, 1.15, 0.5],
          [-0.94, -0.15, 0.42],
          [0.98, -1.25, 0.45],
          [0.75, 1.55, 0.3],
          [-0.98, 0.5, 0.28],
          [0.98, -1.8, 0.28],
        ]
      : [
          [-0.5, 1.55, 0.8],
          [0.94, 0.3, 0.7],
          [-0.25, -1.3, 0.65],
          [0.15, 1.65, 0.55],
          [-0.17, -0.65, 0.45],
          [0.98, 1.4, 0.38],
        ];
    petals.forEach((petal, index) => {
      const [x, y, scale] = petalPlacement[index];
      petal.x = x * halfWidth;
      petal.y = y;
      petal.scale = scale;
    });
  }

  function render() {
    if (sprig) sprig.style.transform = `rotate(${(breeze(0.9, 0.2) * 1.8).toFixed(3)}deg)`;
    sprigShoots.forEach(({ element, phase, delay, flex }) => {
      if (element) element.style.transform = `rotate(${(breeze(phase, delay) * flex).toFixed(3)}deg)`;
    });
    branches.forEach((branch, index) => {
      const progress = motion.matches ? 1 : Math.min(Math.max((elapsed - index * 0.12) / 1.8, 0), 1);
      const growth = 0.82 + 0.18 * (1 - Math.pow(1 - progress, 3));
      branch.group.scale.setScalar(branch.baseScale * growth);
      branch.group.position.set(
        branch.baseX + pointer.x * branch.depth * 0.12,
        branch.baseY + pointer.y * branch.depth * 0.08,
        branch.depth,
      );
      branch.group.rotation.set(0.12 * branch.depth, pointer.x * 0.08, branch.angle + breeze(branch.phase) * 0.04);
    });
    leaves.forEach(({ mesh, baseScale, angle, turn, phase, delay, flex }, index) => {
      const progress = motion.matches ? 1 : Math.min(Math.max((elapsed - index * 0.025) / 1.8, 0), 1);
      const growth = 0.72 + 0.28 * (1 - Math.pow(1 - progress, 3));
      mesh.scale.set(baseScale.x * growth, baseScale.y * growth, baseScale.z * growth);
      mesh.rotation.z = angle * (0.78 + progress * 0.22) + breeze(phase, delay) * 0.035 * flex;
      mesh.rotation.y = turn + breeze(phase, delay + 0.18) * 0.045 * flex;
    });
    buds.forEach((bud, index) => {
      const progress = motion.matches ? 1 : Math.min(Math.max((elapsed - index * 0.18) / 2, 0), 1);
      bud.group.scale.setScalar(0.84 + progress * 0.16);
      bud.group.rotation.z = bud.angle + breeze(bud.phase, 0.6) * 0.025;
    });
    blossoms.forEach((blossom, index) => {
      const progress = motion.matches ? 1 : Math.min(Math.max((elapsed - 0.5 - index * 0.12) / 1.8, 0), 1);
      const opening = 1 - Math.pow(1 - progress, 3);
      blossom.group.scale.setScalar(blossom.scale * (0.65 + 0.35 * opening));
      blossom.group.rotation.z = breeze(blossom.phase, 0.5) * 0.06;
      blossom.petals.forEach(({ mesh, angle }) => {
        const spread = 0.6 + opening * 0.4;
        mesh.position.set(Math.sin(angle) * 0.025 * spread, Math.cos(angle) * 0.025 * spread, 0);
        mesh.rotation.x = (1 - opening) * 0.55;
      });
    });
    ferns.forEach((fern, index) => {
      const progress = motion.matches ? 1 : Math.min(Math.max((elapsed - 0.2 - index * 0.15) / 1.8, 0), 1);
      const scale = fern.scale * (0.82 + 0.18 * (1 - Math.pow(1 - progress, 3)));
      fern.group.position.set(fern.baseX + pointer.x * fern.direction * 0.025, -2.03, -0.8);
      fern.group.scale.set(fern.direction * scale, scale, scale);
      fern.group.rotation.z = breeze(fern.phase) * 0.025;
    });
    wildflowers.forEach((flowers, index) => {
      const progress = motion.matches ? 1 : Math.min(Math.max((elapsed - 0.4 - index * 0.2) / 2, 0), 1);
      const growth = 0.8 + 0.2 * (1 - Math.pow(1 - progress, 3));
      flowers.group.position.set(flowers.baseX + pointer.x * flowers.direction * 0.02, -2.03, -0.7);
      flowers.group.scale.set(flowers.direction * flowers.scale, flowers.scale * growth, flowers.scale);
      flowers.group.rotation.z = breeze(flowers.phase) * 0.025;
      flowers.heads.forEach((head, headIndex) => {
        const opening = motion.matches ? 1 : Math.min(Math.max((elapsed - 0.8 - headIndex * 0.15) / 1.6, 0), 1);
        head.scale.setScalar(0.7 + 0.3 * (1 - Math.pow(1 - opening, 3)));
        head.rotation.z = breeze(flowers.phase, headIndex * 0.2) * 0.04;
      });
    });
    grasses.forEach((grass) => {
      grass.group.position.set(grass.baseX + pointer.x * 0.025, -2.02, -0.85);
      grass.group.scale.setScalar(grass.scale);
      grass.group.rotation.z = breeze(grass.phase) * 0.03;
    });
    grassBlades.forEach((blade) => {
      blade.mesh.rotation.z = blade.angle + breeze(blade.phase, blade.delay) * 0.04;
    });
    particles.forEach(({ mesh, x, y, phase }) => {
      const drift = motion.matches ? 0 : elapsed * 0.025;
      mesh.position.set(x * halfWidth + Math.sin(elapsed * 0.45 + phase) * 0.035, ((y + drift + 2) % 4) - 2, -0.5);
    });
    petals.forEach((petal) => {
      const progress = motion.matches ? 1 : Math.min(elapsed / 2, 1);
      const driftX = motion.matches
        ? 0
        : Math.sin(elapsed * 0.37 + petal.phase) * 0.8 + Math.sin(elapsed * 0.17 + petal.phase * 1.3) * 0.2;
      const driftY = motion.matches ? 0 : Math.sin(elapsed * 0.23 + petal.phase * 0.7);
      const wind = breeze(petal.phase, 0.7);
      const flutter = motion.matches
        ? 0
        : (Math.sin(elapsed * 0.8 + petal.phase) * 0.55 + Math.sin(elapsed * 1.3 + petal.phase * 0.7) * 0.2) *
          (0.2 + wind * 0.8);
      const lift = motion.matches
        ? 0
        : (Math.sin(elapsed * 0.25 + petal.phase) - Math.sin(petal.phase)) * 0.08 - wind * 0.06;
      const fall = motion.matches ? 2 - petal.y : (2 - petal.y + elapsed * petal.speed + lift) % 4;
      const edgeFade = motion.matches ? 1 : Math.min(1, fall / 0.25, (4 - fall) / 0.25);
      petal.material.opacity = (0.59 + petal.depth * 0.07) * edgeFade;
      petal.mesh.position.set(
        petal.x +
          pointer.x * (0.045 + petal.depth * 0.02) +
          driftX * 0.05 +
          wind * 0.14 +
          (fall - (2 - petal.y)) * 0.06,
        2 - fall + driftY * 0.06,
        petal.depth,
      );
      petal.mesh.rotation.set(
        0.35 + flutter * 0.6,
        pointer.x * 0.1 + driftX * 0.65,
        petal.phase + driftX * 0.2 + wind * 0.25,
      );
      const size = petal.scale * (0.8 + progress * 0.2) * (1 + petal.depth * 0.12);
      petal.mesh.scale.set(size * 0.75, size * 1.2, size * 0.8);
    });
    springLife.render(elapsed, motion.matches, breeze);
    springBotany.render(elapsed, motion.matches, breeze);
    renderer.render(scene, camera);
  }

  function tick(time: number) {
    frame = 0;
    if (disposed || !visible || document.hidden || motion.matches) return;
    if (lastTime && time - lastTime < 1000 / 30) {
      frame = window.requestAnimationFrame(tick);
      return;
    }
    const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
    lastTime = time;
    const targetRate = hero.classList.contains("semlo-editor-editor-focused") ? 0.08 : 1;
    movementRate += (targetRate - movementRate) * (1 - Math.exp(-delta * 2));
    elapsed += delta * movementRate;
    pointer.x += (pointer.targetX - pointer.x) * 0.035 * movementRate;
    pointer.y += (pointer.targetY - pointer.y) * 0.035 * movementRate;
    render();
    frame = window.requestAnimationFrame(tick);
  }
  function stop() {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }
  function schedule() {
    if (disposed || !visible || document.hidden) return;
    if (motion.matches) {
      pointer.x = 0;
      pointer.y = 0;
      render();
    } else if (!frame) {
      lastTime = 0;
      frame = window.requestAnimationFrame(tick);
    }
  }
  function resize() {
    const width = Math.max(hero.clientWidth, 1);
    const height = Math.max(hero.clientHeight, 1);
    halfWidth = (width / height) * 2;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.updateProjectionMatrix();
    layout(width);
    renderer.setSize(width, height, false);
    render();
  }
  function onPointerMove(event: PointerEvent) {
    if (motion.matches || hero.classList.contains("semlo-editor-editor-focused")) return;
    const rect = hero.getBoundingClientRect();
    pointer.targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    pointer.targetY = (0.5 - (event.clientY - rect.top) / rect.height) * 2;
  }
  function onPointerLeave() {
    pointer.targetX = 0;
    pointer.targetY = 0;
  }
  function onPointerEnd(event: PointerEvent) {
    if (event.pointerType === "touch") onPointerLeave();
  }
  function updateVisibility() {
    const active = visible && !document.hidden;
    hero.classList.toggle("semlo-editor-atmosphere-visible", active);
    if (active) schedule();
    else stop();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(hero);
  const visibilityObserver =
    "IntersectionObserver" in window
      ? new IntersectionObserver((entries) => {
          visible = entries.some((entry) => entry.isIntersecting);
          updateVisibility();
        })
      : null;
  visibilityObserver?.observe(hero);
  const onVisibilityChange = () => updateVisibility();
  const onMotionChange = () => {
    stop();
    schedule();
  };
  hero.addEventListener("pointermove", onPointerMove, { passive: true });
  hero.addEventListener("pointerdown", onPointerMove, { passive: true });
  hero.addEventListener("pointerleave", onPointerLeave);
  hero.addEventListener("pointerup", onPointerEnd, { passive: true });
  hero.addEventListener("pointercancel", onPointerEnd, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  motion.addEventListener("change", onMotionChange);
  resize();
  updateVisibility();

  return () => {
    disposed = true;
    stop();
    resizeObserver.disconnect();
    visibilityObserver?.disconnect();
    hero.classList.remove("semlo-editor-atmosphere-visible");
    hero.removeEventListener("pointermove", onPointerMove);
    hero.removeEventListener("pointerdown", onPointerMove);
    hero.removeEventListener("pointerleave", onPointerLeave);
    hero.removeEventListener("pointerup", onPointerEnd);
    hero.removeEventListener("pointercancel", onPointerEnd);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    motion.removeEventListener("change", onMotionChange);
    sprig?.style.removeProperty("transform");
    sprigShoots.forEach(({ element }) => element?.style.removeProperty("transform"));
    resources.forEach((resource) => resource.dispose());
    renderer.dispose();
  };
}
