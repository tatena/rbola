"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startMint, warmGarageCache } from "@/lib/mintStore";

type Phase = "camera" | "mint";
type MintState = "idle" | "added";
type Facing = "environment" | "user";

const glassBtn =
  "flex h-[46px] w-[46px] items-center justify-center rounded-full bg-[rgba(10,10,15,.5)] hover:bg-[rgba(20,20,26,.7)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60";
const glassBtnStyle = {
  border: ".5px solid rgba(233,231,226,.22)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
} as const;

const hairline = ".5px solid rgba(233,231,226,.09)";

// CARD FRAME guide — sides proportional to the 402px reference canvas;
// bottom anchored above the capture controls (hint line at 196px + clearance)
// so the frame never overlays the shutter on short viewports
const FRAME = { side: 14 / 402, top: 0.12, bottomPx: 220 };
const bracket = "1px solid rgba(233,231,226,.7)";

type Rect = { x: number; y: number; width: number; height: number };

function formatCaught(d: Date) {
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

export default function CatchPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const facingRef = useRef<Facing>("environment");
  const startIdRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("camera");
  const [camError, setCamError] = useState<string | null>(null);
  const [camRotation, setCamRotation] = useState(0);
  const [flashOn, setFlashOn] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [caughtAt, setCaughtAt] = useState<Date | null>(null);
  const [name, setName] = useState("");
  const [gps, setGps] = useState<{ lat: number; lon: number } | null>(null);
  const [assessed, setAssessed] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
  const [mintState, setMintState] = useState<MintState>("idle");

  // card-frame crop: rect in photo pixels + user's vertical reframe
  const [cropRect, setCropRect] = useState<Rect | null>(null);
  const [photoDims, setPhotoDims] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [viewTop, setViewTop] = useState<number | null>(null); // photo px
  const [boxSize, setBoxSize] = useState<{ w: number; h: number } | null>(null);
  const photoBoxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ y: number; viewTop: number } | null>(null);

  const startCamera = useCallback(async (facing: Facing) => {
    const myId = ++startIdRef.current;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamError(null);
    setFlashOn(false);
    // full res on the rear camera (the catch shot); modest on the front —
    // asking the selfie cam for 4K can crash mobile Safari's camera pipeline.
    // 4:3, not 16:9 — sensors are natively 4:3, and a 16:9 request crops the
    // frame (lost field of view reads as "zoomed in")
    const size =
      facing === "environment"
        ? { width: { ideal: 4096 }, height: { ideal: 3072 } }
        : { width: { ideal: 1920 }, height: { ideal: 1440 } };
    try {
      let stream: MediaStream;
      try {
        // exact: force the requested camera — "ideal" lets the browser keep
        // the rear camera on flip because of the high resolution preference
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { exact: facing }, ...size },
        });
      } catch {
        // no camera with that facing (e.g. desktop webcam) — take what exists
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, ...size },
        });
      }
      if (myId !== startIdRef.current) {
        // a newer start superseded this request
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        // detach first — iOS Safari can freeze on a direct stream swap
        video.srcObject = null;
        video.srcObject = stream;
        video.play().catch(() => {});
      }
    } catch (e) {
      if (myId === startIdRef.current) {
        setCamError(e instanceof Error ? e.message : String(e));
      }
    }
  }, []);

  // request camera on mount, release on unmount; grab GPS while she frames the shot
  useEffect(() => {
    startCamera(facingRef.current);
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 15000 },
    );
    return () => {
      startIdRef.current++;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [startCamera]);

  // the <video> remounts when returning from the mint screen — reattach the stream
  useEffect(() => {
    if (phase !== "camera") return;
    const stream = streamRef.current;
    const video = videoRef.current;
    if (stream?.active && video && video.srcObject !== stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    } else if (stream && !stream.active) {
      startCamera(facingRef.current);
    }
  }, [phase, startCamera]);

  // ASSESSING for a beat, then auto-fill model + rarity
  // (hardcoded until the AI recognition spike lands)
  useEffect(() => {
    if (phase !== "mint") return;
    warmGarageCache(); // so /garage arrives with the full ring ready
    setAssessed(false);
    setAutoFilled(false);
    const t = window.setTimeout(() => {
      setAssessed(true);
      setName((n) => n || "Lamborghini Aventador");
      setAutoFilled(true);
    }, 2200);
    return () => window.clearTimeout(t);
  }, [phase]);

  // track the mint-screen photo box size (it flexes per viewport)
  useEffect(() => {
    if (phase !== "mint") return;
    const el = photoBoxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBoxSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);

  // initial framing: center the card-frame region in the photo box
  useEffect(() => {
    if (phase !== "mint" || !cropRect || !photoDims || !boxSize) return;
    setViewTop((prev) => {
      if (prev !== null) return prev;
      const k = boxSize.w / cropRect.width;
      const span = boxSize.h / k;
      const max = Math.max(0, photoDims.h - span);
      return Math.min(
        max,
        Math.max(0, cropRect.y - (span - cropRect.height) / 2),
      );
    });
  }, [phase, cropRect, photoDims, boxSize]);

  function flipCamera() {
    setCamRotation((r) => r + 180);
    facingRef.current =
      facingRef.current === "environment" ? "user" : "environment";
    startCamera(facingRef.current);
  }

  function toggleFlash() {
    const next = !flashOn;
    setFlashOn(next);
    // real torch where the platform supports it (Android Chrome); UI-only elsewhere
    const track = streamRef.current?.getVideoTracks()[0];
    const caps = track?.getCapabilities?.() as
      | (MediaTrackCapabilities & { torch?: boolean })
      | undefined;
    if (track && caps?.torch) {
      track
        .applyConstraints({
          advanced: [{ torch: next } as unknown as MediaTrackConstraintSet],
        })
        .catch(() => {});
    }
  }

  function shoot() {
    if (captured) return;
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    setPhoto(canvas.toDataURL("image/jpeg", 0.9));

    // map the on-screen CARD FRAME into full-frame photo pixels.
    // preview is object-fit:cover, so invert that projection
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const { width: cw, height: ch } = video.getBoundingClientRect();
    const s = Math.max(cw / vw, ch / vh);
    const dx = (vw * s - cw) / 2;
    const dy = (vh * s - ch) / 2;
    const fx = cw * FRAME.side;
    const fy = ch * FRAME.top;
    const fh = ch - FRAME.bottomPx - fy;
    const x = Math.max(0, Math.round((fx + dx) / s));
    const y = Math.max(0, Math.round((fy + dy) / s));
    setCropRect({
      x,
      y,
      width: Math.min(Math.round((cw - 2 * fx) / s), vw - x),
      height: Math.min(Math.round(fh / s), vh - y),
    });
    setPhotoDims({ w: vw, h: vh });
    setViewTop(null);

    setCaughtAt(new Date());
    setCaptured(true);
    // gold fill (.25s), then on to the mint screen
    window.setTimeout(() => {
      setPhase("mint");
      setCaptured(false);
    }, 350);
  }

  function retake() {
    if (mintState !== "idle") return;
    setPhoto(null);
    setName("");
    setCaughtAt(null);
    setMintState("idle");
    setCropRect(null);
    setPhotoDims(null);
    setViewTop(null);
    setPhase("camera");
  }

  // vertical reframe drag on the mint-screen photo
  function dragStart(e: React.PointerEvent<HTMLDivElement>) {
    if (viewTop === null || mintState !== "idle") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { y: e.clientY, viewTop };
  }
  function dragMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || !cropRect || !photoDims || !boxSize) return;
    const k = boxSize.w / cropRect.width;
    const span = boxSize.h / k;
    const max = Math.max(0, photoDims.h - span);
    setViewTop(
      Math.min(max, Math.max(0, d.viewTop - (e.clientY - d.y) / k)),
    );
  }
  function dragEnd() {
    dragRef.current = null;
  }

  // the card-frame rect with the user's chosen vertical offset applied
  function chosenFrame(): Rect | null {
    if (!cropRect) return null;
    if (!photoDims || !boxSize || viewTop === null) return cropRect;
    const k = boxSize.w / cropRect.width;
    const span = boxSize.h / k;
    const y = Math.round(
      Math.min(
        photoDims.h - cropRect.height,
        Math.max(0, viewTop + (span - cropRect.height) / 2),
      ),
    );
    return { ...cropRect, y };
  }

  function mint() {
    if (mintState !== "idle" || !photo) return;
    // hand the mint to the background store; the garage renders it as a
    // SEALING card that authenticates while the chain call completes
    startMint({
      photo,
      // fall back to the hardcoded model if mint is tapped mid-ASSESSING
      name: name.trim() || "Lamborghini Aventador",
      lat: gps?.lat,
      lon: gps?.lon,
      caughtAt: caughtAt?.toISOString(),
      frame: chosenFrame(),
    });
    setMintState("added");
    window.setTimeout(() => router.push("/garage"), 900);
  }

  if (phase === "camera") {
    return (
      <div className="fixed inset-0 mx-auto w-full max-w-[430px] overflow-hidden bg-scanner">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* legibility scrim */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(7,7,10,.82) 0%, rgba(7,7,10,.1) 20%, rgba(7,7,10,0) 46%, rgba(7,7,10,.72) 78%, rgba(7,7,10,.95) 100%)",
          }}
        />

        {/* CARD FRAME guide — the band that becomes the minted card photo */}
        <div
          className="pointer-events-none absolute rounded-[4px]"
          style={{
            left: `${FRAME.side * 100}%`,
            right: `${FRAME.side * 100}%`,
            top: `${FRAME.top * 100}%`,
            bottom: `${FRAME.bottomPx}px`,
            boxShadow: "0 0 0 2000px rgba(7,7,10,.34)",
          }}
          aria-hidden
        >
          <span
            className="absolute left-0 top-0 h-[26px] w-[26px]"
            style={{ borderTop: bracket, borderLeft: bracket }}
          />
          <span
            className="absolute right-0 top-0 h-[26px] w-[26px]"
            style={{ borderTop: bracket, borderRight: bracket }}
          />
          <span
            className="absolute bottom-0 left-0 h-[26px] w-[26px]"
            style={{ borderBottom: bracket, borderLeft: bracket }}
          />
          <span
            className="absolute bottom-0 right-0 h-[26px] w-[26px]"
            style={{ borderBottom: bracket, borderRight: bracket }}
          />
        </div>

        {camError && (
          <button
            onClick={() => startCamera(facingRef.current)}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center"
          >
            <span className="font-mono text-[10px] font-normal leading-relaxed tracking-[.2em] text-[rgba(242,241,238,.4)]">
              ALLOW CAMERA ACCESS TO CATCH
            </span>
            <span className="font-mono text-[9px] tracking-[.2em] text-[rgba(242,241,238,.25)]">
              TAP TO RETRY
            </span>
          </button>
        )}

        {/* hint line */}
        <div className="absolute bottom-[196px] left-5 right-5 text-center font-mono text-[9px] font-normal leading-none tracking-[.2em] text-[rgba(242,241,238,.34)]">
          {captured ? "REVIEW ON NEXT SCREEN" : ""}
        </div>

        {/* capture controls */}
        <div className="absolute inset-x-0 bottom-[104px] grid grid-cols-[1fr_auto_1fr] items-center px-[22px]">
          <button
            onClick={flipCamera}
            aria-label="Flip camera"
            className={`${glassBtn} justify-self-start`}
            style={{
              ...glassBtnStyle,
              transform: `rotate(${camRotation}deg)`,
              transition: "transform .45s cubic-bezier(.36,.66,.04,1)",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(242,241,238,.78)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-[18px] w-[18px]"
              aria-hidden
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>

          <button
            onClick={shoot}
            aria-label="Take photo"
            className="flex h-[78px] w-[78px] items-center justify-center justify-self-center rounded-full bg-[rgba(10,10,15,.28)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            style={{
              border: "1px solid rgba(233,231,226,.5)",
              backdropFilter: "blur(6px)",
              WebkitBackdropFilter: "blur(6px)",
            }}
          >
            <span
              className="block h-[62px] w-[62px] rounded-full"
              style={{
                background: captured ? "#C9B37E" : "#15151C",
                border: ".5px solid rgba(201,179,126,.55)",
                boxShadow:
                  "inset 0 .5px 0 rgba(255,255,255,.16), 0 8px 24px rgba(0,0,0,.5)",
                transition: "background .25s ease",
              }}
              aria-hidden
            />
          </button>

          <button
            onClick={toggleFlash}
            aria-label="Toggle flash"
            aria-pressed={flashOn}
            className={`${glassBtn} justify-self-end`}
            style={glassBtnStyle}
          >
            <span
              className="block h-4 w-[9px]"
              style={{
                background: flashOn ? "#C9B37E" : "rgba(242,241,238,.7)",
                clipPath:
                  "polygon(58% 0, 0 58%, 42% 58%, 42% 100%, 100% 40%, 55% 40%)",
              }}
              aria-hidden
            />
          </button>
        </div>
      </div>
    );
  }

  // ---- Capture → mint (screen 1b) ----
  const mintLabel = mintState === "added" ? "ADDED TO GARAGE" : "MINT TO GARAGE";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* captured photo — flexes to whatever the sheet doesn't need,
          so Retake always stays on screen (≈520px on the design canvas).
          Shows the CARD FRAME region; drag vertically to reframe. */}
      <div
        ref={photoBoxRef}
        className="mint-photo-in relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={dragStart}
        onPointerMove={dragMove}
        onPointerUp={dragEnd}
        onPointerCancel={dragEnd}
      >
        {photo &&
          (cropRect && photoDims && boxSize && viewTop !== null ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt="your catch"
              draggable={false}
              className="absolute left-0 top-0 max-w-none select-none"
              style={{
                width: photoDims.w * (boxSize.w / cropRect.width),
                height: photoDims.h * (boxSize.w / cropRect.width),
                transform: `translate(${-cropRect.x * (boxSize.w / cropRect.width)}px, ${
                  -viewTop * (boxSize.w / cropRect.width)
                }px)`,
              }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt="your catch"
              draggable={false}
              className="absolute inset-0 h-full w-full select-none object-cover"
            />
          ))}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(10,10,15,.55) 0%, rgba(10,10,15,0) 26%, rgba(10,10,15,0) 62%, rgba(10,10,15,.9) 100%)",
          }}
        />
      </div>

      {/* glass sheet */}
      <div
        className="mint-sheet-in flex flex-none flex-col px-5 pt-5"
        style={{
          background: "rgba(255,255,255,.028)",
          borderTop: ".5px solid rgba(233,231,226,.1)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 58px)",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          {assessed ? (
            <span
              className={`min-w-0 flex-1 truncate text-[22px] font-normal leading-[1.15] text-foreground-bright ${
                autoFilled ? "name-reveal" : ""
              }`}
              style={{ letterSpacing: ".004em" }}
            >
              {name}
            </span>
          ) : (
            // shimmer loader while the model is being identified
            <span className="min-w-0 flex-1">
              <span
                className="block h-[22px] w-[172px] animate-pulse rounded-[6px]"
                style={{ background: "rgba(255,255,255,.08)" }}
                aria-hidden
              />
            </span>
          )}
          <span
            className="flex-none rounded-[5px] px-[9px] py-[5px] font-mono text-[9px] font-semibold leading-none tracking-[.2em] text-[rgba(242,241,238,.72)]"
            style={{
              background: "rgba(242,241,238,.07)",
              border: ".5px solid rgba(233,231,226,.18)",
            }}
          >
            {assessed ? "RARE" : "ASSESSING"}
          </span>
        </div>

        {/* meta rows */}
        <div className="mt-[18px] flex flex-col">
          <div
            className="flex items-center gap-[10px] py-3"
            style={{ borderTop: hairline }}
          >
            <span className="flex w-4 justify-center" aria-hidden>
              <span
                className="block h-[9px] w-[9px] -rotate-45"
                style={{
                  borderRadius: "9px 9px 9px 0",
                  border: "1.2px solid rgba(242,241,238,.55)",
                }}
              />
            </span>
            <span className="flex-1 text-[13px] leading-none text-[rgba(242,241,238,.82)]">
              {gps
                ? `${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}`
                : "Location unavailable"}
            </span>
            <span className="font-mono text-[11px] leading-none text-[rgba(242,241,238,.36)]">
              SPOT —
            </span>
          </div>
          <div
            className="flex items-center gap-[10px] py-3"
            style={{ borderTop: hairline, borderBottom: hairline }}
          >
            <span className="flex w-4 justify-center" aria-hidden>
              <span
                className="block h-[10px] w-[10px] rounded-[2px]"
                style={{ border: "1.2px solid rgba(242,241,238,.55)" }}
              />
            </span>
            <span className="flex-1 text-[13px] leading-none text-[rgba(242,241,238,.82)]">
              {caughtAt ? formatCaught(caughtAt) : "—"}
            </span>
            <span className="font-mono text-[11px] leading-none text-[rgba(242,241,238,.36)]">
              MINT —
            </span>
          </div>
        </div>

        {/* mint + retake */}
        <div className="mt-7 pb-[6px]">
          <button
            onClick={mint}
            className={`flex h-[54px] w-full items-center justify-center rounded-[15px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
              mintState === "added"
                ? "mint-flash bg-accent"
                : "bg-[#14141A] hover:bg-[#191920]"
            }`}
            style={{
              border: `.5px solid ${
                mintState === "added" ? "#E0CD9C" : "rgba(201,179,126,.6)"
              }`,
              boxShadow:
                mintState === "added"
                  ? "0 10px 30px rgba(0,0,0,.5), 0 0 24px rgba(201,179,126,.35), inset 0 .5px 0 rgba(255,255,255,.35)"
                  : "0 10px 30px rgba(0,0,0,.5), inset 0 .5px 0 rgba(255,255,255,.08)",
              transition: "background .25s ease",
            }}
          >
            <span
              className={`font-mono text-[12.5px] font-semibold leading-none tracking-[.26em] ${
                mintState === "added" ? "text-[#0A0A0F]" : "text-foreground"
              }`}
            >
              {mintLabel}
            </span>
          </button>
          <button
            onClick={retake}
            disabled={mintState === "added"}
            className="flex h-11 w-full items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 disabled:opacity-40"
          >
            <span className="text-[12.5px] leading-none tracking-[.02em] text-[rgba(242,241,238,.45)]">
              Retake
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
