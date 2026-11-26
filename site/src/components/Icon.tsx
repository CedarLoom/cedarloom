import type {ReactNode} from 'react';

// Line icons on a 24 by 24 grid, drawn in the text colour; each sits next to text that names its meaning.
const paths = {
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  tag: (
    <>
      <path d="M3 3h8l10 10-8 8L3 11z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  plan: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 2h6v4H9zM9 11h6M9 15h4" />
    </>
  ),
  code: <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />,
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  loop: <path d="M4 12a8 8 0 0 1 14-5.3M20 3v4h-4M20 12a8 8 0 0 1-14 5.3M4 21v-4h4" />,
  merge: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 7v10M6 7c0 4 4 5 10 5" />
    </>
  ),
  flag: <path d="M5 21V4h12l-2.5 4 2.5 4H5" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  pr: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="19" r="2" />
      <path d="M6 7v10M18 17V10a3 3 0 0 0-3-3h-4M13 4l-3 3 3 3" />
    </>
  ),
  text: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16 16l5 5" />
    </>
  ),
  bot: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4v4" />
      <circle cx="9" cy="14" r="1" />
      <circle cx="15" cy="14" r="1" />
    </>
  ),
  folder: <path d="M3 6h6l2 2h10v11H3z" />,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,
  arrow: <path d="M4 12h15M13 6l6 6-6 6" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export default function Icon({name, className}: {name: IconName; className?: string}): ReactNode {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false">
      {paths[name]}
    </svg>
  );
}
