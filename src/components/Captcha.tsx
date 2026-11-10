import { useEffect, useRef, useState } from 'react';

const KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;
/** false until the site key is set: the box is hidden and the server skips the check (it has no secret either) */
export const captchaOn = !!KEY;

let loading: Promise<any> | null = null;
const load = () => loading ??= new Promise((ok, fail) => {
  (window as any).ttCaptchaReady = () => ok((window as any).grecaptcha);
  const s = document.createElement('script');
  s.src = 'https://www.google.com/recaptcha/api.js?onload=ttCaptchaReady&render=explicit';
  s.async = true;
  s.onerror = () => { loading = null; s.remove(); fail(new Error('reCAPTCHA did not load')); };
  document.head.append(s);
});
const pageTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

/** Google's "I'm not a robot" box. onToken gets the answer, or '' when it expires; bump `reset` after each use (an answer works once). */
export default function Captcha({ onToken, reset }: { onToken: (t: string) => void; reset: number }) {
  const box = useRef<HTMLDivElement>(null), id = useRef<number | null>(null), cb = useRef(onToken);
  cb.current = onToken;
  const [theme, setTheme] = useState(pageTheme), [failed, setFailed] = useState(false);
  // follow the light/dark switch: Google's box can't change theme, so it is drawn again
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(pageTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  useEffect(() => {
    if (!KEY) return;
    let gone = false;
    const el = document.createElement('div');
    box.current!.replaceChildren(el);
    cb.current('');
    load().then((g) => {
      if (gone) return;
      setFailed(false);
      id.current = g.render(el, { sitekey: KEY, theme, callback: (t: string) => cb.current(t), 'expired-callback': () => cb.current(''), 'error-callback': () => cb.current('') });
    }).catch(() => !gone && setFailed(true));
    return () => { gone = true; id.current = null; };
  }, [theme]);
  useEffect(() => {
    if (!reset || id.current === null) return;
    (window as any).grecaptcha?.reset(id.current);
    cb.current('');
  }, [reset]);
  if (!KEY) return null;
  return (
    <div className="captcha">
      {/* Google's box can't be restyled inside; this frames it as one of the form's fields and trims its own square border */}
      <div className="captcha-field"><div className="captcha-clip"><div ref={box} /></div></div>
      {failed && <p role="alert" className="muted">The robot check didn't load. Check your connection, then reload the page.</p>}
    </div>
  );
}
