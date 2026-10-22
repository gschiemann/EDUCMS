export interface EmergencyStage { width: number; height: number; orientation: 'portrait' | 'landscape' }
type Size = { width: number; height: number };
const valid = (size?: Size | null): size is Size => !!size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;

/** Only dimensions belonging to this document/face enter this decision. */
export function chooseEmergencyStage(viewport: Size, options: { rotated?: boolean; canvas?: Size | null; nativeDisplay?: Size | null } = {}): EmergencyStage {
  const own = valid(options.canvas) ? options.canvas : valid(options.nativeDisplay) ? options.nativeDisplay : viewport;
  const rotated = own === viewport && options.rotated;
  const width = rotated ? own.height : own.width;
  const height = rotated ? own.width : own.height;
  return { width, height, orientation: height > width ? 'portrait' : 'landscape' };
}
