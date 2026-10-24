/** Entirely fictional town. No real project geometry or personal data. */
export function demoNetwork() {
  const features = [],
    c = (x, y) => [x / 111320, y / 111320];
  for (let y = -4; y <= 4; y++)
    for (let x = -4; x <= 4; x++) {
      if (x < 4 && !(x === 0 && y !== -2 && y !== 2))
        features.push({
          type: "Feature",
          properties: {
            name: x === 0 ? "Canal bridge" : "Neighbourhood path",
            accessible: !(y === -2 && x === 0),
          },
          geometry: {
            type: "LineString",
            coordinates: [c(x * 150, y * 150), c((x + 1) * 150, y * 150)],
          },
        });
      if (y < 4)
        features.push({
          type: "Feature",
          properties: { name: "North–south path", accessible: true },
          geometry: {
            type: "LineString",
            coordinates: [c(x * 150, y * 150), c(x * 150, (y + 1) * 150)],
          },
        });
    }
  for (const [name, category, x, y] of [
    ["Transit hub", "Transport", -2, 0],
    ["Primary school", "Education", -3, 2],
    ["Community clinic", "Health", 2, 1],
    ["Riverside park", "Green space", 1, 0],
    ["Library", "Culture", -1, -2],
    ["Food market", "Shops", 3, -1],
    ["Sports centre", "Leisure", 2, 3],
    ["Town square", "Public space", -2, -3],
  ])
    features.push({
      type: "Feature",
      properties: { name, category },
      geometry: { type: "Point", coordinates: c(x * 150, y * 150) },
    });
  return {
    type: "FeatureCollection",
    name: "Canalside · fictional example",
    features,
  };
}
