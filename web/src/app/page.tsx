export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#16181c] text-center">
      <h1 className="text-5xl font-bold tracking-widest text-[#f0a500]">
        RBOLA
      </h1>
      <p className="text-2xl tracking-wide text-neutral-400">რბოლა</p>
      <p className="mt-6 text-sm uppercase tracking-widest text-neutral-600">
        early development
      </p>
      <a
        href="/spike/catch"
        className="mt-10 rounded-lg bg-[#f0a500] px-6 py-3 text-sm font-bold tracking-widest text-black"
      >
        CATCH →
      </a>
      <a
        href="/spike/garage"
        className="mt-2 rounded-lg border border-neutral-700 px-6 py-3 text-sm tracking-widest text-neutral-400"
      >
        garage →
      </a>
      <a
        href="/spike/camera"
        className="mt-2 rounded-lg border border-neutral-700 px-6 py-3 text-sm tracking-widest text-neutral-400"
      >
        camera spike →
      </a>
      <a
        href="/spike/wallet"
        className="mt-2 rounded-lg border border-neutral-700 px-6 py-3 text-sm tracking-widest text-neutral-400"
      >
        wallet spike →
      </a>
    </main>
  );
}
