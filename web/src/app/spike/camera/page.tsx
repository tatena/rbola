"use client";

import { useEffect, useRef, useState } from "react";

type Shot = {
  source: "stream" | "native";
  url: string;
  width: number;
  height: number;
  kb: number;
};

type Fix = {
  lat: number;
  lon: number;
  accuracyM: number;
  time: string;
};

export default function CameraSpike() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [streamRes, setStreamRes] = useState<string | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [ua, setUa] = useState("");

  useEffect(() => {
    setUa(navigator.userAgent);
    setStandalone(window.matchMedia("(display-mode: standalone)").matches);
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startCamera() {
    setCameraError(null);
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
      await video.play();
      const s = stream.getVideoTracks()[0].getSettings();
      setStreamRes(`${s.width}×${s.height}`);
      setCameraOn(true);
    } catch (e) {
      setCameraError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        if (shot?.url) URL.revokeObjectURL(shot.url);
        setShot({
          source: "stream",
          url: URL.createObjectURL(blob),
          width: canvas.width,
          height: canvas.height,
          kb: Math.round(blob.size / 1024),
        });
      },
      "image/jpeg",
      0.92,
    );
  }

  function onNativeFile(file: File | undefined) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (shot?.url) URL.revokeObjectURL(shot.url);
      setShot({
        source: "native",
        url,
        width: img.naturalWidth,
        height: img.naturalHeight,
        kb: Math.round(file.size / 1024),
      });
    };
    img.src = url;
  }

  function getFix() {
    setGpsError(null);
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false);
        setFix({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy),
          time: new Date(pos.timestamp).toLocaleTimeString(),
        });
      },
      (err) => {
        setGpsBusy(false);
        setGpsError(`${err.code}: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-4 bg-[#16181c] p-4 text-neutral-200">
      <h1 className="text-lg font-bold tracking-widest text-[#f0a500]">
        CAMERA SPIKE
      </h1>

      <section className="flex flex-col gap-2">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full rounded-lg bg-black ${cameraOn ? "" : "hidden"}`}
        />
        {streamRes && (
          <p className="text-sm">
            stream resolution: <b>{streamRes}</b>
          </p>
        )}
        {cameraError && (
          <p className="rounded bg-red-950 p-2 text-sm text-red-300">
            camera error — {cameraError}
          </p>
        )}
        <div className="flex gap-2">
          {!cameraOn ? (
            <button
              onClick={startCamera}
              className="flex-1 rounded-lg bg-[#f0a500] p-3 font-bold text-black"
            >
              Start camera
            </button>
          ) : (
            <button
              onClick={capture}
              className="flex-1 rounded-lg bg-[#f0a500] p-3 font-bold text-black"
            >
              Capture frame
            </button>
          )}
          <label className="flex-1 rounded-lg border border-neutral-600 p-3 text-center">
            Native camera
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onNativeFile(e.target.files?.[0])}
            />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <button
          onClick={getFix}
          disabled={gpsBusy}
          className="rounded-lg border border-neutral-600 p-3 disabled:opacity-50"
        >
          {gpsBusy ? "Getting GPS fix…" : "Get GPS fix"}
        </button>
        {fix && (
          <p className="text-sm">
            {fix.lat.toFixed(5)}, {fix.lon.toFixed(5)} — accuracy{" "}
            <b>{fix.accuracyM} m</b> at {fix.time}
          </p>
        )}
        {gpsError && (
          <p className="rounded bg-red-950 p-2 text-sm text-red-300">
            GPS error — {gpsError}
          </p>
        )}
      </section>

      {shot && (
        <section className="flex flex-col gap-2">
          <p className="text-sm">
            captured via <b>{shot.source}</b>:{" "}
            <b>
              {shot.width}×{shot.height}
            </b>{" "}
            ({shot.kb} KB ≈ {((shot.width * shot.height) / 1e6).toFixed(1)} MP)
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot.url} alt="captured" className="w-full rounded-lg" />
        </section>
      )}

      <footer className="mt-auto text-xs text-neutral-500">
        <p>standalone mode: {standalone ? "yes" : "no"}</p>
        <p className="break-all">{ua}</p>
      </footer>
    </main>
  );
}
