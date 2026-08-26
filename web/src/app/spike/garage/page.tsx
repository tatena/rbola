"use client";

import { useEffect, useState } from "react";

type Card = {
  assetId: string;
  name: string;
  photo: string | null;
  time: string | null;
};

export default function GaragePage() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/garage")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setCards(j.cards);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main className="flex flex-1 flex-col gap-4 bg-[#16181c] p-4 text-neutral-200">
      <h1 className="text-lg font-bold tracking-widest text-[#f0a500]">
        GARAGE
      </h1>

      {error && (
        <p className="rounded bg-red-950 p-2 text-sm text-red-300">{error}</p>
      )}
      {!cards && !error && <p className="text-neutral-500">loading…</p>}
      {cards && cards.length === 0 && (
        <p className="text-neutral-500">
          empty —{" "}
          <a href="/spike/catch" className="text-[#f0a500] underline">
            go catch something
          </a>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {cards?.map((c) => (
          <div
            key={c.assetId}
            className="flex flex-col overflow-hidden rounded-lg border border-neutral-700"
          >
            {c.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={c.photo}
                alt={c.name}
                className="aspect-square w-full object-cover"
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center bg-neutral-800 text-3xl">
                🏎
              </div>
            )}
            <div className="flex flex-col gap-1 p-2">
              <p className="text-sm font-bold">{c.name}</p>
              <p className="truncate text-xs text-neutral-600">{c.assetId}</p>
            </div>
          </div>
        ))}
      </div>

      <a
        href="/spike/catch"
        className="mt-auto rounded-lg bg-[#f0a500] p-3 text-center font-bold text-black"
      >
        CATCH ANOTHER
      </a>
    </main>
  );
}
