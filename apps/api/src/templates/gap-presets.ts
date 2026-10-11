import type { SystemPreset } from './system-presets';

// New workflows identified against both the native and HTML catalog. Each
// source owns two compositions; both must be offered in the template gallery.
const WORKFLOWS = [
  {
    id: 'preset-sig-corporate-20',
    name: 'Service Update · Temporary Closure',
    description: 'Ordinary service interruptions: affected location, effective window, alternative route, reopening estimate and help contact. Every word, image, color and font is editable; status and timestamps are set by the operator.',
    category: 'INFO',
    url: '/templates/signage/corporate/20-service-update.html',
    bgColor: '#f7f4ed',
  },
  {
    id: 'preset-sig-clinic-02',
    name: 'Care Services · Services & Booking Guide',
    description: 'A public service menu with editable service names, durations, fees, price qualifiers and reception or booking instructions. Replace the practice logo and hero photo and style every text field.',
    category: 'PATIENT',
    url: '/templates/signage/clinic/02-services-booking-guide.html',
    bgColor: '#f5f0e7',
  },
  {
    id: 'preset-school-commencement-guide',
    name: 'Graduation · Ceremony Guest Guide',
    description: 'Welcome ceremony guests with doors and start times, a four-step programme, parking and accessible entrance directions, programme details and replaceable class photography. All copy, media and styling remain editable.',
    category: 'EVENTS',
    url: '/templates/school/commencement-guest-guide.html',
    bgColor: '#f5f1e9',
  },
];

export const GAP_TEMPLATE_PRESETS: SystemPreset[] = WORKFLOWS.flatMap((workflow) =>
  (['LANDSCAPE', 'PORTRAIT'] as const).map((orientation) => {
    const portrait = orientation === 'PORTRAIT';
    return {
      id: workflow.id + (portrait ? '-portrait' : ''),
      name: workflow.name + (portrait ? ' — Portrait' : ''),
      description: workflow.description,
      category: workflow.category,
      schoolLevel: 'UNIVERSAL',
      orientation,
      screenWidth: portrait ? 2160 : 3840,
      screenHeight: portrait ? 3840 : 2160,
      bgColor: workflow.bgColor,
      zones: [{
        name: 'Scene', widgetType: 'EXTERNAL_HTML',
        x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0,
        defaultConfig: { url: workflow.url + (portrait ? '?o=portrait' : '') },
      }],
    };
  }),
);
