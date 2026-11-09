/**
 * Light-weight constants + mode inference shared by the editor and the live
 * data widgets. Kept free of React/widget imports so the builder panel can
 * use them without pulling the (lazy) live-data renderers into its chunk.
 */
export const PUBLIC_DATA_TEXT_AREAS: [string, string][] = [
  ["title", "Heading"],
  ["dataLocation", "Location / station"],
  ["dataValue", "Main values"],
  ["dataDetails", "Details"],
  ["dataSource", "Source and time"],
];
export const PUBLIC_DATA_LAYOUTS: [string, string][] = [
  ["auto", "Automatic"],
  ["cards", "Cards"],
  ["list", "List"],
  ["banner", "Horizontal banner"],
];
