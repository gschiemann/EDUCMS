"use client";

/**
 * Settings Command Center — page contract + dirty-state coordination.
 *
 * Handoff §19.2: each category page provides title/description, scope,
 * editor content, dirty/save state, optional context modules and an
 * optional section status. The page registers those through
 * <SettingsPageFrame>; the shell (layout.tsx) reads them here to render the
 * shared header, the context rail and the dirty navigation guard (§9.2).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { SettingsSectionId } from './registry';

export type SettingsScopeKind = 'account' | 'organization' | 'location';
export type SettingsSectionStatus = 'attention' | 'error' | null;

export interface SettingsSearchItem {
  /** Field / setting label shown in the palette. */
  label: string;
  /** Extra synonyms. */
  keywords?: readonly string[];
  /** Anchor id inside the editor (scrolled into view + focused). */
  anchor?: string;
  /** Absolute href when the item lives on a nested route. */
  href?: string;
}

export interface SettingsSaveState {
  /** true, or a count of pending changes for "Save N changes". */
  dirty: boolean | number;
  saving?: boolean;
  onSave?: () => void | Promise<void>;
  onDiscard?: () => void;
}

export interface SettingsPageRegistration {
  section: SettingsSectionId;
  title: string;
  description?: string;
  /** Breadcrumb tail for nested routes, e.g. "SSO". */
  subtitle?: string;
  scope?: { kind: SettingsScopeKind; label: string };
  /** Contextual secondary action rendered left of Discard/Save. */
  headerAction?: ReactNode;
  save?: SettingsSaveState;
  /** Context-rail modules (§6.6). Rendered in the rail ≥1280px, drawer below. */
  context?: ReactNode;
  searchItems?: readonly SettingsSearchItem[];
}

interface DirtyPrompt {
  href: string;
}

interface SettingsShellContextValue {
  page: SettingsPageRegistration | null;
  registerPage: (reg: SettingsPageRegistration | null) => void;
  statuses: Partial<Record<SettingsSectionId, SettingsSectionStatus>>;
  setSectionStatus: (id: SettingsSectionId, status: SettingsSectionStatus) => void;
  /** Navigate, running the dirty guard first. Use instead of router.push inside Settings. */
  navigate: (href: string) => void;
  dirtyPrompt: DirtyPrompt | null;
  resolveDirtyPrompt: (choice: 'save' | 'discard' | 'stay') => Promise<void>;
  contextOpen: boolean;
  setContextOpen: (open: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}

const SettingsShellContext = createContext<SettingsShellContextValue | null>(null);

export function isDirty(save?: SettingsSaveState): boolean {
  if (!save) return false;
  return typeof save.dirty === 'number' ? save.dirty > 0 : !!save.dirty;
}

export function SettingsShellProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [page, setPage] = useState<SettingsPageRegistration | null>(null);
  const [statuses, setStatuses] = useState<Partial<Record<SettingsSectionId, SettingsSectionStatus>>>({});
  const [dirtyPrompt, setDirtyPrompt] = useState<DirtyPrompt | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // The guard reads the LATEST registration without re-subscribing.
  const pageRef = useRef<SettingsPageRegistration | null>(null);
  pageRef.current = page;
  // Focus is returned to the control that started a blocked navigation
  // when the operator chooses "Stay here" (§9.2).
  const initiatorRef = useRef<HTMLElement | null>(null);

  const registerPage = useCallback((reg: SettingsPageRegistration | null) => {
    setPage(reg);
  }, []);

  const setSectionStatus = useCallback((id: SettingsSectionId, status: SettingsSectionStatus) => {
    setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }));
  }, []);

  const navigate = useCallback(
    (href: string) => {
      if (isDirty(pageRef.current?.save)) {
        initiatorRef.current = (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
        setDirtyPrompt({ href });
        return;
      }
      router.push(href);
    },
    [router],
  );

  const resolveDirtyPrompt = useCallback(
    async (choice: 'save' | 'discard' | 'stay') => {
      const prompt = dirtyPrompt;
      setDirtyPrompt(null);
      if (!prompt) return;
      const save = pageRef.current?.save;
      if (choice === 'stay') {
        initiatorRef.current?.focus?.();
        initiatorRef.current = null;
        return;
      }
      if (choice === 'save') {
        try {
          await save?.onSave?.();
        } catch {
          // The page keeps its input and shows its own error summary (§13.1);
          // never navigate away from a failed save.
          return;
        }
        router.push(prompt.href);
        return;
      }
      save?.onDiscard?.();
      router.push(prompt.href);
    },
    [dirtyPrompt, router],
  );

  // Browser-level guard (refresh / close tab / external link) while dirty.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty(pageRef.current?.save)) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const value = useMemo<SettingsShellContextValue>(
    () => ({
      page,
      registerPage,
      statuses,
      setSectionStatus,
      navigate,
      dirtyPrompt,
      resolveDirtyPrompt,
      contextOpen,
      setContextOpen,
      paletteOpen,
      setPaletteOpen,
    }),
    [page, registerPage, statuses, setSectionStatus, navigate, dirtyPrompt, resolveDirtyPrompt, contextOpen, paletteOpen],
  );

  return <SettingsShellContext.Provider value={value}>{children}</SettingsShellContext.Provider>;
}

export function useSettingsShell(): SettingsShellContextValue {
  const ctx = useContext(SettingsShellContext);
  if (!ctx) {
    throw new Error('useSettingsShell must be used inside /[schoolId]/settings (SettingsShellProvider)');
  }
  return ctx;
}

/** Non-throwing variant for components that may render outside Settings. */
export function useOptionalSettingsShell(): SettingsShellContextValue | null {
  return useContext(SettingsShellContext);
}
