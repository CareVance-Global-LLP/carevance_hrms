import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

/**
 * Where a candidate reads and accepts an offer.
 *
 * PUBLIC, AND DELIBERATELY SELF-CONTAINED. Somebody arriving here is not a user
 * of this product and never will be, so this page imports none of the app
 * chrome: no sidebar, no auth context, no theme toggle. It also uses a bare
 * axios instance rather than the shared client, because that client attaches
 * credentials and redirects to /login on a 401 — behaviour that would be
 * actively wrong for a stranger holding a one-time link.
 *
 * EVERY FAILURE READS THE SAME, because the server tells us the same thing for
 * a wrong token, an expired one and one already used. That is intentional on
 * the server, and the page must not invent a distinction it has not been told.
 *
 * TYPING A NAME IS A SIGNATURE. The drawn canvas is offered because people
 * expect it, but it is never required — insisting on one excludes anybody on a
 * keyboard, on assistive technology, or on a device where drawing is painful.
 */
type OfferTerms = {
  designation: string;
  annual_ctc: string | number;
  joining_bonus?: string | number | null;
  proposed_joining_date?: string | null;
  valid_until?: string | null;
  company?: string | null;
  candidate_first_name?: string | null;
};

export default function OfferSigningPage() {
  const { token = '' } = useParams();
  const [terms, setTerms] = useState<OfferTerms | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'accepted' | 'declined'>('loading');
  const [name, setName] = useState('');
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const drew = useRef(false);

  const base = useMemo(() => `/api/offers/sign/${encodeURIComponent(token)}`, [token]);

  useEffect(() => {
    let cancelled = false;

    axios
      .get(base)
      .then((response) => {
        if (cancelled) return;
        setTerms(response.data.data);
        setState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        // One outcome for every failure — see the file docblock.
        setState('gone');
      });

    return () => {
      cancelled = true;
    };
  }, [base]);

  const draw = (event: React.PointerEvent<HTMLCanvasElement>, start: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (start) {
      drawing.current = true;
      context.beginPath();
      context.moveTo(x, y);
      return;
    }

    if (!drawing.current) return;
    drew.current = true;
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.strokeStyle = '#14181c';
    context.lineTo(x, y);
    context.stroke();
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    drew.current = false;
  };

  const submit = async () => {
    if (!name.trim()) {
      setError('Please type your full name.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      await axios.post(base, {
        signer_name: name.trim(),
        // Only sent if they actually drew something — an untouched canvas is a
        // blank image, and storing one dresses up a typed signature as a drawn
        // one in the audit record.
        signature_image: drew.current ? canvasRef.current?.toDataURL('image/png') : null,
      });
      setState('accepted');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'We could not record that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!reason.trim()) {
      setError('Please tell us briefly why.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      await axios.post(`${base}/decline`, { reason: reason.trim() });
      setState('declined');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'We could not record that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') {
    return <Shell><p className="text-sm text-slate-500">Loading your offer…</p></Shell>;
  }

  if (state === 'gone') {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-slate-950">This link is no longer valid</h1>
        <p className="mt-2 text-sm text-slate-600">
          It may have expired or already been used. Please contact the person who sent it to you.
        </p>
      </Shell>
    );
  }

  if (state === 'accepted') {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-slate-950">Thank you — your acceptance is recorded</h1>
        <p className="mt-2 text-sm text-slate-600">
          We have kept a copy of the letter as you signed it, along with the date and time. Somebody will be in touch
          about your start.
        </p>
      </Shell>
    );
  }

  if (state === 'declined') {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-slate-950">Thank you for letting us know</h1>
        <p className="mt-2 text-sm text-slate-600">We appreciate you taking the time to reply.</p>
      </Shell>
    );
  }

  return (
    <Shell wide>
      <h1 className="text-lg font-semibold text-slate-950">
        {terms?.candidate_first_name ? `${terms.candidate_first_name}, your offer` : 'Your offer'}
        {terms?.company ? ` from ${terms.company}` : ''}
      </h1>

      <dl className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-2">
        <Term label="Position" value={terms?.designation} />
        <Term label="Annual cost to company" value={formatRupees(terms?.annual_ctc)} />
        {terms?.joining_bonus && Number(terms.joining_bonus) > 0 ? (
          <Term label="Joining bonus" value={formatRupees(terms.joining_bonus)} />
        ) : null}
        {terms?.proposed_joining_date ? (
          <Term label="Proposed start" value={formatDate(terms.proposed_joining_date)} />
        ) : null}
        {terms?.valid_until ? <Term label="Open until" value={formatDate(terms.valid_until)} /> : null}
      </dl>

      {/*
        * Inline, not a download. Somebody is being asked to agree to this, and
        * making them fetch a file first is a step at which people stop reading.
        */}
      <object data={`${base}/document`} type="application/pdf" className="mt-3 h-[28rem] w-full rounded-lg border border-slate-200">
        <p className="p-4 text-sm text-slate-600">
          Your browser cannot display the letter here.{' '}
          <a className="underline" href={`${base}/document`} target="_blank" rel="noreferrer">
            Open it in a new tab
          </a>
          .
        </p>
      </object>

      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {declining ? (
        <div className="mt-4 rounded-lg border border-slate-200 p-3">
          <label className="block text-sm font-medium text-slate-800" htmlFor="decline-reason">
            We are sorry to hear it. Could you tell us why?
          </label>
          <textarea
            id="decline-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 p-2 text-sm"
            placeholder="I have accepted another offer"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={decline}
              disabled={busy}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(false)}
              className="rounded-lg px-3 py-2 text-sm text-slate-600"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-slate-200 p-3">
          <label className="block text-sm font-medium text-slate-800" htmlFor="signer-name">
            Type your full name to accept
          </label>
          <input
            id="signer-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 p-2 text-sm"
            placeholder="Your full name"
            autoComplete="name"
          />

          <p className="mt-3 text-xs text-slate-500">
            You can also sign below if you would like to. This is optional.
          </p>
          <canvas
            ref={canvasRef}
            width={480}
            height={120}
            onPointerDown={(event) => draw(event, true)}
            onPointerMove={(event) => draw(event, false)}
            onPointerUp={() => { drawing.current = false; }}
            onPointerLeave={() => { drawing.current = false; }}
            className="mt-1 w-full max-w-[480px] touch-none rounded-lg border border-dashed border-slate-300 bg-white"
          />
          <button type="button" onClick={clearCanvas} className="mt-1 text-xs text-slate-500 underline">
            Clear
          </button>

          <p className="mt-3 text-xs text-slate-500">
            {/* Said plainly before they act, not disclosed afterwards. */}
            When you accept, we record the date, time and network address you accepted from, together with a
            fingerprint of this letter exactly as it appears above.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Recording…' : 'Accept this offer'}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(true)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
            >
              I need to decline
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <div className={`mx-auto rounded-xl bg-white p-6 shadow-sm ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        {children}
      </div>
    </div>
  );
}

function Term({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-950">{value ?? '—'}</dd>
    </div>
  );
}

/** Indian grouping — how a salary is read by the person receiving it. */
function formatRupees(amount?: string | number | null): string {
  if (amount === null || amount === undefined) return '—';
  return `₹ ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(amount))}`;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}
