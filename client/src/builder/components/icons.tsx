// Lightweight inline SVG icon set (lucide-style, 24x24, stroke=currentColor).
// No dependency, no raw-HTML injection. Replaces emoji used as UI icons so they
// render consistently across OSes and announce correctly to assistive tech.
// Decorative by default (aria-hidden); pass a title for a labelled icon, or rely
// on the parent button's aria-label.
import type { SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Pixel size for width & height. Default 20. */
  size?: number;
  title?: string;
}

function Svg({ size = 20, title, children, ...rest }: IconProps & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const XIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const ArrowLeftIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="m12 19-7-7 7-7M19 12H5" />
  </Svg>
);

export const PlusIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M5 12h14M12 5v14" />
  </Svg>
);

export const TrashIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
  </Svg>
);

export const CameraIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
    <circle cx="12" cy="13" r="3" />
  </Svg>
);

export const FileIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </Svg>
);

export const CheckIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const RefreshIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v5h-5" />
  </Svg>
);

export const CopyIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
);

export const ExternalLinkIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M15 3h6v6M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const GripIcon = (p: IconProps): JSX.Element => (
  <Svg {...p} strokeWidth={0}>
    <circle cx="9" cy="6" r="1.6" fill="currentColor" />
    <circle cx="9" cy="12" r="1.6" fill="currentColor" />
    <circle cx="9" cy="18" r="1.6" fill="currentColor" />
    <circle cx="15" cy="6" r="1.6" fill="currentColor" />
    <circle cx="15" cy="12" r="1.6" fill="currentColor" />
    <circle cx="15" cy="18" r="1.6" fill="currentColor" />
  </Svg>
);

export const LogoutIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </Svg>
);
