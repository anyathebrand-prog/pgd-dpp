import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { myPlan } from '@/modules/payments/plan';
import { payInstallment } from '@/modules/payments/actions';
import { Footer, TopBar } from '@/components/shell';
import { Banner, DataString, EmptyState, Naira, Record, cx } from '@/components/ui';
import { ActionButton } from '@/components/action-button';

/**
 * PAY-09 — a student's tuition plan.
 *
 * The schedule, what is paid and what is due, and one button: the earliest
 * unpaid part, because parts are paid in order and the gate reads the
 * earliest overdue one.
 */
export default async function TuitionPlan() {
  const me = await requireUser();
  const institution = await requireInstitution();
  const plan = await myPlan(institution.id, me.userId);

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[640px] px-4 py-12">
        <h1 className="t-h1 m-0 text-ink-900">Your tuition plan</h1>

        {plan.parts.length === 0 ? (
          <div className="mt-8">
            <EmptyState heading="No plan">
              You paid your tuition in full, or have not started paying it yet.
            </EmptyState>
          </div>
        ) : (
          <>
            {plan.gated && plan.next ? (
              <div className="mt-6">
                <Banner tone="danger" title={`Part ${plan.next.installmentNumber} is overdue`}>
                  <p>
                    Lessons are paused until it settles. Everything you have done so far is kept.
                  </p>
                </Banner>
              </div>
            ) : plan.dueSoon && plan.next ? (
              <div className="mt-6">
                <Banner tone="warning" title={`Part ${plan.next.installmentNumber} is due soon`}>
                  <p>
                    If a sponsor is paying it by transfer, tell them now: a transfer can take days to
                    be confirmed.
                  </p>
                </Banner>
              </div>
            ) : null}

            <ol className="mt-8 grid list-none gap-4 p-0">
              {plan.parts.map((part) => {
                const paid = part.status === 'success';
                const isNext = plan.next?.id === part.id;
                return (
                  <li key={part.id}>
                    <Record
                      title={`Part ${part.installmentNumber} of ${part.installmentCount}`}
                      meta={
                        paid
                          ? `Paid ${part.paidAt?.toLocaleDateString('en-NG') ?? ''}`
                          : `Due ${part.dueAt?.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }) ?? ''}`
                      }
                    >
                      <p className="t-data-lg m-0 flex justify-between text-ink-900">
                        <Naira kobo={part.amountKobo} />
                        <span
                          className={cx(
                            't-body-sm font-sans',
                            paid ? 'text-verified-text' : part.status === 'awaiting_approval' ? 'text-ink-700' : 'text-ink-700',
                          )}
                        >
                          {paid
                            ? 'Paid'
                            : part.status === 'awaiting_approval'
                              ? 'Transfer awaiting approval'
                              : 'Not yet paid'}
                        </span>
                      </p>
                      <p className="t-caption mt-2 mb-0 text-ink-700">
                        Reference <DataString value={part.reference} label="Payment reference" />
                      </p>
                      {isNext && !paid && part.status !== 'awaiting_approval' ? (
                        <div className="mt-4">
                          <ActionButton
                            action={payInstallment}
                            label={`Pay part ${part.installmentNumber}`}
                            pendingLabel="Opening checkout"
                            hidden={{ transactionId: part.id }}
                          />
                        </div>
                      ) : null}
                    </Record>
                  </li>
                );
              })}
            </ol>

            <p className="t-body-sm mt-8">
              <Link href="/pay/offline" className="text-ink-900 underline underline-offset-2">
                Paying a part by bank transfer instead?
              </Link>
            </p>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
