/** A day remains one readable unit. Tiny zones page the forecast instead of
 * shrinking five days to illegible type. Sizes are the zone's own CSS pixels. */
export function forecastGeometry(
  width: number,
  height: number,
  count: number,
  layout: string,
) {
  const w = Math.max(1, width),
    h = Math.max(1, height);
  const micro = h < 200;
  const list = layout === "list" && w >= 280 && !micro;
  const compact = micro || layout === "strip" || w / h > 2.8 || h < 300;
  const padding = Math.min(28, Math.max(4, Math.min(w, h) * 0.035));
  const availableWidth = Math.max(1, w - padding * 2);
  const overhead = micro ? 30 : Math.min(110, Math.max(48, h * 0.16));
  const availableHeight = Math.max(1, h - padding * 2 - overhead);
  const wanted = list ? 1 : w / h < 1.35 ? Math.min(2, count) : count;
  const columns = Math.max(
    1,
    Math.min(wanted, Math.floor(availableWidth / (micro ? 180 : 112))),
  );
  const minimumHeight = list ? 64 : micro ? 34 : compact ? 142 : 190;
  const capacity = Math.max(
    1,
    Math.min(
      count,
      columns * Math.max(1, Math.floor(availableHeight / minimumHeight)),
    ),
  );
  const pageColumns = Math.min(columns, capacity);
  const rows = Math.ceil(capacity / pageColumns);
  const cellWidth = availableWidth / pageColumns,
    cellHeight = availableHeight / rows;
  const font = Math.max(
    micro ? 12 : 14,
    Math.min(
      112,
      list
        ? Math.min(w / 27, cellHeight / 5.8)
        : micro
          ? Math.min(cellWidth / 8.5, cellHeight / 1.8)
          : Math.min(
              cellWidth / (compact ? 6.5 : 7.4),
              cellHeight / (compact ? 11.2 : 14.5),
            ),
    ),
  );
  return {
    micro,
    list,
    compact,
    padding,
    capacity,
    columns: pageColumns,
    rows,
    font,
  };
}
