/** City-scale walking-network analysis. Coordinates are WGS84 [longitude, latitude]. */
export function metric(a, b) {
  const latitude = ((a[1] + b[1]) * Math.PI) / 360;
  return Math.hypot(
    (a[0] - b[0]) * 111320 * Math.cos(latitude),
    (a[1] - b[1]) * 111320,
  );
}

function validCoordinate(c) {
  if (
    !Array.isArray(c) ||
    c.length < 2 ||
    !Number.isFinite(c[0]) ||
    !Number.isFinite(c[1]) ||
    Math.abs(c[0]) > 180 ||
    Math.abs(c[1]) > 85
  )
    throw Error(
      "Use WGS84 coordinates: [longitude, latitude], within ±85° latitude.",
    );
  return c.slice(0, 2);
}

export function buildGraph(data) {
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features))
    throw Error("Import a GeoJSON FeatureCollection.");
  if (data.features.length > 5000)
    throw Error("Limit the file to 5,000 features.");
  const nodes = [],
    edges = [],
    destinations = [],
    ids = new Map(),
    warnings = [];
  function node(raw) {
    const c = validCoordinate(raw),
      key = c.map((v) => v.toFixed(6)).join(",");
    if (!ids.has(key)) {
      if (nodes.length >= 10000)
        throw Error("Limit the network to 10,000 unique vertices.");
      ids.set(key, nodes.length);
      nodes.push({ id: nodes.length, coordinate: c, links: [] });
    }
    return ids.get(key);
  }
  function line(coords, properties = {}) {
    if (!Array.isArray(coords) || coords.length < 2)
      throw Error("Each path needs at least two coordinates.");
    for (let i = 1; i < coords.length; i++) {
      const a = node(coords[i - 1]),
        b = node(coords[i]);
      if (a === b) continue;
      const edge = {
        id: edges.length,
        a,
        b,
        length: metric(nodes[a].coordinate, nodes[b].coordinate),
        name: String(properties.name || "Walking path"),
        accessible:
          properties.accessible !== false && properties.accessible !== "false",
        closed: properties.closed === true || properties.closed === "true",
      };
      if (edges.length >= 20000)
        throw Error("Limit the network to 20,000 path segments.");
      edges.push(edge);
      nodes[a].links.push(edge.id);
      nodes[b].links.push(edge.id);
    }
  }
  for (const f of data.features) {
    if (!f?.geometry) continue;
    const g = f.geometry,
      p = f.properties || {};
    if (g.type === "LineString") line(g.coordinates, p);
    else if (g.type === "MultiLineString")
      g.coordinates.forEach((c) => line(c, p));
    else if (g.type === "Point")
      destinations.push({
        name: String(p.name || "Destination"),
        category: String(p.category || "Place"),
        coordinate: validCoordinate(g.coordinates),
      });
    else warnings.push(`Ignored geometry: ${g.type}`);
  }
  if (!edges.length)
    throw Error("Include LineString or MultiLineString walking paths.");
  const xs = nodes.map((n) => n.coordinate[0]),
    ys = nodes.map((n) => n.coordinate[1]);
  const bounds = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
  if (bounds[2] - bounds[0] > 2 || bounds[3] - bounds[1] > 2)
    throw Error(
      "Use a city-scale network spanning less than 2° in each direction.",
    );
  for (const d of destinations) {
    let nearest = -1,
      distance = Infinity;
    for (const n of nodes) {
      const m = metric(n.coordinate, d.coordinate);
      if (m < distance) {
        nearest = n.id;
        distance = m;
      }
    }
    d.node = nearest;
    d.connector = distance;
    d.attached = distance <= 100;
    if (!d.attached)
      warnings.push(
        `${d.name}: more than 100 m from a path vertex; excluded from accessibility results.`,
      );
  }
  return { nodes, edges, destinations, bounds, warnings };
}

// A binary min-heap keeps routing responsive for imported networks.
class Heap {
  values = [];
  push(item) {
    let i = this.values.length;
    this.values.push(item);
    while (i > 0) {
      let p = (i - 1) >> 1;
      if (this.values[p][0] <= item[0]) break;
      this.values[i] = this.values[p];
      i = p;
    }
    this.values[i] = item;
  }
  pop() {
    const first = this.values[0],
      last = this.values.pop();
    if (this.values.length) {
      let i = 0;
      while (i * 2 + 1 < this.values.length) {
        let c = i * 2 + 1;
        if (
          c + 1 < this.values.length &&
          this.values[c + 1][0] < this.values[c][0]
        )
          c++;
        if (this.values[c][0] >= last[0]) break;
        this.values[i] = this.values[c];
        i = c;
      }
      this.values[i] = last;
    }
    return first;
  }
}

export function analyse(
  graph,
  {
    origin = 0,
    minutes = 10,
    speed = 4.8,
    accessibleOnly = false,
    closures = new Set(),
  } = {},
) {
  if (!Number.isInteger(origin) || !graph.nodes[origin])
    throw Error("Select a valid network origin.");
  if (
    !Number.isFinite(minutes) ||
    minutes <= 0 ||
    minutes > 120 ||
    !Number.isFinite(speed) ||
    speed <= 0 ||
    speed > 12
  )
    throw Error(
      "Use 0–120 minutes and a walking speed greater than 0 and at most 12 km/h.",
    );
  const budget = (minutes * speed * 1000) / 60,
    distances = graph.nodes.map(() => Infinity),
    heap = new Heap();
  const allowed = (e) =>
    !e.closed && !closures.has(e.id) && (!accessibleOnly || e.accessible);
  distances[origin] = 0;
  heap.push([0, origin]);
  while (heap.values.length) {
    const [distance, id] = heap.pop();
    if (distance !== distances[id]) continue;
    for (const edgeId of graph.nodes[id].links) {
      const e = graph.edges[edgeId];
      if (!allowed(e)) continue;
      const next = e.a === id ? e.b : e.a,
        candidate = distance + e.length;
      if (candidate < distances[next]) {
        distances[next] = candidate;
        heap.push([candidate, next]);
      }
    }
  }
  const segments = [],
    interpolate = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  let reachableLength = 0;
  for (const e of graph.edges) {
    if (!allowed(e)) continue;
    const fromA = Math.max(0, Math.min(e.length, budget - distances[e.a])),
      fromB = Math.max(0, Math.min(e.length, budget - distances[e.b]));
    const a = graph.nodes[e.a].coordinate,
      b = graph.nodes[e.b].coordinate;
    reachableLength += Math.min(e.length, fromA + fromB);
    if (fromA + fromB >= e.length) segments.push([a, b]);
    else {
      if (fromA > 0) segments.push([a, interpolate(a, b, fromA / e.length)]);
      if (fromB > 0) segments.push([interpolate(b, a, fromB / e.length), b]);
    }
  }
  const destinations = graph.destinations
    .map((d) => {
      const distance = d.attached ? distances[d.node] + d.connector : Infinity;
      return {
        ...d,
        distance,
        minutes: distance / ((speed * 1000) / 60),
        reachable: distance <= budget + 1e-7,
      };
    })
    .sort((a, b) => a.distance - b.distance);
  return {
    budget,
    distances,
    segments,
    reachableLength,
    destinations,
    reachableNodes: distances.filter((d) => d <= budget).length,
  };
}
