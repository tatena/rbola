import "./landing.css";

// Public landing page (rbola.fun). The app itself lives under the (app)
// route group — /catch, /garage, /race — and is deliberately not linked
// from here while it's pre-launch. Styling is scoped to landing.css so
// this page deploys correctly regardless of app-screen work in flight.
export default function Home() {
  return (
    <main className="landing flex flex-1 flex-col items-center px-6 text-center">
      <div className="flex flex-1 flex-col items-center justify-center gap-12">
        <header className="landing-in flex flex-col items-center gap-5">
          <h1 className="landing-wordmark">RBOLA</h1>
          <p lang="ka" className="landing-mono landing-georgian">
            რბოლა
          </p>
        </header>

        <p className="landing-in landing-hook" style={{ animationDelay: "120ms" }}>
          Photograph real cars in the street. Own them as cards. Race them.
        </p>

        <ul
          className="landing-in landing-mono landing-beats flex items-center gap-5"
          style={{ animationDelay: "240ms" }}
        >
          <li>SPOT</li>
          <li aria-hidden className="landing-hairline" />
          <li>OWN</li>
          <li aria-hidden className="landing-hairline" />
          <li>RACE</li>
        </ul>
      </div>

      <footer
        className="landing-in landing-mono landing-footer flex items-center gap-3 pb-12"
        style={{ animationDelay: "360ms" }}
      >
        <span aria-hidden className="landing-dot" />
        <span>TBILISI FOUNDING SEASON — SOON</span>
      </footer>
    </main>
  );
}
