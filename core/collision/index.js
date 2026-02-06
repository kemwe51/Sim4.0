function pointInAabb(p, aabb, radius = 0) {
  return p.x + radius >= aabb.min.x && p.x - radius <= aabb.max.x
    && p.y + radius >= aabb.min.y && p.y - radius <= aabb.max.y
    && p.z + radius >= aabb.min.z && p.z - radius <= aabb.max.z;
}

export function detectCollisions(timeline, machine) {
  const events = [];
  const envelope = machine.envelope;
  const fixtures = machine.fixtures ?? [];
  const toolRadius = (machine.tool?.diameter ?? 10) / 2;

  timeline.forEach((sample) => {
    const p = sample.position;
    if (!pointInAabb(p, envelope, 0)) {
      events.push({
        kind: 'TRAVEL_LIMIT',
        t: sample.t,
        lineNumber: sample.lineNumber,
        blockIndex: sample.blockIndex,
        point: p,
        pair: ['tool', 'machine_envelope'],
      });
    }

    fixtures.forEach((fixture) => {
      if (pointInAabb(p, fixture.aabb, toolRadius)) {
        events.push({
          kind: 'COLLISION',
          t: sample.t,
          lineNumber: sample.lineNumber,
          blockIndex: sample.blockIndex,
          point: p,
          pair: ['tool', fixture.name],
        });
      }
    });
  });

  return events;
}
