"use client";

import { useEffect, useRef, useState } from "react";

type Phase = "camera" | "review" | "minting" | "caught" | "error";

const primaryBtn =
  "rounded-lg bg-accent p-4 text-lg font-bold tracking-wide text-black transition-[transform,filter] duration-100 ease-out hover:brightness-110 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40";
const quietBtn =
  "rounded-lg p-3 text-sm text-neutral-400 transition-colors duration-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function CatchPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<Phase>("camera");
  const [cameraOn, setCameraOn] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [gps, setGps] = useState<{ lat: number; lon: number } | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 4096 },
          height: { ideal: 2160 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      video.play().catch(() => {});
      setCameraOn(true);
      // grab GPS in parallel while she frames the shot
      navigator.geolocation.getCurrentPosition(
        (p) => setGps({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, timeout: 15000 },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function snap() {
    const video = videoRef.current!;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    setPhoto(canvas.toDataURL("image/jpeg", 0.9));
    setPhase("review");
  }

  async function catchIt() {
    if (!photo || !name.trim()) return;
    setPhase("minting");
    setError(null);
    try {
      const res = await fetch("/api/catch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photo,
          name: name.trim(),
          lat: gps?.lat,
          lon: gps?.lon,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setAssetId(json.assetId);
      setPhase("caught");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold tracking-[0.2em] text-accent">
          CATCH
        </h1>
        <a
          href="/spike/garage"
          className="p-2 text-sm text-neutral-400 transition-colors duration-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          garage →
        </a>
      </header>

      {(phase === "camera" || !photo) && (
        <section className="flex flex-col gap-3">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="aspect-[3/4] w-full rounded-xl bg-black object-cover"
          />
          {!cameraOn ? (
            <button onClick={startCamera} className={primaryBtn}>
              Start camera
            </button>
          ) : (
            <button onClick={snap} className={primaryBtn}>
              SNAP
            </button>
          )}
        </section>
      )}

      {phase === "review" && photo && (
        <section className="flex flex-col gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo}
            alt="your catch"
            className="aspect-[3/4] w-full rounded-xl object-cover"
          />
          <div className="flex flex-col gap-1">
            <label
              htmlFor="car-name"
              className="text-xs uppercase tracking-widest text-neutral-400"
            >
              What did you catch?
            </label>
            <input
              id="car-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Toyota GR86"
              autoComplete="off"
              enterKeyHint="go"
              className="rounded-lg border border-line bg-surface-raised p-3 text-foreground placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <p className="text-xs text-neutral-500">
              {gps
                ? `GPS ${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}`
                : "No GPS fix — fine for now"}
            </p>
          </div>
          <button
            onClick={catchIt}
            disabled={!name.trim()}
            className={primaryBtn}
          >
            CATCH IT
          </button>
          <button
            onClick={() => {
              setPhoto(null);
              setPhase("camera");
            }}
            className={quietBtn}
          >
            Retake
          </button>
        </section>
      )}

      {phase === "minting" && (
        <section className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="animate-pulse text-lg text-neutral-300">
            Minting your card on Solana…
          </p>
          <p className="text-xs text-neutral-500">usually a few seconds</p>
        </section>
      )}

      {phase === "caught" && (
        <section className="flex flex-col items-center gap-3 text-center">
          <div className="stamp-in">
            <p className="text-6xl font-black tracking-[0.15em] text-accent">
              RBOLA!
            </p>
            <p className="mt-1 text-xl tracking-[0.3em] text-neutral-400">
              რბოლა
            </p>
          </div>
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt={`your catch: ${name}`}
              className="w-2/3 rounded-xl border border-line"
            />
          )}
          <p className="text-neutral-300">
            <b className="text-foreground">{name}</b> is yours — on-chain.
          </p>
          <p className="max-w-full truncate font-mono text-xs text-neutral-500">
            {assetId}
          </p>
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <a href="/spike/garage" className={primaryBtn}>
              Open garage
            </a>
            <button
              onClick={() => {
                setPhoto(null);
                setName("");
                setAssetId(null);
                setPhase("camera");
              }}
              className={quietBtn}
            >
              Catch another
            </button>
          </div>
        </section>
      )}

      {phase === "error" && (
        <section className="flex flex-col gap-3">
          <p className="rounded-lg border border-red-900 bg-red-950/60 p-3 text-sm text-red-300">
            The mint failed — {error}. Your photo is still here.
          </p>
          <button onClick={catchIt} className={primaryBtn}>
            Try again
          </button>
          <button
            onClick={() => {
              setPhoto(null);
              setPhase("camera");
            }}
            className={quietBtn}
          >
            Start over
          </button>
        </section>
      )}

      {error && phase !== "error" && (
        <p className="rounded-lg border border-red-900 bg-red-950/60 p-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </main>
  );
}
