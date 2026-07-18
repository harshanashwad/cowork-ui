// Hand-written inline icons — the whole set the UI needs is five simple
// shapes, not worth pulling in an icon library dependency for.

type IconProps = { className?: string };

export function SidebarToggleIcon({ className }: IconProps) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <line x1="7" y1="3" x2="7" y2="15" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none">
      <line x1="7" y1="1.5" x2="7" y2="12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="1.5" y1="7" x2="12.5" y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronRightIcon({ className, expanded }: IconProps & { expanded: boolean }) {
  return (
    <svg
      className={`${className ?? ""} transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
    >
      <path d="M4 2.5L8 6L4 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PaperclipIcon({ className }: IconProps) {
  return (
    <svg className={className} width="17" height="17" viewBox="0 0 17 17" fill="none">
      <path
        d="M11.5 5.5L6 11a2.1 2.1 0 1 0 3 3l5.3-5.3a3.5 3.5 0 1 0-5-5L4 8.9a4.9 4.9 0 0 0 7 7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SendIcon({ className }: IconProps) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M7.5 12.5V2.5M7.5 2.5L3 7M7.5 2.5L12 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FileIcon({ className }: IconProps) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path
        d="M4 1.5h4.5L11.5 4.5V13a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8.5 1.5V4.5H11.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <svg className={className} width="11" height="11" viewBox="0 0 11 11" fill="none">
      <line x1="1.5" y1="1.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="9.5" y1="1.5" x2="1.5" y2="9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
