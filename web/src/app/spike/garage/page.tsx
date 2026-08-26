"use client";

import { useEffect, useState } from "react";

type Card = {
  assetId: string;
  name: string;
  photo: string | null;
  time: string | null;
};

const primaryBtn =
  "rounded-lg bg-accent p-3 text-center font-bold tracking-wide text-black transition-[transform,filter] duration-100 ease-out hover:brightness-110 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function GaragePage() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetch("/api/garage")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setCards(j.cards);
      })
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold tracking-[0.2em] text-accent">
          GARAGE
        </h1>
        <a
          href="/"
          className="p-2 text-sm text-neutral-400 transition-colors duration-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          home
        </a>
      </header>

      {error && (
        <div className="flex flex-col gap-2">
          <p className="rounded-lg border border-red-900 bg-red-950/60 p-3 text-sm text-red-300">
            Couldn&apos;t load your garage — {error}
          </p>
          <button onClick={load} className={primaryBtn}>
            Retry
          </button>
        </div>
      )}

      {!cards && !error && (
        <div className="grid grid-cols-2 gap-3" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse overflow-hidden rounded-xl border border-line"
            >
              <div className="aspect-square w-full bg-surface-raised" />
              <div className="flex flex-col gap-2 p-3">
                <div className="h-3 w-3/4 rounded bg-surface-raised" />
                <div className="h-2 w-1/2 rounded bg-surface-raised" />
              </div>
            </div>
          ))}
        </div>
      )}

      {cards && cards.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-neutral-400">Your garage is empty.</p>
          <a href="/spike/catch" className={primaryBtn}>
            Catch your first car
          </a>
        </div>
      )}

      {cards && cards.length > 0 && (
        <>
          <p className="text-xs uppercase tracking-widest text-neutral-500">
            {cards.length} {cards.length === 1 ? "card" : "cards"}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {cards.map((c) => (
              <div
                key={c.assetId}
                className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface-raised"
              >
                {c.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.photo}
                    alt={c.name}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div
                    className="flex aspect-square w-full items-center justify-center bg-background text-3xl"
                    aria-hidden
                  >
                    🏎
                  </div>
                )}
                <div className="flex flex-col gap-1 p-3">
                  <p className="text-sm font-bold leading-tight">{c.name}</p>
                  <p
                    className="truncate font-mono text-[10px] text-neutral-500"
                    title={c.assetId}
                  >
                    {c.assetId.slice(0, 4)}…{c.assetId.slice(-4)}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <a href="/spike/catch" className={`${primaryBtn} mt-auto`}>
            Catch another
          </a>
        </>
      )}
    </main>
  );
}
