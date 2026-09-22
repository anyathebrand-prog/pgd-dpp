'use client';

import { useEffect, useRef } from 'react';

/**
 * AUTH-05 — the Cloudflare Turnstile widget, rendered explicitly.
 *
 * It places a hidden `cf-turnstile-response` field inside the surrounding
 * form; the server action checks it with siteverify (src/lib/turnstile.ts).
 * The browser never calls siteverify itself.
 *
 * A token verifies once. After any submit the widget is reset, so a sign-up
 * refused for another reason (a weak password, say) does not fail the
 * security check on the second try with a spent token. The reset runs after
 * the current event, by which time the form's data has been read.
 *
 * Cloudflare's script is loaded here, on the one page that needs it, and
 * only when a site key is configured.
 */

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<void> | null = null;

function loadScript() {
  if (window.turnstile) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        loading = null;
        reject(new Error('Turnstile failed to load'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export function TurnstileWidget({ siteKey, action }: { siteKey: string; action: string }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    const form = box.current?.closest('form') ?? null;
    const onSubmit = () =>
      window.setTimeout(() => {
        if (widgetId) window.turnstile?.reset(widgetId);
      }, 0);

    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        widgetId = window.turnstile.render(box.current, {
          sitekey: siteKey,
          action,
          theme: 'dark',
          size: 'flexible',
          'response-field-name': 'cf-turnstile-response',
        });
      })
      .catch(() => {
        // The server refuses a missing token with its own message; there is
        // nothing more useful to do here than leave the space empty.
      });

    form?.addEventListener('submit', onSubmit);
    return () => {
      cancelled = true;
      form?.removeEventListener('submit', onSubmit);
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, action]);

  // 65px is the widget's height; reserving it keeps the button from jumping.
  return <div ref={box} className="mb-6 min-h-[65px]" />;
}
