"use client";

import { useEffect, useRef, useState } from "react";

type Phase = "camera" | "review" | "minting" | "caught" | "error";

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
    <main className="flex flex-1 flex-col gap-4 bg-[#16181c] p-4 text-neutral-200">
      <h1 className="text-lg font-bold tracking-widest text-[#f0a500]">CATCH</h1>

      {(phase === "camera" || !photo) && (
        <section className="flex flex-col gap-2">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="min-h-24 w-full rounded-lg bg-black"
          />
          {!cameraOn ? (
            <button
              onClick={startCamera}
              className="rounded-lg bg-[#f0a500] p-3 font-bold text-black"
            >
              Start camera
            </button>
          ) : (
            <button
              onClick={snap}
              className="rounded-lg bg-[#f0a500] p-4 text-lg font-bold text-black"
            >
              SNAP
            </button>
          )}
        </section>
      )}

      {phase === "review" && photo && (
        <section className="flex flex-col gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="your catch" className="w-full rounded-lg" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="what car is this? (e.g. Toyota GR86)"
            className="rounded-lg border border-neutral-600 bg-transparent p-3"
          />
          <p className="text-xs text-neutral-500">
            {gps
              ? `GPS: ${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}`
              : "no GPS fix (that's ok for now)"}
          </p>
          <button
            onClick={catchIt}
            disabled={!name.trim()}
            className="rounded-lg bg-[#f0a500] p-4 text-lg font-bold text-black disabled:opacity-40"
          >
            CATCH IT
          </button>
          <button
            onClick={() => {
              setPhoto(null);
              setPhase("camera");
            }}
            className="p-2 text-sm text-neutral-500"
          >
            retake
          </button>
        </section>
      )}

      {phase === "minting" && (
        <p className="animate-pulse text-center text-lg text-neutral-400">
          minting your card on Solana…
        </p>
      )}

      {phase === "caught" && (
        <section className="flex flex-col items-center gap-3 text-center">
          <p className="text-6xl font-black tracking-widest text-[#f0a500]">
            RBOLA!
          </p>
          <p className="text-xl text-neutral-300">რბოლა</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo && (
            <img src={photo} alt="caught" className="w-2/3 rounded-lg" />
          )}
          <p className="text-sm text-neutral-400">
            <b>{name}</b> is yours — on-chain.
          </p>
          <p className="break-all text-xs text-neutral-600">asset: {assetId}</p>
          <a href="/spike/garage" className="text-[#f0a500] underline">
            open garage →
          </a>
          <button
            onClick={() => {
              setPhoto(null);
              setName("");
              setAssetId(null);
              setPhase("camera");
            }}
            className="p-2 text-sm text-neutral-500"
          >
            catch another
          </button>
        </section>
      )}

      {error && (
        <p className="rounded bg-red-950 p-2 text-sm text-red-300">{error}</p>
      )}
    </main>
  );
}
