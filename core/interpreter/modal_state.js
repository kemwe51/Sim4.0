export function createModalState() {
  return {
    plane: 'G17',
    units: 'mm',
    distanceMode: 'G90',
    feedMode: 'G94',
    motionMode: 'G0',
    spindleMode: 'M5',
    spindleRpm: 0,
    feed: 1000,
    workOffset: 'G54',
    tool: 0,
    position: { x: 0, y: 0, z: 0 },
  };
}
