import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  const all = await p.template.findMany({
    include: { zones: { orderBy: { sortOrder: 'asc' } } },
    orderBy: [{ isSystem: 'desc' }, { updatedAt: 'desc' }],
  });

  let totalZones = 0;
  let zonesWithTheme = 0;
  let zonesWithContent = 0;
  let zonesWithVariant = 0;
  let zonesEmpty = 0;
  const themeCounts: Record<string, number> = {};
  const widgetCounts: Record<string, number> = {};

  const sysTemplates: any[] = [];
  const tenTemplates: any[] = [];

  for (const t of all) {
    const summary = {
      id: t.id,
      name: t.name,
      isSystem: t.isSystem,
      zones: t.zones.length,
      hasBg: !!(t.bgGradient || t.bgImage || t.bgColor),
      themedZones: 0,
      contentZones: 0,
      variantZones: 0,
      emptyZones: 0,
      themes: new Set<string>(),
      widgetTypes: new Set<string>(),
      updatedAt: t.updatedAt,
    };
    for (const z of t.zones) {
      totalZones++;
      widgetCounts[z.widgetType] = (widgetCounts[z.widgetType] || 0) + 1;
      summary.widgetTypes.add(z.widgetType);
      const cfgRaw = z.defaultConfig;
      if (!cfgRaw) { zonesEmpty++; summary.emptyZones++; continue; }
      let cfg: any = {};
      try { cfg = JSON.parse(cfgRaw as any); } catch { zonesEmpty++; summary.emptyZones++; continue; }
      const hasTheme = !!cfg.theme;
      const hasVariant = !!cfg.variant;
      const hasContent = !!(cfg.content || cfg.title || cfg.message || cfg.staffName || cfg.menu || cfg.messages?.length || cfg.events?.length || cfg.label);
      if (hasTheme) { zonesWithTheme++; summary.themedZones++; summary.themes.add(cfg.theme); themeCounts[cfg.theme] = (themeCounts[cfg.theme] || 0) + 1; }
      if (hasVariant) { zonesWithVariant++; summary.variantZones++; }
      if (hasContent) { zonesWithContent++; summary.contentZones++; }
      if (!hasTheme && !hasVariant && !hasContent) { zonesEmpty++; summary.emptyZones++; }
    }
    if (t.isSystem) sysTemplates.push(summary); else tenTemplates.push(summary);
  }

  console.log('==================== AUDIT REPORT ====================');
  console.log(`\nTotal templates: ${all.length}`);
  console.log(`  System presets: ${sysTemplates.length}`);
  console.log(`  Tenant templates: ${tenTemplates.length}`);
  console.log(`\nTotal zones across all templates: ${totalZones}`);
  console.log(`  Zones with a theme: ${zonesWithTheme} (${Math.round(100 * zonesWithTheme / totalZones)}%)`);
  console.log(`  Zones with a variant: ${zonesWithVariant}`);
  console.log(`  Zones with custom content/title/message: ${zonesWithContent}`);
  console.log(`  Empty / default-only zones: ${zonesEmpty}`);

  console.log('\nThemes used (zone count per theme):');
  for (const [theme, n] of Object.entries(themeCounts).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${theme}: ${n}`);
  }

  console.log('\nWidget type distribution (top 10):');
  const widgetSorted = Object.entries(widgetCounts).sort((a,b)=>b[1]-a[1]).slice(0, 10);
  for (const [w, n] of widgetSorted) console.log(`  ${w}: ${n}`);

  console.log('\n──── SYSTEM PRESETS ────');
  for (const s of sysTemplates) {
    const themeList = s.themes.size ? Array.from(s.themes).join(',') : '(none)';
    const flag = s.themedZones === s.zones && s.zones > 0 ? '✓' : (s.themedZones === 0 && s.zones > 0 ? '✗' : '~');
    console.log(`${flag} ${s.id.padEnd(40)} | ${s.zones}z | ${s.themedZones}/${s.zones} themed | bg:${s.hasBg ? 'Y' : 'N'} | themes:${themeList} | ${s.name}`);
  }

  console.log('\n──── TENANT TEMPLATES (most recent 20) ────');
  for (const s of tenTemplates.slice(0, 20)) {
    const themeList = s.themes.size ? Array.from(s.themes).join(',') : '(none)';
    const flag = s.themedZones === s.zones && s.zones > 0 ? '✓' : (s.themedZones === 0 && s.zones > 0 ? '✗' : '~');
    console.log(`${flag} ${s.id.slice(0, 36)} | ${s.zones}z | ${s.themedZones}/${s.zones} themed | bg:${s.hasBg ? 'Y' : 'N'} | themes:${themeList} | ${s.name}`);
  }
  if (tenTemplates.length > 20) console.log(`  …and ${tenTemplates.length - 20} more tenant templates`);

  // Highlight templates that should have themes but don't
  console.log('\n──── ⚠ SYSTEM PRESETS WITH NO THEMED ZONES (rendering as defaults) ────');
  const broken = sysTemplates.filter(s => s.zones > 0 && s.themedZones === 0);
  if (broken.length === 0) console.log('  (none — all system presets have at least some themed zones)');
  for (const s of broken) console.log(`  ${s.id} | ${s.name}`);

  // Highlight system presets with PARTIAL theming
  console.log('\n──── ⚠ SYSTEM PRESETS WITH PARTIAL THEMING ────');
  const partial = sysTemplates.filter(s => s.zones > 0 && s.themedZones > 0 && s.themedZones < s.zones);
  if (partial.length === 0) console.log('  (none)');
  for (const s of partial) console.log(`  ${s.id} | ${s.themedZones}/${s.zones} themed | ${s.name}`);

  await p.$disconnect();
})();
