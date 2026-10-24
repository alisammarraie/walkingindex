import { buildGraph, analyse } from "./network.mjs";
import { demoNetwork } from "./demo.mjs";
const $ = (id) => document.getElementById(id),
  ns = "http://www.w3.org/2000/svg";
let data = demoNetwork(),
  graph,
  closures = new Set(),
  result,
  selectedOrigin;
const esc = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function load(next, name) {
  const checked = buildGraph(next);
  data = next;
  graph = checked;
  closures = new Set();
  selectedOrigin = graph.destinations.find((d) => d.attached)?.node ?? 0;
  $("origin").innerHTML = graph.nodes
    .map((n) => {
      const label = graph.destinations.find(
        (d) => d.attached && d.node === n.id,
      )?.name;
      return `<option value="${n.id}">${esc(label || `Junction ${n.id + 1}`)}</option>`;
    })
    .join("");
  $("origin").value = selectedOrigin;
  $("networkName").textContent = name;
  $("notice").textContent =
    graph.warnings.slice(0, 3).join(" ") ||
    "Shared path vertices form junctions. All paths are bidirectional.";
  $("networkInfo").textContent =
    `${graph.nodes.length} junctions · ${graph.edges.length} path segments · ${graph.destinations.length} destinations`;
  render();
}
function render() {
  try {
    selectedOrigin = Number($("origin").value);
    result = analyse(graph, {
      origin: selectedOrigin,
      minutes: Number($("minutes").value),
      speed: Number($("speed").value),
      accessibleOnly: $("accessible").checked,
      closures,
    });
    $("timeLabel").textContent = `${$("minutes").value} minutes`;
    $("reachable").textContent = result.destinations.filter(
      (d) => d.reachable,
    ).length;
    $("placesTotal").textContent = `of ${graph.destinations.length} places`;
    $("length").textContent = (result.reachableLength / 1000).toFixed(2);
    $("budget").textContent = `${Math.round(result.budget)} m walking budget`;
    $("closureCount").textContent = `${closures.size} scenario closures`;
    $("destinations").innerHTML = result.destinations
      .map(
        (d) =>
          `<li><div><strong>${esc(d.name)}</strong><small>${esc(d.category)}</small></div><span class="${d.reachable ? "reachable" : "outside"}">${Number.isFinite(d.minutes) ? `${d.minutes.toFixed(1)} min` : "Unconnected"}<small>${d.reachable ? "Within budget" : "Outside budget"}</small></span></li>`,
      )
      .join("");
    draw();
    $("error").textContent = "";
  } catch (e) {
    $("error").textContent = e.message;
  }
}
function draw() {
  const svg = $("map"),
    [minX, minY, maxX, maxY] = graph.bounds,
    lat = (((minY + maxY) / 2) * Math.PI) / 180,
    cos = Math.cos(lat);
  const spanX = Math.max(1, (maxX - minX) * 111320 * cos),
    spanY = Math.max(1, (maxY - minY) * 111320),
    scale = Math.min(820 / spanX, 610 / spanY);
  const xy = (c) => [
    490 + (c[0] - (minX + maxX) / 2) * 111320 * cos * scale,
    355 - (c[1] - (minY + maxY) / 2) * 111320 * scale,
  ];
  function add(type, attrs, parent = svg) {
    const e = document.createElementNS(ns, type);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.append(e);
    return e;
  }
  function line(coords, attrs) {
    const [a, b] = coords.map(xy);
    return add("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], ...attrs });
  }
  svg.replaceChildren();
  const defs = add("defs", {}),
    pattern = add(
      "pattern",
      { id: "grid", width: 40, height: 40, patternUnits: "userSpaceOnUse" },
      defs,
    );
  add(
    "path",
    {
      d: "M 40 0 L 0 0 0 40",
      fill: "none",
      stroke: "#e3e9e4",
      "stroke-width": 1,
    },
    pattern,
  );
  add("rect", { width: 980, height: 710, fill: "url(#grid)" });
  const origin = xy(graph.nodes[selectedOrigin].coordinate);
  add("circle", {
    cx: origin[0],
    cy: origin[1],
    r: result.budget * scale,
    fill: "#efc66b",
    opacity: 0.1,
    stroke: "#bba26b",
    "stroke-dasharray": "5 7",
  });
  for (const e of graph.edges) {
    const closed = closures.has(e.id) || e.closed;
    const coords = [graph.nodes[e.a].coordinate, graph.nodes[e.b].coordinate];
    line(coords, {
      stroke: closed ? "#ce6959" : "#ccd6ce",
      "stroke-width": 6,
      "stroke-linecap": "round",
      "stroke-dasharray": closed ? "4 7" : "",
    });
  }
  for (const segment of result.segments)
    line(segment, {
      stroke: "#288f76",
      "stroke-width": 6,
      "stroke-linecap": "round",
    });
  for (const e of graph.edges) {
    const coords = [graph.nodes[e.a].coordinate, graph.nodes[e.b].coordinate];
    const hit = line(coords, {
      stroke: "transparent",
      "stroke-width": 18,
      tabindex: 0,
      role: "button",
      "aria-label": `${closures.has(e.id) ? "Reopen" : "Close"} ${e.name} segment ${e.id + 1}`,
      class: "path-hit",
    });
    const toggle = () => {
      closures.has(e.id) ? closures.delete(e.id) : closures.add(e.id);
      render();
    };
    hit.onclick = toggle;
    hit.onkeydown = (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        toggle();
      }
    };
  }
  for (const n of graph.nodes) {
    const [x, y] = xy(n.coordinate),
      dot = add("circle", {
        cx: x,
        cy: y,
        r: 4,
        fill: "#fff",
        stroke: "#a6b7ad",
        class: "node",
        tabindex: 0,
        role: "button",
        "aria-label": `Start at junction ${n.id + 1}`,
      });
    const select = () => {
      $("origin").value = n.id;
      render();
    };
    dot.onclick = select;
    dot.onkeydown = (e) => {
      if (e.key === "Enter") select();
    };
  }
  for (const d of result.destinations) {
    const [x, y] = xy(d.coordinate);
    add("circle", {
      cx: x,
      cy: y,
      r: 9,
      fill: d.reachable ? "#174b40" : "#b5bdb8",
      stroke: "#fff",
      "stroke-width": 3,
    });
    const t = add("text", { x: x + 14, y: y - 12, class: "place-label" });
    t.textContent = d.name;
  }
  add("circle", {
    cx: origin[0],
    cy: origin[1],
    r: 16,
    fill: "#e8b953",
    stroke: "#fff",
    "stroke-width": 4,
  });
  const marker = add("text", {
    x: origin[0],
    y: origin[1] + 4,
    "text-anchor": "middle",
    fill: "#17362c",
    "font-size": 12,
    "font-weight": 800,
  });
  marker.textContent = "S";
  const bar = 100 * scale;
  add("line", {
    x1: 60,
    y1: 665,
    x2: 60 + bar,
    y2: 665,
    stroke: "#607c6a",
    "stroke-width": 3,
  });
  const label = add("text", {
    x: 60,
    y: 690,
    fill: "#607c6a",
    "font-size": 13,
  });
  label.textContent = "100 m";
}
for (const id of ["origin", "minutes", "speed", "accessible"])
  $(id).addEventListener(id === "minutes" ? "input" : "change", render);
$("clear").onclick = () => {
  closures.clear();
  render();
};
$("demo").onclick = () => load(demoNetwork(), "Canalside · fictional example");
$("import").onclick = () => $("file").click();
$("file").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    if (f.size > 5e6) throw Error("Maximum file size: 5 MB.");
    load(JSON.parse(await f.text()), f.name);
  } catch (err) {
    $("error").textContent = err.message;
  }
  e.target.value = "";
};
function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("export").onclick = () => {
  const row = (values) =>
    values.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(",");
  const rows = [
    [
      "name",
      "category",
      "distance_m",
      "walk_minutes",
      "within_budget",
      "origin_node",
      "budget_minutes",
      "speed_kmh",
      "accessible_only",
      "scenario_closed_edge_ids",
    ],
    ...result.destinations.map((d) => [
      d.name,
      d.category,
      Number.isFinite(d.distance) ? d.distance.toFixed(1) : "",
      Number.isFinite(d.minutes) ? d.minutes.toFixed(2) : "",
      d.reachable,
      selectedOrigin,
      $("minutes").value,
      $("speed").value,
      $("accessible").checked,
      [...closures].join(";"),
    ]),
  ];
  download("walkingindex-results.csv", rows.map(row).join("\r\n"), "text/csv");
};
$("sample").onclick = () =>
  download(
    "walkingindex-example.geojson",
    JSON.stringify(demoNetwork(), null, 2),
    "application/geo+json",
  );
load(data, "Canalside · fictional example");
