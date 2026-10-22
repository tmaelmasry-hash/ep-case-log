// Simple stroke icons drawn for this app (24×24 grid).
const PATHS: Record<string, string> = {
  cases: 'M8 3h8v3H8zM6 5H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1M8 11h8M8 15h6',
  patients: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.4 3.5 5.2',
  stats: 'M4 20V12M10 20V8M16 20V4M2 20h20',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20.5a2 2 0 0 0 4 0',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  filter: 'M4 6h16M7 12h10M10 18h4',
  inbox: 'M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  doc: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h8M8 12h8M8 15h5',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5a1 1 0 1 0 0-.1',
  rotateL: 'M4 4v5h5M4.6 9A8 8 0 1 1 4 13',
  rotateR: 'M20 4v5h-5M19.4 9A8 8 0 1 0 20 13',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  refresh: 'M20 11a8 8 0 0 0-14.8-4M4 4v4h4M4 13a8 8 0 0 0 14.8 4M20 20v-4h-4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  cloud: 'M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 9z',
  check: 'M5 12.5l4.5 4.5L19 7',
  alert: 'M12 4l9 16H3zM12 10v4M12 17.5v.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.01',
  user: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c.8-4 4-6 8-6s7.2 2 8 6',
  clip: 'M9 3h6v3H9zM7 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1M9 12h6M9 16h4',
  ecg: 'M2 12h4l2-4 3 8 2-6 1.5 2H22',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3',
  pill: 'M10.5 4.5a5 5 0 0 1 7 7l-6 6a5 5 0 0 1-7-7zM8 8l7 7',
  echo: 'M4 5h16v14H4zM8 15c1-4 3-6 4-6s3 2 4 6',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  // Procedure icons
  wave: 'M3 5h18v14H3zM5 12h3l1.5-3 2 6 2-8 1.5 5H19',
  bolt: 'M12 20s-7-4.4-8.5-9A4.5 4.5 0 0 1 12 6.5 4.5 4.5 0 0 1 20.5 11C19 15.6 12 20 12 20zM12.5 9l-2 3.5h3L11.5 16',
  spike: 'M2 12h5l2-6 3 12 2-9 1.5 3H22',
  heart: 'M12 20s-7-4.4-8.5-9A4.5 4.5 0 0 1 12 6.5 4.5 4.5 0 0 1 20.5 11C19 15.6 12 20 12 20zM12 10v5',
  heartDown: 'M12 20s-7-4.4-8.5-9A4.5 4.5 0 0 1 12 6.5 4.5 4.5 0 0 1 20.5 11C19 15.6 12 20 12 20zM12 9v5M9.5 11.5L12 14l2.5-2.5',
  bars: 'M4 9v6M7 6v12M10 9v6M13 4v16M16 8v8M19 11v2',
  chip: 'M7 7h10v10H7zM10 10h4v4h-4zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  extract: 'M4 5h16v4H4zM6 9v10h12V9M12 17v-6M9.5 13.5L12 11l2.5 2.5',
  clipboard: 'M9 3h6v3H9zM7 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1M12 16s-3-1.8-3-3.7a1.6 1.6 0 0 1 3-.8 1.6 1.6 0 0 1 3 .8c0 1.9-3 3.7-3 3.7z',
  nodes: 'M6 7a2 2 0 1 0 0-.01M18 7a2 2 0 1 0 0-.01M12 18a2 2 0 1 0 0-.01M8 7h8M7 9l4 7M17 9l-4 7',
};

export function Icon({ name, size = 20, className, title }: { name: string; size?: number; className?: string; title?: string }) {
  const d = PATHS[name] ?? PATHS.info;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}
