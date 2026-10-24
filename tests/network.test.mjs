import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, analyse, metric } from "../src/network.mjs";
import { demoNetwork } from "../src/demo.mjs";

test("a destination on the exact budget boundary remains reachable", () => {
  const data = {type: "FeatureCollection", features: [
    {type: "Feature", properties: {}, geometry: {type: "LineString", coordinates: [[0,0],[1200/111320,0]]}},
    {type: "Feature", properties: {}, geometry: {type: "Point", coordinates: [1200/111320,0]}}
  ]};
  assert.equal(analyse(buildGraph(data), {minutes: 15, speed: 4.8}).destinations[0].reachable, true);
});
const c = (x, y) => [x / 111320, y / 111320];
const feature = (type, coordinates, properties = {}) => ({
  type: "Feature",
  properties,
  geometry: { type, coordinates },
});
const graph = (features) => buildGraph({ type: "FeatureCollection", features });
test("routing follows a detour rather than straight-line proximity", () => {
  const g = graph([
    feature("LineString", [c(0, 0), c(0, 200), c(200, 200), c(200, 0)]),
    feature("Point", c(200, 0), { name: "Across the barrier" }),
  ]);
  const r = analyse(g, { minutes: 5, speed: 4.8 });
  assert.ok(Math.abs(r.destinations[0].distance - 600) < 0.01);
  assert.ok(metric(c(0, 0), c(200, 0)) < 201);
  assert.equal(r.destinations[0].reachable, false);
});
test("partial edge catchments stop at the exact walking budget", () => {
  const g = graph([feature("LineString", [c(0, 0), c(1000, 0)])]);
  const r = analyse(g, { minutes: 5, speed: 4.8 });
  assert.equal(r.budget, 400);
  assert.equal(r.reachableLength, 400);
  assert.ok(Math.abs(metric(r.segments[0][0], r.segments[0][1]) - 400) < 0.001);
});
test("scenario closures and accessibility flags affect routing", () => {
  const g = graph([
    feature("LineString", [c(0, 0), c(100, 0)], { accessible: false }),
    feature("Point", c(100, 0)),
  ]);
  assert.equal(analyse(g).destinations[0].reachable, true);
  assert.equal(
    analyse(g, { accessibleOnly: true }).destinations[0].reachable,
    false,
  );
  assert.equal(
    analyse(g, { closures: new Set([0]) }).destinations[0].reachable,
    false,
  );
});
test("disconnected components remain unreachable at any allowed budget", () => {
  const g = graph([
    feature("LineString", [c(0, 0), c(100, 0)]),
    feature("LineString", [c(200, 0), c(300, 0)]),
    feature("Point", c(300, 0)),
  ]);
  assert.equal(analyse(g, { minutes: 120 }).destinations[0].distance, Infinity);
});
test("destinations include connector distance and distant points are excluded", () => {
  const g = graph([
    feature("LineString", [c(0, 0), c(100, 0)]),
    feature("Point", c(100, 50)),
    feature("Point", c(100, 250)),
  ]);
  const r = analyse(g);
  assert.ok(Math.abs(r.destinations[0].distance - 150) < 0.01);
  assert.equal(r.destinations[1].reachable, false);
  assert.equal(g.warnings.length, 1);
});
test("a shared coordinate forms a junction, an unsplit crossing does not", () => {
  const g = graph([
    feature("LineString", [c(-100, 0), c(0, 0), c(100, 0)]),
    feature("LineString", [c(0, -100), c(0, 0), c(0, 100)]),
  ]);
  assert.equal(g.nodes.length, 5);
  assert.equal(analyse(g).reachableNodes, 5);
  const unsplit = graph([
    feature("LineString", [c(-100, 0), c(100, 0)]),
    feature("LineString", [c(0, -100), c(0, 100)]),
  ]);
  assert.equal(analyse(unsplit).reachableNodes, 2);
});
test("invalid geography and parameters produce actionable errors", () => {
  assert.throws(
    () =>
      graph([
        feature("LineString", [
          [999, 0],
          [0, 0],
        ]),
      ]),
    /WGS84/,
  );
  assert.throws(
    () =>
      graph([
        feature("LineString", [
          [0, 0],
          [3, 0],
        ]),
      ]),
    /city-scale/,
  );
  const g = buildGraph(demoNetwork());
  assert.throws(() => analyse(g, { speed: 0 }), /speed/);
  assert.throws(() => analyse(g, { origin: 999 }), /origin/);
});
test("the demo canal has a longer detour when its accessible bridge closes", () => {
  const g = buildGraph(demoNetwork()),
    origin = g.destinations.find((d) => d.name === "Transit hub").node;
  const bridge = g.edges.find((e) => e.name === "Canal bridge" && e.accessible);
  assert.ok(bridge);
  const baseline = analyse(g, { origin, accessibleOnly: true, minutes: 30 });
  const closed = analyse(g, {
    origin,
    accessibleOnly: true,
    closures: new Set([bridge.id]),
    minutes: 30,
  });
  assert.ok(
    closed.destinations.filter((d) => d.reachable).length <
      baseline.destinations.filter((d) => d.reachable).length,
  );
});
