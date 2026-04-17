export interface TouchActionConfig {
  type: 'navigate' | 'show' | 'url';
  target: string;
}

export interface Zone {
  id: string;
  name: string;
  widgetType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  sortOrder: number;
  defaultConfig?: Record<string, unknown> | null;
  locked?: boolean;
  touchAction?: TouchActionConfig | null;
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  category?: string;
  orientation?: string;
  screenWidth: number;
  screenHeight: number;
  bgColor?: string | null;
  bgImage?: string | null;
  bgGradient?: string | null;
  isSystem?: boolean;
  status?: string;
  zones: Zone[];
}

export interface HistoryEntry {
  zones: Zone[];
  meta: {
    name: string;
    description: string;
    screenWidth: number;
    screenHeight: number;
    bgColor: string;
    bgGradient: string;
    bgImage: string;
  };
}

export type DragMode = 'move' | 'resize';
export type ResizeHandle = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface DragState {
  mode: DragMode;
  zoneId: string;
  handle?: ResizeHandle;
  startX: number;
  startY: number;
  orig: Zone;
  additionalSelectedIds?: string[];
  origMulti?: Record<string, Zone>;
}

export interface SnapLine {
  orientation: 'v' | 'h';
  position: number;
  kind: 'grid' | 'edge' | 'center' | 'canvas';
}
