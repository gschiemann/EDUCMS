import type { SystemPreset } from './system-presets';

// Three owner-approved compositions, with intentional content for each business.
// Separate static URLs keep gallery posters accurate without customized live iframes.
const DESIGNS = [
  {
    "business": "hospitality",
    "vertical": "HOSPITALITY",
    "group": "Hospitality",
    "name": "Guest Essentials · The Guest Edit",
    "category": "INFO",
    "bgColor": "#f3efe5",
    "id": "preset-essentials-hospitality-the-guest-edit",
    "url": "/templates/signage/essentials/hospitality/the-guest-edit.html"
  },
  {
    "business": "hospitality",
    "vertical": "HOSPITALITY",
    "group": "Hospitality",
    "name": "Guest Essentials · Easy Days",
    "category": "INFO",
    "bgColor": "#f8f0df",
    "id": "preset-essentials-hospitality-easy-days",
    "url": "/templates/signage/essentials/hospitality/easy-days.html"
  },
  {
    "business": "hospitality",
    "vertical": "HOSPITALITY",
    "group": "Hospitality",
    "name": "Guest Essentials · City Guide",
    "category": "INFO",
    "bgColor": "#1e2928",
    "id": "preset-essentials-hospitality-city-guide",
    "url": "/templates/signage/essentials/hospitality/city-guide.html"
  },
  {
    "business": "corporate",
    "vertical": "CORPORATE",
    "group": "Corporate",
    "name": "Visitor Essentials · The Guest Edit",
    "category": "INFO",
    "bgColor": "#f3efe5",
    "id": "preset-essentials-corporate-the-guest-edit",
    "url": "/templates/signage/essentials/corporate/the-guest-edit.html"
  },
  {
    "business": "corporate",
    "vertical": "CORPORATE",
    "group": "Corporate",
    "name": "Visitor Essentials · Easy Days",
    "category": "INFO",
    "bgColor": "#f8f0df",
    "id": "preset-essentials-corporate-easy-days",
    "url": "/templates/signage/essentials/corporate/easy-days.html"
  },
  {
    "business": "corporate",
    "vertical": "CORPORATE",
    "group": "Corporate",
    "name": "Visitor Essentials · City Guide",
    "category": "INFO",
    "bgColor": "#1e2928",
    "id": "preset-essentials-corporate-city-guide",
    "url": "/templates/signage/essentials/corporate/city-guide.html"
  },
  {
    "business": "gym",
    "vertical": "GYM",
    "group": "Gym",
    "name": "First Visit · The Guest Edit",
    "category": "FITNESS",
    "bgColor": "#f3efe5",
    "id": "preset-essentials-gym-the-guest-edit",
    "url": "/templates/signage/essentials/gym/the-guest-edit.html"
  },
  {
    "business": "gym",
    "vertical": "GYM",
    "group": "Gym",
    "name": "First Visit · Easy Days",
    "category": "FITNESS",
    "bgColor": "#f8f0df",
    "id": "preset-essentials-gym-easy-days",
    "url": "/templates/signage/essentials/gym/easy-days.html"
  },
  {
    "business": "gym",
    "vertical": "GYM",
    "group": "Gym",
    "name": "First Visit · City Guide",
    "category": "FITNESS",
    "bgColor": "#1e2928",
    "id": "preset-essentials-gym-city-guide",
    "url": "/templates/signage/essentials/gym/city-guide.html"
  },
  {
    "business": "healthcare",
    "vertical": "HEALTHCARE",
    "group": "Healthcare",
    "name": "Arrival Guide · The Guest Edit",
    "category": "PATIENT",
    "bgColor": "#f3efe5",
    "id": "preset-essentials-healthcare-the-guest-edit",
    "url": "/templates/signage/essentials/healthcare/the-guest-edit.html"
  },
  {
    "business": "healthcare",
    "vertical": "HEALTHCARE",
    "group": "Healthcare",
    "name": "Arrival Guide · Easy Days",
    "category": "PATIENT",
    "bgColor": "#f8f0df",
    "id": "preset-essentials-healthcare-easy-days",
    "url": "/templates/signage/essentials/healthcare/easy-days.html"
  },
  {
    "business": "healthcare",
    "vertical": "HEALTHCARE",
    "group": "Healthcare",
    "name": "Arrival Guide · City Guide",
    "category": "PATIENT",
    "bgColor": "#1e2928",
    "id": "preset-essentials-healthcare-city-guide",
    "url": "/templates/signage/essentials/healthcare/city-guide.html"
  }
] as const;

export const ESSENTIALS_TEMPLATE_PRESETS: SystemPreset[] = DESIGNS.flatMap((design) =>
  (['LANDSCAPE', 'PORTRAIT'] as const).map((orientation) => {
    const portrait = orientation === 'PORTRAIT';
    return {
      id: design.id + (portrait ? '-portrait' : ''),
      name: design.name + (portrait ? ' — Portrait' : ''),
      description: 'An editable '+design.group.toLowerCase()+' arrival guide. Replace every word, logo and photo, choose fonts and colors, or add a slow photo carousel. Sample times and directions are supplied by the operator.',
      category: design.category, schoolLevel: 'UNIVERSAL', orientation,
      screenWidth: portrait ? 2160 : 3840, screenHeight: portrait ? 3840 : 2160,
      bgColor: design.bgColor,
      zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0,
        width: 100, height: 100, zIndex: 1, sortOrder: 0,
        defaultConfig: { url: design.url + (portrait ? '?o=portrait' : '') },
      }],
    };
  }),
);

export const ESSENTIALS_PRESET_VERTICALS = new Map(
  DESIGNS.flatMap(design => [
    [design.id, design.vertical], [design.id + '-portrait', design.vertical],
  ] as [string, string][]),
);
