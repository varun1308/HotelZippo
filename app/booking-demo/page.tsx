/* /booking-demo — in-app mock checkout page (specs/10e-booking-mock.md).
 *
 * The demo deep-link target. In live mode the get-payment-url step hands the user off to RouteStack's
 * hosted checkout; in demo mode (ROUTESTACK_MOCK=1) the mock transport points the deep link here so the
 * FULL booking journey is showable in production without the unstable RouteStack sandbox.
 *
 * This page does NOT take a real payment (no card fields, no PCI — same as the live deep-link model). A
 * clear banner states it is a demonstration. "Confirm booking" POSTs to /api/booking/mock-confirm, which
 * self-emits a real BOOKING_SUCCESS webhook → the pending booking_orders row flips CONFIRMED — proving
 * the production lifecycle plumbing end-to-end.
 *
 * Tokens: the locked 05 design tokens (Tailwind classes), mirroring the booking modal's visual language. */
'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function BookingDemoInner() {
  const params = useSearchParams();
  const session = params.get('session') ?? '';
  const hotel = params.get('hotel') ?? 'your hotel';
  const checkIn = params.get('checkIn') ?? '';
  const checkOut = params.get('checkOut') ?? '';

  const [status, setStatus] = useState<'idle' | 'confirming' | 'confirmed' | 'error'>('idle');

  async function confirm() {
    setStatus('confirming');
    try {
      const res = await fetch('/api/booking/mock-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, hotel, checkIn, checkOut }),
      });
      if (!res.ok) {
        setStatus('error');
        return;
      }
      setStatus('confirmed');
    } catch {
      setStatus('error');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[640px] flex-col justify-center px-6 py-12">
      <div className="rounded-panel border border-border bg-surface p-6 shadow-panel sm:p-8">
        {/* Honesty banner — this is never mistaken for a real payment. */}
        <div
          role="note"
          className="mb-6 rounded-btn border border-border bg-surface-2 px-4 py-3 text-[13px] text-text-secondary"
        >
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Demonstration checkout
          </span>
          <p className="mt-1 m-0">
            This is a sample booking experience — no payment is taken and no real reservation is made.
          </p>
        </div>

        {status !== 'confirmed' ? (
          <>
            <h1 className="m-0 font-serif text-[24px] font-medium tracking-[-0.01em] text-text">
              Review your stay
            </h1>
            <p className="mt-2 text-[14px] text-text-secondary">
              You&apos;re about to complete a demo booking at <strong className="text-text">{hotel}</strong>.
            </p>

            <dl className="mt-6 flex flex-col gap-3 border-t border-border pt-6">
              <Row label="Hotel" value={hotel} />
              {checkIn && <Row label="Check-in" value={checkIn} />}
              {checkOut && <Row label="Check-out" value={checkOut} />}
            </dl>

            <button
              type="button"
              onClick={confirm}
              disabled={status === 'confirming'}
              className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-btn bg-primary-500 px-5 text-[15px] font-semibold text-white transition-colors duration-fast hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            >
              {status === 'confirming' ? 'Confirming…' : 'Confirm booking'}
            </button>

            {status === 'error' && (
              <p role="alert" className="mt-3 text-[13px] text-text-secondary">
                Something went wrong confirming the demo booking. Please try again.
              </p>
            )}
          </>
        ) : (
          <div className="text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-[22px]">
              ✅
            </div>
            <h1 className="mt-4 m-0 font-serif text-[24px] font-medium tracking-[-0.01em] text-text">
              Booking confirmed
            </h1>
            <p className="mt-2 text-[14px] text-text-secondary">
              Your demo stay at <strong className="text-text">{hotel}</strong> is confirmed.
            </p>
            <Link
              href="/chat"
              className="mt-8 inline-flex h-11 items-center justify-center rounded-btn border border-border bg-surface px-6 text-[15px] font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Back to chat
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-[14px]">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="m-0 truncate text-text">{value}</dd>
    </div>
  );
}

export default function BookingDemoPage() {
  // useSearchParams requires a Suspense boundary in the app router.
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <BookingDemoInner />
    </Suspense>
  );
}
