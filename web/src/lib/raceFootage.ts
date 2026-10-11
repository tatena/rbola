// Race footage per track (founder-generated, H.264 + original sound). Tracks
// without footage fall back to the track-art beat. "cover" = portrait crop,
// full-bleed; "contain" = a wider frame, letterboxed (both cars stay in shot).
//
// Phones only play sound for a media element that was started by a tap. The
// race plays ~30s after the player's last tap (ENTER), so one shared <video>
// element is started-and-paused inside that tap (`unlockFootage`) and reused
// by the race screen, which can then autoplay it with sound.

export type Footage = { src: string; fit: "cover" | "contain" };

export const TRACK_VIDEO: Record<string, Footage> = {
  "MOUNTAIN PASS": { src: "/races/mountain.mp4", fit: "cover" },
  "DRAG STRIP": { src: "/races/drag.mp4", fit: "contain" },
};

let el: HTMLVideoElement | null = null;

export function footageElement(): HTMLVideoElement {
  if (!el) {
    el = document.createElement("video");
    el.playsInline = true;
    el.setAttribute("playsinline", "");
    el.preload = "auto";
  }
  return el;
}

// load a track's footage into the shared element (no-op if already loaded)
export function primeFootage(src: string): HTMLVideoElement {
  const v = footageElement();
  if (!v.src.endsWith(src)) {
    v.src = src;
    v.load();
  }
  return v;
}

// call synchronously inside the ENTER tap
export function unlockFootage(track: string) {
  const f = TRACK_VIDEO[track];
  if (!f) return;
  const v = primeFootage(f.src);
  v.muted = false;
  // play() inside the gesture is what grants sound later; pausing at once
  // keeps it silent
  v.play().catch(() => {});
  v.pause();
}
