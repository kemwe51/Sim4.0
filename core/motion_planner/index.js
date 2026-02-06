import { forwardKinematics3Axis, limitFeedByAxes } from '../kinematics/index.js';

export function planTrajectory(commands, machine, options = {}) {
  const dt = options.dt ?? 0.005;
  const workOffsets = machine.workOffsets ?? { G54: { x: 0, y: 0, z: 0 } };
  let time = 0;
  const timeline = [];

  for (const cmd of commands) {
    if (cmd.type !== 'motion') continue;

    const from = cmd.from;
    const to = cmd.to;
    const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (dist < 1e-9) continue;

    let feed = cmd.mode === 'G0'
      ? Math.min(machine.axes.X.maxVelocity, machine.axes.Y.maxVelocity, machine.axes.Z.maxVelocity) * 60
      : limitFeedByAxes(from, to, Math.max(1, cmd.feed), machine.axes);

    const duration = (dist / Math.max(feed / 60, 1e-9));
    const steps = Math.max(1, Math.ceil(duration / dt));
    const offset = workOffsets[cmd.workOffset] ?? { x: 0, y: 0, z: 0 };

    for (let i = 1; i <= steps; i += 1) {
      const u = i / steps;
      const axes = {
        x: from.x + (to.x - from.x) * u,
        y: from.y + (to.y - from.y) * u,
        z: from.z + (to.z - from.z) * u,
      };
      const tcp = forwardKinematics3Axis(machine, axes, offset);
      time += duration / steps;
      timeline.push({
        t: time,
        blockIndex: cmd.blockIndex,
        lineNumber: cmd.lineNumber,
        position: tcp,
        axes,
        feed,
        spindleRpm: cmd.spindleRpm,
        spindleMode: cmd.spindleMode,
        motionMode: cmd.mode,
      });
    }
  }

  return timeline;
}
