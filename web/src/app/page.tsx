import "./landing.css";

// Public landing page (rbola.fun). The app itself lives under the (app)
// route group — /catch, /garage, /race — and is deliberately not linked
// from here while it's pre-launch. Styling is scoped to landing.css so
// this page deploys correctly regardless of app-screen work in flight.

// Icon paths mirror src/components/BottomNav.tsx exactly — the landing
// phone is a truthful screenshot of the app, garage tab active.
const NAV_ICONS = [
  {
    label: "CAM",
    active: false,
    d: "M3 8.5A1.5 1.5 0 0 1 4.5 7h2.6l1.6-2.2h6.6L16.9 7h2.6A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5zM12 15.6a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6z",
  },
  {
    label: "GARAGE",
    active: true,
    d: "M3 20V9.5L12 3.5l9 6V20M6.5 20v-7.5h11V20M9.2 17.2h5.6",
  },
  {
    label: "RACE",
    active: false,
    d: "M5.5 21V4M5.5 5c2.1-1.3 4.3-1.3 6.5 0s4.4 1.3 6.5 0v8.6c-2.1 1.3-4.3 1.3-6.5 0s-4.4-1.3-6.5 0z",
  },
  {
    label: "ME",
    active: false,
    d: "M12 11.2a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM4.8 20c.9-3.4 3.7-5.2 7.2-5.2s6.3 1.8 7.2 5.2",
  },
];

export default function Home() {
  return (
    <main className="landing flex flex-1 flex-col items-center px-6 text-center">
      <div className="flex flex-1 flex-col items-center justify-center py-4">
        {/* the product IS the pitch: a phone showing the empty garage */}
        <div className="landing-in landing-phone" style={{ animationDelay: "140ms" }}>
          <div className="landing-phone-screen">
            <span aria-hidden className="landing-island" />

            <div className="landing-empty">
              <p className="landing-mono landing-empty-title">
                YOUR GARAGE IS EMPTY
              </p>
              <p className="landing-mono landing-empty-cta">
                CATCH YOUR FIRST CAR
              </p>
            </div>

            <div className="landing-nav" aria-hidden>
              {NAV_ICONS.map((icon) => (
                <span
                  key={icon.label}
                  className={
                    icon.active ? "landing-nav-pill" : "landing-nav-item"
                  }
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={icon.d} />
                  </svg>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
