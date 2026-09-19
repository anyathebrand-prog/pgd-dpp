'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button } from './ui';

/**
 * FC-02 — attaching a video to a lesson.
 *
 * It posts to a route handler rather than calling a server action, because a
 * lecture recording is far larger than any form body this product allows. The
 * consequence is that the upload state is this component's own problem, which
 * is why it reports progress: a facilitator on a Nigerian office connection is
 * sending 100MB, and a button that says "Uploading" for four minutes with no
 * movement is indistinguishable from one that has crashed.
 *
 * XMLHttpRequest rather than fetch, for the one thing fetch still cannot do:
 * tell you how far through the body it is.
 */
export function LessonVideo({
  lessonId,
  hasVideo,
  durationSeconds,
}: {
  lessonId: string;
  hasVideo: boolean;
  durationSeconds: number | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function upload(file: File) {
    setError(null);
    setDone(false);

    // Read the duration in the browser: the file is already here, and the
    // alternative is a server-side probe that needs ffmpeg on the box.
    const duration = await new Promise<number>((resolve) => {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        URL.revokeObjectURL(probe.src);
        resolve(Number.isFinite(probe.duration) ? probe.duration : 0);
      };
      probe.onerror = () => resolve(0);
      probe.src = URL.createObjectURL(file);
    });

    const body = new FormData();
    body.set('lessonId', lessonId);
    body.set('file', file);
    body.set('durationSeconds', String(Math.round(duration)));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/video/upload');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setPercent(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      setPercent(null);
      if (xhr.status === 200) {
        setDone(true);
        router.refresh();
        return;
      }
      try {
        setError(JSON.parse(xhr.responseText).error ?? 'The upload failed.');
      } catch {
        setError('The upload failed.');
      }
    };
    xhr.onerror = () => {
      setPercent(null);
      setError('The connection dropped during the upload. Nothing was saved — try again.');
    };
    xhr.send(body);
  }

  return (
    <div className="mt-4 border-t border-ink-700/20 pt-4">
      {error ? (
        <div className="mb-3">
          <Banner tone="danger" title="Not uploaded">
            <p>{error}</p>
          </Banner>
        </div>
      ) : null}

      {done ? (
        <div className="mb-3">
          <Banner tone="verified" title="Video attached">
            <p>Students on this lesson can watch it now.</p>
          </Banner>
        </div>
      ) : null}

      <p className="t-body-sm mt-0 mb-3 text-ink-700">
        {hasVideo
          ? `A video is attached${durationSeconds ? ` · ${Math.round(durationSeconds / 60)} minutes` : ''}. Uploading another replaces it for students.`
          : 'No video. The written lesson is what students are assessed on, so this is optional.'}
      </p>

      {percent !== null ? (
        // §9: progress that carries meaning is never a spinner. This is a real
        // percentage of bytes sent, and it is paired with the number.
        <div>
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Upload progress"
            className="h-1 w-full overflow-hidden bg-ink-100"
          >
            <div className="h-full bg-authority" style={{ width: `${percent}%` }} />
          </div>
          <p className="t-caption mt-2 mb-0 text-ink-700" aria-live="polite">
            {percent}% sent. Leaving this page cancels the upload.
          </p>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = '';
            }}
            id={`video-${lessonId}`}
          />
          <Button
            type="button"
            size="dense"
            variant="secondary"
            onClick={() => inputRef.current?.click()}
          >
            {hasVideo ? 'Replace the video' : 'Attach a video'}
          </Button>
          <span className="t-caption ml-3 text-ink-700">MP4, up to 200MB</span>
        </>
      )}
    </div>
  );
}
