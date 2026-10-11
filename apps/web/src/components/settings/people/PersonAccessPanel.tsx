'use client';

/**
 * Settings → People → "Locations & screens" (2026-10-11, user scoping).
 *
 * Per person: which locations of the organisation they can use (their role
 * applies in each), and — per location — an optional limit to specific
 * screens / screen groups. The server is the authority on every rule
 * (`apps/api/src/user-scope/user-access.controller.ts`): only an org admin may
 * change locations, a location admin may limit screens in their own location,
 * org admins themselves cannot be limited. This panel only renders what the
 * GET answer says is editable, and says plainly what is not.
 *
 * Emergency alerts are never limited by a screen limit (owner decision); the
 * help text says so, so nobody limits a person expecting it to.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, MapPin, MonitorSmartphone } from 'lucide-react';
import { useSetUserAccess, useUserAccess, type TeamUser, type UserAccess } from '@/hooks/use-api';

type ScopeState = Record<string, { screenIds: string[]; screenGroupIds: string[] }>;

function toggle(list: string[], id: string, on: boolean): string[] {
  const has = list.includes(id);
  if (on && !has) return [...list, id];
  if (!on && has) return list.filter((x) => x !== id);
  return list;
}

export function PersonAccessPanel({ user, onClose }: { user: Pick<TeamUser, 'id' | 'email'>; onClose: () => void }) {
  const t = useTranslations();
  const query = useUserAccess(user.id);
  const save = useSetUserAccess();
  const data: UserAccess | undefined = query.data;

  // The form starts from the server's answer; a draft exists only once the
  // admin changes something (derived, so no effect has to copy it in).
  const [draftLocations, setDraftLocations] = useState<string[] | null>(null);
  const [draftScopes, setDraftScopes] = useState<ScopeState | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);

  const seedLocations = useMemo(
    () => (data ? data.locations.filter((l) => l.granted && !l.isHome).map((l) => l.id) : null),
    [data],
  );
  const seedScopes = useMemo(() => {
    if (!data) return null;
    const seeded: ScopeState = {};
    for (const [tid, sc] of Object.entries(data.screenScopes)) seeded[tid] = { screenIds: [...sc.screenIds], screenGroupIds: [...sc.screenGroupIds] };
    return seeded;
  }, [data]);
  const locationIds = draftLocations ?? seedLocations;
  const scopes = draftScopes ?? seedScopes;

  const reachable = useMemo(() => {
    if (!data || !locationIds) return [];
    return data.locations.filter((l) => l.isHome || locationIds.includes(l.id));
  }, [data, locationIds]);

  const panelId = `people-access-${user.id}`;

  if (query.isLoading || (!query.isError && (!data || locationIds === null || scopes === null))) {
    return (
      <div id={panelId} className="md:col-span-4 mt-2 rounded-[11px] border border-slate-200 bg-slate-50/70 p-3.5">
        <Loader2 className="w-4 h-4 animate-spin text-slate-400" aria-label={t('settings.common.loading')} />
      </div>
    );
  }
  if (query.isError || !data || !locationIds || !scopes) {
    return (
      <div id={panelId} className="md:col-span-4 mt-2 rounded-[11px] border border-rose-200 bg-rose-50/70 p-3.5">
        <p role="alert" className="text-[12px] text-rose-700">{t('settings.cc.people.accessLoadFailed')}</p>
      </div>
    );
  }

  const scopable = data.scopable;
  const submit = () => {
    setStatus(null);
    const screenScopes: Record<string, { screenIds: string[]; screenGroupIds: string[] } | null> = {};
    for (const l of reachable) {
      if (!l.scopeEditable || !data.options[l.id]) continue;
      const s = scopes[l.id];
      screenScopes[l.id] = s && (s.screenIds.length || s.screenGroupIds.length) ? s : null;
    }
    save.mutate(
      { id: user.id, locationIds, screenScopes },
      {
        onSuccess: (out) =>
          setStatus({
            kind: 'ok',
            message: out.changed ? t('settings.cc.people.accessSaved', { email: user.email }) : t('settings.cc.people.accessUnchanged'),
          }),
        onError: (e: Error) => setStatus({ kind: 'err', message: e?.message || t('settings.cc.people.accessFailed') }),
      },
    );
  };

  return (
    <form
      id={panelId}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="md:col-span-4 mt-2 rounded-[11px] border border-slate-200 bg-slate-50/70 p-3.5"
    >
      <p className="text-[13px] font-medium text-slate-900">{t('settings.cc.people.accessTitle', { email: user.email })}</p>
      <p className="mt-1 text-[12px] leading-[17px] text-slate-600">{t('settings.cc.people.accessExplain')}</p>

      {!scopable ? (
        <p className="mt-3 text-[12px] leading-[17px] text-slate-700">{t('settings.cc.people.accessNotScopable')}</p>
      ) : (
        <>
          <fieldset className="mt-3">
            <legend className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
              <MapPin className="w-3.5 h-3.5" aria-hidden /> {t('settings.cc.people.accessLocations')}
            </legend>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {data.canEditLocations ? t('settings.cc.people.accessLocationsHelp') : t('settings.cc.people.accessLocationsReadOnly')}
            </p>
            <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {data.locations.map((l) => {
                const checked = l.isHome || locationIds.includes(l.id);
                const id = `${panelId}-loc-${l.id}`;
                return (
                  <li key={l.id}>
                    <label htmlFor={id} className="flex items-center gap-2 min-h-[36px] px-2 rounded-[8px] border border-slate-200 bg-white text-[13px] text-slate-800">
                      <input
                        id={id}
                        type="checkbox"
                        checked={checked}
                        disabled={l.isHome || !data.canEditLocations}
                        onChange={(e) => setDraftLocations(toggle(locationIds, l.id, e.target.checked))}
                      />
                      <span className="truncate">{l.name}</span>
                      {l.isHome && (
                        <span className="ml-auto text-[11px] font-medium text-slate-500">{t('settings.cc.people.accessHome')}</span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          {reachable.map((l) => {
            const opts = data.options[l.id];
            const s = scopes[l.id] ?? { screenIds: [], screenGroupIds: [] };
            const count = s.screenIds.length + s.screenGroupIds.length;
            const summary = count === 0 ? t('settings.cc.people.accessEveryScreen') : t('settings.cc.people.accessLimitedCount', { count });
            if (!l.scopeEditable || !opts) {
              return (
                <div key={l.id} className="mt-3 text-[12px] text-slate-600">
                  <span className="font-semibold text-slate-800">{t('settings.cc.people.accessLimitTitle', { location: l.name })}</span>
                  {' · '}
                  {data.screenScopes[l.id] ? t('settings.cc.people.accessLimitedCount', {
                    count: data.screenScopes[l.id].screenIds.length + data.screenScopes[l.id].screenGroupIds.length,
                  }) : t('settings.cc.people.accessEveryScreen')}
                  <span className="block text-slate-500">{t('settings.cc.people.accessNotEditableHere')}</span>
                </div>
              );
            }
            const set = (kind: 'screenIds' | 'screenGroupIds', id: string, on: boolean) =>
              setDraftScopes(() => {
                const cur = scopes[l.id] ?? { screenIds: [], screenGroupIds: [] };
                return { ...scopes, [l.id]: { ...cur, [kind]: toggle(cur[kind], id, on) } };
              });
            return (
              <fieldset key={l.id} className="mt-3">
                <legend className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
                  <MonitorSmartphone className="w-3.5 h-3.5" aria-hidden /> {t('settings.cc.people.accessLimitTitle', { location: l.name })}
                  <span className="font-normal text-slate-500">· {summary}</span>
                </legend>
                <p className="mt-0.5 text-[12px] leading-[17px] text-slate-500">{t('settings.cc.people.accessLimitHelp')}</p>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[12px] font-medium text-slate-700">{t('settings.cc.people.accessGroups')}</p>
                    {opts.groups.length === 0 ? (
                      <p className="mt-1 text-[12px] text-slate-500">{t('settings.cc.people.accessNoGroups')}</p>
                    ) : (
                      <ul className="mt-1 max-h-48 overflow-auto rounded-[8px] border border-slate-200 bg-white">
                        {opts.groups.map((g) => {
                          const id = `${panelId}-${l.id}-grp-${g.id}`;
                          return (
                            <li key={g.id}>
                              <label htmlFor={id} className="flex items-center gap-2 min-h-[34px] px-2 text-[13px] text-slate-800">
                                <input
                                  id={id}
                                  type="checkbox"
                                  checked={s.screenGroupIds.includes(g.id)}
                                  onChange={(e) => set('screenGroupIds', g.id, e.target.checked)}
                                />
                                <span className="truncate">{g.name}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="text-[12px] font-medium text-slate-700">{t('settings.cc.people.accessScreens')}</p>
                    {opts.screens.length === 0 ? (
                      <p className="mt-1 text-[12px] text-slate-500">{t('settings.cc.people.accessNoScreens')}</p>
                    ) : (
                      <ul className="mt-1 max-h-48 overflow-auto rounded-[8px] border border-slate-200 bg-white">
                        {opts.screens.map((sc) => {
                          const id = `${panelId}-${l.id}-scr-${sc.id}`;
                          return (
                            <li key={sc.id}>
                              <label htmlFor={id} className="flex items-center gap-2 min-h-[34px] px-2 text-[13px] text-slate-800">
                                <input
                                  id={id}
                                  type="checkbox"
                                  checked={s.screenIds.includes(sc.id)}
                                  onChange={(e) => set('screenIds', sc.id, e.target.checked)}
                                />
                                <span className="truncate">{sc.name}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </fieldset>
            );
          })}
        </>
      )}

      {status && (
        <p role={status.kind === 'err' ? 'alert' : 'status'} className={`mt-3 text-[12px] ${status.kind === 'err' ? 'text-rose-700' : 'text-emerald-700'}`}>
          {status.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2 mt-3.5">
        {scopable && (
          <button
            type="submit"
            disabled={save.isPending}
            className="min-h-[42px] px-4 rounded-[10px] bg-slate-900 hover:bg-slate-800 text-white text-[13px] font-medium disabled:opacity-50"
          >
            {save.isPending ? t('settings.cc.people.accessSaving') : t('settings.cc.people.accessSave')}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="min-h-[42px] px-4 rounded-[10px] border border-slate-200 bg-white text-[13px] font-medium text-slate-600"
        >
          {t('settings.common.cancel')}
        </button>
      </div>
    </form>
  );
}
