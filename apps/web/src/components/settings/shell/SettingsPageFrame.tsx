"use client";

/**
 * <SettingsPageFrame> — the one component every Settings category page
 * renders as its root. It registers the page contract (§19.2) with the
 * shell and renders the editor body in place.
 *
 *   <SettingsPageFrame
 *     section="brand"
 *     title="Brand & appearance"
 *     description="One source of truth for dashboard chrome and supported screen templates."
 *     scope={{ kind: 'organization', label: tenant.name }}
 *     save={{ dirty: changeCount, saving, onSave, onDiscard }}
 *     context={<><ContextModule label="Applies to">…</ContextModule></>}
 *   >
 *     <EditorHead icon={Palette} title="Organization brand" … />
 *     <EditorSection title="Identity" …>…</EditorSection>
 *   </SettingsPageFrame>
 *
 * The shell owns: breadcrumb, H1, purpose line, Discard/Save, the index,
 * the context rail/drawer, the dirty guard and the command palette. Pages
 * own their data, mutations, validation and error summaries.
 */
import { useEffect, type ReactNode } from 'react';
import { useSettingsShellActions, type SettingsPageRegistration } from './SettingsShellContext';

export type SettingsPageFrameProps = SettingsPageRegistration & { children: ReactNode };

export function SettingsPageFrame({ children, ...reg }: SettingsPageFrameProps) {
  const { registerPage } = useSettingsShellActions();
  const {
    section,
    title,
    description,
    subtitle,
    scope,
    headerAction,
    save,
    context,
    searchItems,
  } = reg;
  const scopeKind = scope?.kind;
  const scopeLabel = scope?.label;
  const dirty = save?.dirty ?? false;
  const saving = save?.saving ?? false;
  const onSave = save?.onSave;
  const onDiscard = save?.onDiscard;

  useEffect(() => {
    registerPage({
      section,
      title,
      description,
      subtitle,
      scope: scopeKind && scopeLabel ? { kind: scopeKind, label: scopeLabel } : undefined,
      headerAction,
      save: save ? { dirty, saving, onSave, onDiscard } : undefined,
      context,
      searchItems,
    });
    // `context` / `headerAction` are ReactNodes and change identity every
    // render; that's fine — registration is a cheap setState and the shell
    // re-renders the rail with the fresh node.
  }, [registerPage, section, title, description, subtitle, scopeKind, scopeLabel, headerAction, save, dirty, saving, onSave, onDiscard, context, searchItems]);

  useEffect(() => () => registerPage(null), [registerPage]);

  return <>{children}</>;
}
