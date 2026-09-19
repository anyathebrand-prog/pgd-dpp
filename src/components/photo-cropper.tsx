'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button } from './ui';
import type { ActionState } from './form';
import { savePassportPhoto } from '@/modules/admissions/photo';

/**
 * AP-06 — cropping a passport photograph in the browser (APP-05).
 *
 * Hand-rolled on a canvas rather than pulled from a cropping library. The
 * interaction is a drag, a zoom and a rotate, and the reason not to add a
 * dependency is the same one the flow gives for the feature: this has to work
 * on a small touchscreen on a slow connection, which is how most candidates
 * will reach it.
 *
 * The output is always 600×771 — 35×45mm at 300dpi with room to spare — and
 * the zoom is clamped so the crop can never be enlarged past the resolution
 * actually present in the source. A photograph that looks fine on a phone and
 * prints as a smear on an ID card is the failure this exists to prevent, and
 * it is invisible without that clamp.
 */

/** 35×45mm at ~440dpi. Comfortably above the 413×531 print floor. */
const OUT_W = 600;
const OUT_H = 771;
/** Never upscale past the print floor: 600/413. */
const MAX_UPSCALE = 600 / 413;

type Loaded = { image: HTMLImageElement; width: number; height: number };

export function PhotoCropper({ hasExisting }: { hasExisting: boolean }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [quarter, setQuarter] = useState(0);
  const [focus, setFocus] = useState({ x: 0, y: 0 });

  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    savePassportPhoto,
    undefined,
  );

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);

  /** Draw the crop exactly as it will be saved — the preview is the output. */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.fillStyle = '#F7F4EE';
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    ctx.translate(OUT_W / 2, OUT_H / 2);
    ctx.rotate((quarter * Math.PI) / 2);
    ctx.scale(zoom, zoom);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(loaded.image, -focus.x, -focus.y);
    ctx.restore();
  }, [loaded, zoom, quarter, focus]);

  useEffect(draw, [draw]);

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setRejected(null);
    setBusy(true);

    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      setBusy(false);

      const { naturalWidth: w, naturalHeight: h } = image;
      // The "resolution too low" state the flow asks for, stated as numbers
      // rather than as "invalid image".
      if (w < 413 || h < 531) {
        setRejected(
          `That photograph is ${w}×${h} pixels. A passport photograph has to be at least 413×531 to print on an ID card and a certificate — take it again a little closer, or choose a larger file.`,
        );
        setLoaded(null);
        return;
      }

      // The smallest zoom that still fills the frame, so there is never a
      // blank edge in the saved photograph.
      const fit = Math.max(OUT_W / w, OUT_H / h);
      setLoaded({ image, width: w, height: h });
      setMinZoom(fit);
      setZoom(fit);
      setQuarter(0);
      setFocus({ x: w / 2, y: h / 2 });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setBusy(false);
      setLoaded(null);
      setRejected('That file could not be opened as an image. Save it as a JPEG and try again.');
    };
    image.src = url;
  }

  /** Keep the visible frame inside the photograph, whatever the zoom. */
  function clampFocus(next: { x: number; y: number }, atZoom: number): { x: number; y: number } {
    if (!loaded) return next;
    const halfW = OUT_W / 2 / atZoom;
    const halfH = OUT_H / 2 / atZoom;
    return {
      x: Math.min(Math.max(next.x, halfW), Math.max(loaded.width - halfW, halfW)),
      y: Math.min(Math.max(next.y, halfH), Math.max(loaded.height - halfH, halfH)),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!loaded) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    dragging.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragging.current || !loaded || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    // The canvas is displayed smaller than it is drawn, so a finger's travel
    // has to be converted into output pixels before it becomes source pixels.
    const ratio = OUT_W / rect.width;
    const dx = ((e.clientX - dragging.current.x) * ratio) / zoom;
    const dy = ((e.clientY - dragging.current.y) * ratio) / zoom;
    dragging.current = { x: e.clientX, y: e.clientY };
    setFocus((f) => clampFocus({ x: f.x - dx, y: f.y - dy }, zoom));
  }

  function onPointerUp() {
    dragging.current = null;
  }

  function onZoom(value: number) {
    setZoom(value);
    setFocus((f) => clampFocus(f, value));
  }

  /** Hand the canvas to the action as a file, which is all the server wants. */
  async function submit(formData: FormData) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
    );
    if (!blob) return;
    formData.set('file', new File([blob], 'passport.jpg', { type: 'image/jpeg' }));
    formAction(formData);
  }

  const maxZoom = Math.max(minZoom, MAX_UPSCALE);

  return (
    <div>
      {state?.error ? (
        <div className="mb-6">
          <Banner tone="danger" title="Not saved">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}

      {rejected ? (
        <div className="mb-6">
          <Banner tone="danger" title="That photograph cannot be used">
            <p>{rejected}</p>
          </Banner>
        </div>
      ) : null}

      <div className="mb-6">
        <label htmlFor="photo-file" className="t-label mb-2 block text-ink-900">
          {loaded || hasExisting ? 'Choose a different photograph' : 'Choose a photograph'}
        </label>
        <input
          ref={fileRef}
          id="photo-file"
          type="file"
          accept="image/jpeg,image/png"
          onChange={onFile}
          className="t-body-sm block w-full text-ink-900"
        />
        <p id="photo-file-helper" className="t-body-sm mt-1.5 text-ink-500">
          A plain background, your face square to the camera, no hat or sunglasses. At least
          413×531 pixels.
        </p>
      </div>

      {busy ? <p className="t-body-sm text-ink-700">Opening the photograph…</p> : null}

      {loaded ? (
        <div className="grid gap-8 md:grid-cols-[minmax(0,260px)_1fr]">
          <div>
            {/* The canvas is the preview and the output at once: what is drawn
                here is byte for byte what gets saved. */}
            <canvas
              ref={canvasRef}
              width={OUT_W}
              height={OUT_H}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              aria-label="Your photograph. Drag to move it within the frame."
              className="w-full max-w-[260px] touch-none rounded-sm border border-ink-500 bg-record"
            />
            <p className="t-caption mt-2 mb-0 text-ink-700">
              Drag the photograph to move it inside the frame.
            </p>
          </div>

          <div>
            <div className="mb-6">
              <label htmlFor="photo-zoom" className="t-label mb-2 block text-ink-900">
                Zoom
              </label>
              <input
                id="photo-zoom"
                type="range"
                min={minZoom}
                max={maxZoom}
                step={0.01}
                value={zoom}
                onChange={(e) => onZoom(Number(e.target.value))}
                className="w-full"
              />
              <p className="t-body-sm mt-1.5 text-ink-500">
                {zoom >= maxZoom - 0.001
                  ? 'This is as far in as this photograph goes without losing detail it does not have.'
                  : 'Fit your head and the top of your shoulders inside the frame.'}
              </p>
            </div>

            <div className="mb-8 flex flex-wrap gap-3">
              <Button
                type="button"
                size="dense"
                variant="secondary"
                onClick={() => setQuarter((q) => (q + 3) % 4)}
              >
                Rotate left
              </Button>
              <Button
                type="button"
                size="dense"
                variant="secondary"
                onClick={() => setQuarter((q) => (q + 1) % 4)}
              >
                Rotate right
              </Button>
            </div>

            <form action={submit}>
              <Button type="submit" disabled={pending} aria-busy={pending}>
                {pending ? 'Saving' : 'Save photo'}
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
