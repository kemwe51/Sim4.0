export function createVoxelStock({ width, height, depth, voxelSize }) {
  const nx = Math.max(1, Math.ceil(width / voxelSize));
  const ny = Math.max(1, Math.ceil(height / voxelSize));
  const nz = Math.max(1, Math.ceil(depth / voxelSize));
  const voxels = new Uint8Array(nx * ny * nz).fill(1);
  return { width, height, depth, voxelSize, nx, ny, nz, voxels };
}

function idx(stock, x, y, z) {
  return z * stock.nx * stock.ny + y * stock.nx + x;
}

export function carveWithTool(stock, from, to, toolRadius) {
  const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const samples = Math.max(1, Math.ceil(len / (stock.voxelSize * 0.5)));
  for (let s = 0; s <= samples; s += 1) {
    const u = s / samples;
    const p = {
      x: from.x + (to.x - from.x) * u,
      y: from.y + (to.y - from.y) * u,
      z: from.z + (to.z - from.z) * u,
    };
    const minX = Math.max(0, Math.floor((p.x - toolRadius) / stock.voxelSize));
    const maxX = Math.min(stock.nx - 1, Math.floor((p.x + toolRadius) / stock.voxelSize));
    const minY = Math.max(0, Math.floor((p.y - toolRadius) / stock.voxelSize));
    const maxY = Math.min(stock.ny - 1, Math.floor((p.y + toolRadius) / stock.voxelSize));
    const minZ = Math.max(0, Math.floor((p.z - toolRadius) / stock.voxelSize));
    const maxZ = Math.min(stock.nz - 1, Math.floor((p.z + toolRadius) / stock.voxelSize));

    for (let z = minZ; z <= maxZ; z += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const cx = (x + 0.5) * stock.voxelSize;
          const cy = (y + 0.5) * stock.voxelSize;
          const cz = (z + 0.5) * stock.voxelSize;
          if (Math.hypot(cx - p.x, cy - p.y, cz - p.z) <= toolRadius) {
            stock.voxels[idx(stock, x, y, z)] = 0;
          }
        }
      }
    }
  }
}

export function runStockRemoval(stock, timeline, toolDiameter) {
  for (let i = 1; i < timeline.length; i += 1) {
    carveWithTool(stock, timeline[i - 1].axes, timeline[i].axes, toolDiameter / 2);
  }
  return stock;
}

export function stockHash(stock) {
  let hash = 2166136261;
  for (const byte of stock.voxels) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function exportStockToAsciiStl(stock) {
  const tris = [];
  const vs = stock.voxelSize;
  for (let z = 0; z < stock.nz; z += 1) {
    for (let y = 0; y < stock.ny; y += 1) {
      for (let x = 0; x < stock.nx; x += 1) {
        if (stock.voxels[idx(stock, x, y, z)] === 0) continue;
        const x0 = x * vs; const x1 = x0 + vs;
        const y0 = y * vs; const y1 = y0 + vs;
        const z1 = (z + 1) * vs;
        tris.push([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1]], [[x0, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
      }
    }
  }
  const lines = ['solid reststock'];
  for (const tri of tris) {
    lines.push(' facet normal 0 0 1', '  outer loop');
    tri.forEach((v) => lines.push(`   vertex ${v[0]} ${v[1]} ${v[2]}`));
    lines.push('  endloop', ' endfacet');
  }
  lines.push('endsolid reststock');
  return lines.join('\n');
}
