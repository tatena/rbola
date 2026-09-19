"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";

// Line icons per nav spec: single path, 24×24 viewBox rendered at 19×19,
// stroke-only, round caps/joins.
const tabs: { label: string; href: string; d: string }[] = [
  {
    label: "CAM",
    href: "/catch",
    d: "M3 8.5A1.5 1.5 0 0 1 4.5 7h2.6l1.6-2.2h6.6L16.9 7h2.6A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5zM12 15.6a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6z",
  },
  {
    label: "GARAGE",
    href: "/garage",
    d: "M3 20V9.5L12 3.5l9 6V20M6.5 20v-7.5h11V20M9.2 17.2h5.6",
  },
  {
    label: "RACE",
    href: "/race",
    d: "M5.5 21V4M5.5 5c2.1-1.3 4.3-1.3 6.5 0s4.4 1.3 6.5 0v8.6c-2.1 1.3-4.3 1.3-6.5 0s-4.4-1.3-6.5 0z",
  },
  {
    label: "ME",
    href: "/me",
    d: "M12 11.2a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM4.8 20c.9-3.4 3.7-5.2 7.2-5.2s6.3 1.8 7.2 5.2",
  },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[430px]"
      style={{
        padding: "12px 14px max(env(safe-area-inset-bottom), 16px)",
        background: "#0A0A0F",
        borderTop: ".5px solid rgba(233,231,226,.09)",
      }}
    >
      <div className="flex items-center justify-around">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          // fixed-size pills, icon only — nothing moves on tab change
          const pillStyle: CSSProperties = {
            background: active ? "rgba(201,179,126,.09)" : "transparent",
            border: `.5px solid ${active ? "rgba(201,179,126,.35)" : "transparent"}`,
            transition: "background .2s ease, border-color .2s ease",
          };

          return (
            <Link
              key={tab.label}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              aria-label={tab.label}
              className="flex h-10 w-[58px] items-center justify-center rounded-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              style={pillStyle}
            >
              <span
                className="flex h-5 w-5 flex-none items-center justify-center"
                style={{
                  color: active ? "#C9B37E" : "rgba(242,241,238,.36)",
                }}
                aria-hidden
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={tab.d} />
                </svg>
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
