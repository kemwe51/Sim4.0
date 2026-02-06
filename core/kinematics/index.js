export function loadMachineModel(machineJson) {
  return typeof machineJson === 'string' ? JSON.parse(machineJson) : machineJson;
}

export function forwardKinematics3Axis(machine, axes, workOffset = { x: 0, y: 0, z: 0 }) {
  const tcp = machine.tcp ?? { x: 0, y: 0, z: 0 };
  return {
    x: axes.x + workOffset.x + tcp.x,
    y: axes.y + workOffset.y + tcp.y,
    z: axes.z + workOffset.z + tcp.z,
  };
}

export function limitFeedByAxes(from, to, desiredFeedMmPerMin, axisLimits) {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const dz = Math.abs(to.z - from.z);
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-9) return 0;

  const candidates = [
    dx > 0 ? axisLimits.X.maxVelocity * (dist / dx) : Number.POSITIVE_INFINITY,
    dy > 0 ? axisLimits.Y.maxVelocity * (dist / dy) : Number.POSITIVE_INFINITY,
    dz > 0 ? axisLimits.Z.maxVelocity * (dist / dz) : Number.POSITIVE_INFINITY,
  ];

  const maxFeedMmPerSec = Math.min(...candidates);
  return Math.min(desiredFeedMmPerMin / 60, maxFeedMmPerSec) * 60;
}
