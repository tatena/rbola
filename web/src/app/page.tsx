const primaryBtn =
  "rounded-lg bg-accent px-6 py-3 text-center font-bold tracking-widest text-black transition-[transform,filter] duration-100 ease-out hover:brightness-110 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const secondaryBtn =
  "rounded-lg border border-line px-6 py-3 text-center text-sm tracking-widest text-neutral-300 transition-colors duration-100 ease-out hover:border-neutral-500 hover:text-foreground active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-6xl font-black tracking-[0.2em] text-accent">
        RBOLA
      </h1>
      <p className="text-2xl tracking-[0.3em] text-neutral-400">რბოლა</p>
      <p className="mt-4 text-xs uppercase tracking-[0.25em] text-neutral-500">
        The street is the racetrack
      </p>

      <nav className="mt-12 flex w-full max-w-xs flex-col gap-3">
        <a href="/spike/catch" className={primaryBtn}>
          CATCH
        </a>
        <a href="/spike/garage" className={secondaryBtn}>
          Garage
        </a>
        <div className="mt-4 flex gap-3">
          <a href="/spike/camera" className={`${secondaryBtn} flex-1 text-xs`}>
            camera spike
          </a>
          <a href="/spike/wallet" className={`${secondaryBtn} flex-1 text-xs`}>
            wallet spike
          </a>
        </div>
      </nav>
    </main>
  );
}
