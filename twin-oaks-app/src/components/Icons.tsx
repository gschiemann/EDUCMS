// Minimal inline icon set (24×24, stroke-based) — no icon dependency.

type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M10 21v-6h4v6" />
  </Svg>
);

export const ReceiptIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 2h12v20l-2-1.5L14 22l-2-1.5L10 22l-2-1.5L6 22Z" />
    <path d="M9 7h6M9 11h6M9 15h4" />
  </Svg>
);

export const DollarIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15 8.5c-.6-.9-1.7-1.5-3-1.5-1.8 0-3 1-3 2.4 0 3.4 6 1.6 6 4.8 0 1.4-1.3 2.3-3 2.3-1.4 0-2.6-.6-3.2-1.6" />
    <path d="M12 5.5v13" />
  </Svg>
);

export const GridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const WrenchIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.7 6.3a4.5 4.5 0 0 0-6 5.6L3 17.6V21h3.4l5.7-5.7a4.5 4.5 0 0 0 5.6-6L14.5 12l-2.5-2.5Z" />
  </Svg>
);

export const CameraIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8h3l2-3h6l2 3h3v12H4Z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);

export const TractorIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="16" r="4" />
    <circle cx="18" cy="17" r="2.5" />
    <path d="M11 16h4.5M5 12V6h6l2 6M13 6h3v4" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
