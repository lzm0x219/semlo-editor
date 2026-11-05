import * as THREE from "three";

type Track = <T extends { dispose: () => void }>(resource: T) => T;
type Breeze = (phase: number, delay?: number) => number;

export function createSpringLife(scene: THREE.Scene, track: Track) {
  const cloverShape = new THREE.Shape();
  cloverShape.moveTo(0, 0);
  cloverShape.bezierCurveTo(-0.035, 0.035, -0.11, 0.12, -0.065, 0.16);
  cloverShape.bezierCurveTo(-0.045, 0.18, -0.015, 0.17, 0, 0.145);
  cloverShape.bezierCurveTo(0.015, 0.17, 0.045, 0.18, 0.065, 0.16);
  cloverShape.bezierCurveTo(0.11, 0.12, 0.035, 0.035, 0, 0);
  const cloverGeometry = track(new THREE.ShapeGeometry(cloverShape, 8));
  const cloverMaterial = track(
    new THREE.MeshLambertMaterial({
      color: 0x91bc97,
      transparent: true,
      opacity: 0.23,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const cloverStemMaterial = track(
    new THREE.MeshBasicMaterial({ color: 0x91b897, transparent: true, opacity: 0.25, depthWrite: false }),
  );
  const cloverStem = track(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.015, 0.14, 0),
        new THREE.Vector3(0.04, 0.31, 0),
      ]),
      16,
      0.0035,
      4,
      false,
    ),
  );
  const patches: Array<{
    group: THREE.Group;
    heads: THREE.Group[];
    phase: number;
    x: number;
    scale: number;
  }> = [];
  for (let patchIndex = 0; patchIndex < 2; patchIndex++) {
    const group = new THREE.Group();
    const heads: THREE.Group[] = [];
    for (let stalkIndex = 0; stalkIndex < 2; stalkIndex++) {
      const stalk = new THREE.Group();
      stalk.position.x = (stalkIndex - 0.5) * 0.22;
      stalk.scale.setScalar(stalkIndex === 0 ? 0.82 : 1);
      stalk.rotation.z = stalkIndex === 0 ? 0.16 : -0.08;
      stalk.add(new THREE.Mesh(cloverStem, cloverStemMaterial));
      const head = new THREE.Group();
      head.position.set(0.04, 0.31, 0.005);
      const leaflets = track(new THREE.InstancedMesh(cloverGeometry, cloverMaterial, 3));
      const transform = new THREE.Object3D();
      [-0.9, 0, 0.9].forEach((angle, index) => {
        transform.rotation.z = angle;
        transform.scale.setScalar(index === 1 ? 0.9 : 0.82);
        transform.updateMatrix();
        leaflets.setMatrixAt(index, transform.matrix);
      });
      leaflets.instanceMatrix.needsUpdate = true;
      head.add(leaflets);
      stalk.add(head);
      group.add(stalk);
      heads.push(head);
    }
    scene.add(group);
    patches.push({ group, heads, phase: 1.3 + patchIndex * 1.8, x: 0, scale: 1 });
  }

  const butterflyWingShape = new THREE.Shape();
  butterflyWingShape.moveTo(0, 0.015);
  butterflyWingShape.bezierCurveTo(0.035, 0.095, 0.115, 0.16, 0.16, 0.095);
  butterflyWingShape.bezierCurveTo(0.19, 0.045, 0.12, 0.012, 0.075, 0);
  butterflyWingShape.bezierCurveTo(0.14, -0.015, 0.125, -0.095, 0.065, -0.095);
  butterflyWingShape.bezierCurveTo(0.025, -0.09, 0.005, -0.05, 0, 0.015);
  const butterflyWingGeometry = track(new THREE.ShapeGeometry(butterflyWingShape, 10));
  const butterflyWingMaterial = track(
    new THREE.MeshBasicMaterial({
      color: 0xe7c6bd,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const insectBodyMaterial = track(
    new THREE.MeshBasicMaterial({ color: 0x8d9b7c, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  const insectBodyGeometry = track(new THREE.SphereGeometry(1, 10, 8));
  const butterfly = new THREE.Group();
  const butterflyLeft = new THREE.Mesh(butterflyWingGeometry, butterflyWingMaterial);
  const butterflyRight = new THREE.Mesh(butterflyWingGeometry, butterflyWingMaterial);
  butterflyLeft.scale.x = -1;
  butterfly.add(butterflyLeft, butterflyRight);
  const butterflyBody = new THREE.Mesh(insectBodyGeometry, insectBodyMaterial);
  butterflyBody.scale.set(0.012, 0.06, 0.014);
  butterflyBody.position.z = 0.01;
  butterfly.add(butterflyBody);
  const antennaGeometry = track(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.05, 0.02),
      new THREE.Vector3(-0.035, 0.145, 0.02),
      new THREE.Vector3(0, 0.05, 0.02),
      new THREE.Vector3(0.035, 0.145, 0.02),
    ]),
  );
  const antennaMaterial = track(
    new THREE.LineBasicMaterial({ color: 0x8d9b7c, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  butterfly.add(new THREE.LineSegments(antennaGeometry, antennaMaterial));
  scene.add(butterfly);
  const companionMaterial = track(
    new THREE.MeshBasicMaterial({
      color: 0xe8dfbf,
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const companion = butterfly.clone();
  const companionLeft = companion.children[0] as THREE.Mesh;
  const companionRight = companion.children[1] as THREE.Mesh;
  companionLeft.material = companionMaterial;
  companionRight.material = companionMaterial;
  scene.add(companion);
  const butterflies = [
    {
      group: butterfly,
      left: butterflyLeft,
      right: butterflyRight,
      x: 0,
      y: 0,
      scale: 1,
      phase: 0,
      distance: 1,
      z: -0.15,
    },
    {
      group: companion,
      left: companionLeft,
      right: companionRight,
      x: 0,
      y: 0,
      scale: 1,
      phase: 13,
      distance: 0.65,
      z: -0.6,
    },
  ];
  const flightPath = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(-0.16, -0.08, 0),
      new THREE.Vector3(-0.12, 0.09, 0),
      new THREE.Vector3(0.06, 0.18, 0),
      new THREE.Vector3(0.23, 0.08, 0),
      new THREE.Vector3(0.17, -0.1, 0),
      new THREE.Vector3(0, -0.16, 0),
    ],
    true,
    "centripetal",
  );
  const flightPoint = new THREE.Vector3();
  const flightTangent = new THREE.Vector3();

  const beeBodyMaterial = track(
    new THREE.MeshBasicMaterial({ color: 0xc4a97e, transparent: true, opacity: 0.68, depthWrite: false }),
  );
  const beeStripeMaterial = track(
    new THREE.MeshBasicMaterial({ color: 0x8f8f70, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  const beeWingMaterial = track(
    new THREE.MeshBasicMaterial({
      color: 0xf1f0dc,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const beeWingGeometry = track(new THREE.CircleGeometry(1, 12));
  const bee = new THREE.Group();
  const beeBody = new THREE.Mesh(insectBodyGeometry, beeBodyMaterial);
  beeBody.scale.set(0.048, 0.027, 0.023);
  bee.add(beeBody);
  const stripe = new THREE.Mesh(insectBodyGeometry, beeStripeMaterial);
  stripe.position.set(-0.012, 0, 0.018);
  stripe.scale.set(0.009, 0.024, 0.006);
  bee.add(stripe);
  const beeWings = [-1, 1].map((side) => {
    const wing = new THREE.Mesh(beeWingGeometry, beeWingMaterial);
    wing.position.set(side * 0.016, 0.025, -0.006);
    wing.scale.set(0.024, 0.04, 1);
    wing.rotation.z = side * 0.55;
    bee.add(wing);
    return wing;
  });
  scene.add(bee);

  const swallowWingShape = new THREE.Shape();
  swallowWingShape.moveTo(0, 0);
  swallowWingShape.bezierCurveTo(0.075, 0.015, 0.14, 0.1, 0.24, 0.08);
  swallowWingShape.bezierCurveTo(0.16, 0.055, 0.1, -0.015, 0.025, -0.018);
  swallowWingShape.closePath();
  const swallowWingGeometry = track(new THREE.ShapeGeometry(swallowWingShape, 8));
  const swallowMaterial = track(
    new THREE.MeshBasicMaterial({
      color: 0x8ca58c,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const swallow = new THREE.Group();
  const swallowLeft = new THREE.Mesh(swallowWingGeometry, swallowMaterial);
  const swallowRight = new THREE.Mesh(swallowWingGeometry, swallowMaterial);
  swallowLeft.scale.x = -1;
  swallow.add(swallowLeft, swallowRight);
  const swallowBody = new THREE.Mesh(insectBodyGeometry, swallowMaterial);
  swallowBody.scale.set(0.02, 0.012, 0.008);
  swallow.add(swallowBody);
  scene.add(swallow);

  let beeX = 0;
  let beeY = 0;
  let beeScale = 1;
  let swallowX = 0;
  let swallowY = 0;
  let swallowScale = 1;
  let travelScale = 1;

  function layout(width: number, halfWidth: number) {
    const mobile = width <= 720;
    patches.forEach((patch, index) => {
      patch.group.visible = index !== 0;
      patch.x = (index === 0 ? -0.91 : 0.83) * halfWidth;
      patch.scale = (mobile ? 0.36 : 0.85) * (index === 0 ? 1 : 0.75);
    });
    butterflies[0].x = (mobile ? 0.7 : -0.31) * halfWidth;
    butterflies[0].y = mobile ? 1.35 : 0.95;
    butterflies[0].scale = mobile ? 0.27 : 0.58;
    butterflies[1].x = (mobile ? 0.93 : 0.92) * halfWidth;
    butterflies[1].y = mobile ? 0.7 : 0.45;
    butterflies[1].scale = mobile ? 0.19 : 0.38;
    beeX = 0.94 * halfWidth;
    beeY = mobile ? 0.2 : -0.55;
    beeScale = mobile ? 0.3 : 0.65;
    swallowX = (mobile ? 0.48 : 0.15) * halfWidth;
    swallowY = mobile ? 1.78 : 1.72;
    swallowScale = mobile ? 0.2 : 0.4;
    travelScale = mobile ? 0.25 : 1;
  }

  function render(elapsed: number, reducedMotion: boolean, breeze: Breeze) {
    patches.forEach((patch, index) => {
      const progress = reducedMotion ? 1 : Math.min(Math.max((elapsed - 0.5 - index * 0.3) / 2.2, 0), 1);
      const growth = 0.8 + 0.2 * (1 - Math.pow(1 - progress, 3));
      patch.group.position.set(patch.x, -2.03, -0.65);
      patch.group.scale.set(patch.scale, patch.scale * growth, patch.scale);
      patch.group.rotation.z = breeze(patch.phase) * 0.035;
      patch.heads.forEach((head, headIndex) => {
        head.rotation.z = breeze(patch.phase, 0.25 + headIndex * 0.15) * 0.05;
      });
    });

    butterflies.forEach(({ group, left, right, x, y, scale, phase, distance, z }) => {
      const flight = reducedMotion ? phase : elapsed + phase;
      const cycle = (flight * 0.028 + Math.sin(flight * 0.21) * 0.015) % 1;
      flightPath.getPointAt(cycle, flightPoint);
      flightPath.getTangentAt(cycle, flightTangent);
      group.position.set(
        x + (flightPoint.x + breeze(0.9 + phase, 0.4) * 0.04) * travelScale * distance,
        y + (flightPoint.y + Math.sin(flight * 0.9) * 0.012) * travelScale * distance,
        z,
      );
      group.scale.setScalar(scale);
      group.rotation.z = -0.14 - flightTangent.x * 0.16 + Math.sin(flight * 0.32) * 0.04;
      const flap = reducedMotion
        ? 0.45
        : 0.2 + Math.abs(Math.sin(flight * 5.2)) * (0.85 + Math.sin(flight * 0.5) * 0.1);
      left.rotation.y = -flap;
      right.rotation.y = flap;
    });

    const beeFlight = reducedMotion ? 0 : elapsed;
    bee.position.set(
      beeX + (Math.sin(beeFlight * 0.6) * 0.065 + breeze(2.2, 0.6) * 0.025) * travelScale,
      beeY + (Math.sin(beeFlight * 0.85) * 0.045 + Math.sin(beeFlight * 1.4) * 0.012) * travelScale,
      0.1,
    );
    bee.scale.setScalar(beeScale);
    bee.rotation.z = Math.sin(beeFlight * 0.55) * 0.12;
    beeWings.forEach((wing, index) => {
      const side = index === 0 ? -1 : 1;
      wing.rotation.z = side * (0.55 + (reducedMotion ? 0 : Math.sin(beeFlight * 8) * 0.2));
    });

    const swallowFlight = reducedMotion ? 0 : elapsed;
    swallow.position.set(
      swallowX + Math.sin(swallowFlight * 0.12) * 0.35 * travelScale,
      swallowY + Math.sin(swallowFlight * 0.2) * 0.035 * travelScale,
      -1.2,
    );
    swallow.scale.setScalar(swallowScale);
    swallow.rotation.z = Math.sin(swallowFlight * 0.12) * -0.08;
    const wingbeat = reducedMotion ? 0 : Math.sin(swallowFlight * 2.5) * 0.15;
    swallowLeft.rotation.z = -wingbeat;
    swallowRight.rotation.z = wingbeat;
  }

  return { layout, render };
}
