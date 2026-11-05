import * as THREE from "three";

type Track = <T extends { dispose: () => void }>(resource: T) => T;
type Breeze = (phase: number, delay?: number) => number;

export function createSpringBotany(scene: THREE.Scene, track: Track) {
  const stemMaterial = track(
    new THREE.MeshBasicMaterial({ color: 0x91b997, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  const stemGeometry = track(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.015, 0.2, 0),
        new THREE.Vector3(0.045, 0.42, 0),
        new THREE.Vector3(0.035, 0.62, 0),
      ]),
      20,
      0.0035,
      4,
      false,
    ),
  );
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.bezierCurveTo(0.025, 0.08, 0.09, 0.12, 0.16, 0.13);
  leafShape.bezierCurveTo(0.13, 0.07, 0.065, 0.005, 0, 0);
  const leafGeometry = track(new THREE.ShapeGeometry(leafShape, 8));
  const leafMaterial = track(
    new THREE.MeshLambertMaterial({
      color: 0x9cc5a1,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );

  const seedHeadLines: THREE.Vector3[] = [];
  const seedHeadPoints: THREE.Vector3[] = [];
  for (let index = 0; index < 24; index++) {
    const angle = (index / 24) * Math.PI * 2 + Math.sin(index * 2.7) * 0.035;
    const radius = 0.073 + (0.5 + Math.sin(index * 4.1) * 0.5) * 0.018;
    const inner = new THREE.Vector3(Math.cos(angle) * 0.015, Math.sin(angle) * 0.015, 0);
    const outer = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    const tangent = new THREE.Vector3(-Math.sin(angle) * 0.009, Math.cos(angle) * 0.009, 0);
    seedHeadLines.push(inner, outer, outer, outer.clone().add(tangent), outer, outer.clone().sub(tangent));
    seedHeadPoints.push(outer);
  }
  const seedHeadGeometry = track(new THREE.BufferGeometry().setFromPoints(seedHeadLines));
  const seedHeadMaterial = track(
    new THREE.LineBasicMaterial({ color: 0xe7e8d7, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  const tuftGeometry = track(new THREE.SphereGeometry(0.008, 6, 5));
  const tuftMaterial = track(
    new THREE.MeshBasicMaterial({ color: 0xf6f0df, transparent: true, opacity: 0.65, depthWrite: false }),
  );
  const seedCenterGeometry = track(new THREE.SphereGeometry(0.018, 8, 6));
  const seedCenterMaterial = track(
    new THREE.MeshBasicMaterial({ color: 0xc9c6a6, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  const dandelions: Array<{ group: THREE.Group; head: THREE.Group; x: number; scale: number; phase: number }> = [];
  for (let index = 0; index < 2; index++) {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(stemGeometry, stemMaterial));
    [-1, 1].forEach((side, leafIndex) => {
      const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
      leaf.position.set(0.01, 0.07 + leafIndex * 0.055, 0);
      leaf.scale.x = side;
      leaf.rotation.z = side * 0.15;
      group.add(leaf);
    });
    const head = new THREE.Group();
    head.position.set(0.035, 0.62, 0);
    head.add(new THREE.LineSegments(seedHeadGeometry, seedHeadMaterial));
    head.add(new THREE.Mesh(seedCenterGeometry, seedCenterMaterial));
    const tufts = track(new THREE.InstancedMesh(tuftGeometry, tuftMaterial, seedHeadPoints.length));
    const transform = new THREE.Object3D();
    seedHeadPoints.forEach((point, tuftIndex) => {
      transform.position.copy(point);
      transform.updateMatrix();
      tufts.setMatrixAt(tuftIndex, transform.matrix);
    });
    tufts.instanceMatrix.needsUpdate = true;
    head.add(tufts);
    group.add(head);
    scene.add(group);
    dandelions.push({ group, head, x: 0, scale: 1, phase: 2.1 + index * 1.3 });
  }

  const floatingSeedGeometry = track(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -0.028, 0),
      new THREE.Vector3(0, 0.005, 0),
      new THREE.Vector3(0, 0.005, 0),
      new THREE.Vector3(-0.022, 0.028, 0),
      new THREE.Vector3(0, 0.005, 0),
      new THREE.Vector3(0, 0.035, 0),
      new THREE.Vector3(0, 0.005, 0),
      new THREE.Vector3(0.022, 0.028, 0),
    ]),
  );
  const floatingSeeds = Array.from({ length: 3 }, (_, index) => {
    const material = track(
      new THREE.LineBasicMaterial({ color: 0xf1ead8, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    const lines = new THREE.LineSegments(floatingSeedGeometry, material);
    scene.add(lines);
    return { lines, material, phase: index * 5.4 };
  });

  let seedScale = 1;
  function layout(width: number, halfWidth: number) {
    const mobile = width <= 720;
    dandelions.forEach((flower, index) => {
      flower.group.visible = index !== 0;
      flower.x = (index === 0 ? -0.77 : 0.88) * halfWidth;
      flower.scale = (mobile ? 0.32 : 0.85) * (index === 0 ? 0.8 : 1);
    });
    seedScale = mobile ? 0.3 : 0.85;
  }

  function render(elapsed: number, reducedMotion: boolean, breeze: Breeze) {
    dandelions.forEach((flower, index) => {
      const progress = reducedMotion ? 1 : Math.min(Math.max((elapsed - 0.7 - index * 0.4) / 2.8, 0), 1);
      const growth = 0.78 + 0.22 * (1 - Math.pow(1 - progress, 3));
      flower.group.position.set(flower.x, -2.03, -0.9);
      flower.group.scale.set(flower.scale, flower.scale * growth, flower.scale);
      flower.group.rotation.z = breeze(flower.phase, 0.2) * 0.04;
      const opening = reducedMotion ? 1 : Math.min(Math.max((elapsed - 1.4 - index * 0.4) / 1.7, 0), 1);
      flower.head.scale.setScalar(0.7 + 0.3 * (1 - Math.pow(1 - opening, 3)));
      flower.head.rotation.z = breeze(flower.phase, 0.6) * 0.08;
    });
    const origin = dandelions[1];
    floatingSeeds.forEach((seed) => {
      seed.lines.visible = !reducedMotion;
      if (reducedMotion) return;
      const travel = (elapsed + seed.phase) % 20;
      const fade = Math.min(1, travel / 1.5, (20 - travel) / 3);
      seed.material.opacity = 0.42 * fade;
      seed.lines.position.set(
        origin.x + (0.03 + travel * 0.025 + breeze(seed.phase, 0.8) * 0.07) * seedScale,
        -2.03 + (0.62 + travel * 0.026 + Math.sin(elapsed * 0.3 + seed.phase) * 0.03) * origin.scale,
        -0.4,
      );
      seed.lines.scale.setScalar(seedScale);
      seed.lines.rotation.z = Math.sin(elapsed * 0.45 + seed.phase) * 0.22 + breeze(seed.phase, 0.8) * 0.12;
    });
  }

  return { layout, render };
}
