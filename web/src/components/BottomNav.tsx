"use client";

import { usePathname } from "next/navigation";

const tabs = [
  {
    href: "/catch",
    label: "CATCH",
    icon: (
      // camera
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6" aria-hidden>
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    ),
  },
  {
    href: "/garage",
    label: "GARAGE",
    icon: (
      // car
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6" aria-hidden>
        <path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11" />
        <path d="M3 11h18a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1" />
        <path d="M3 11a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1" />
        <circle cx="7" cy="17" r="2" />
        <circle cx="17" cy="17" r="2" />
        <path d="M9 17h6" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto flex max-w-md">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <a
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-[10px] font-bold tracking-[0.2em] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                active ? "text-accent" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {tab.icon}
              {tab.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
