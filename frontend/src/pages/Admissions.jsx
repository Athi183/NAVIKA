import { useState } from 'react'
import { CheckCircle2, GraduationCap, XCircle } from 'lucide-react'

// The only hard, published eligibility number found on the actual
// admissions page (crawled, confirmed directly): a minimum aggregate of
// 60% marks in Physics, Chemistry and Maths, with at least 50% in each
// subject individually. This is the baseline to even be CONSIDERED, not
// a prediction of admission -- actual seats are allotted competitively
// by KEAM rank (Government quota) or a college merit list (Management/
// NRI/OCI quotas), neither of which has any published, fixed cutoff this
// app could check against, and both change every year with demand. A
// checker that implied "yes, you're admitted" would be actively
// misleading for a real family making a real decision, so this only ever
// reports the one thing that's actually knowable: whether the minimum
// bar to apply is met.
const MIN_AGGREGATE = 60
const MIN_PER_SUBJECT = 50

function checkEligibility({ physics, chemistry, maths }) {
  const marks = [physics, chemistry, maths]
  if (marks.some((mark) => mark === '' || Number.isNaN(Number(mark)))) {
    return null
  }
  const [p, c, m] = marks.map(Number)
  const aggregate = (p + c + m) / 3
  const meetsPerSubject = p >= MIN_PER_SUBJECT && c >= MIN_PER_SUBJECT && m >= MIN_PER_SUBJECT
  const meetsAggregate = aggregate >= MIN_AGGREGATE
  return { aggregate, meetsPerSubject, meetsAggregate, eligible: meetsPerSubject && meetsAggregate }
}

function MarkInput({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        max="100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0-100"
        className="mt-2 w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-lg focus:border-brand-400 focus:outline-none"
      />
    </label>
  )
}

export default function Admissions() {
  const [marks, setMarks] = useState({ physics: '', chemistry: '', maths: '' })
  const result = checkEligibility(marks)

  const updateMark = (key) => (value) => setMarks((current) => ({ ...current, [key]: value }))

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-black tracking-tight text-slate-900 md:text-5xl">Admissions</h1>
        <p className="mt-3 text-lg text-slate-600">How to join MITS</p>
      </div>

      <div className="rounded-3xl border-2 border-slate-200 bg-white p-6 md:p-8">
        <h2 className="text-2xl font-bold text-slate-900">Eligibility Criteria</h2>
        <ul className="mt-4 space-y-3 text-lg text-slate-700">
          <li>• Completed 10+2 (or equivalent) from a recognized board</li>
          <li>• Physics, Chemistry, and Mathematics (PCM) as core subjects</li>
          <li>
            • Minimum <strong>{MIN_AGGREGATE}% aggregate</strong> in PCM, with at least{' '}
            <strong>{MIN_PER_SUBJECT}%</strong> in each subject individually
          </li>
          <li>• A qualifying rank in KEAM (Kerala) or JEE Main</li>
          <li>• Minimum age of 17 at the time of admission</li>
        </ul>
      </div>

      <div className="rounded-3xl border-2 border-brand-200 bg-brand-50/40 p-6 md:p-8">
        <div className="mb-5 flex items-center gap-3">
          <GraduationCap className="h-8 w-8 text-brand-500" />
          <h2 className="text-2xl font-bold text-slate-900">Check Your Eligibility</h2>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <MarkInput label="Physics %" value={marks.physics} onChange={updateMark('physics')} />
          <MarkInput label="Chemistry %" value={marks.chemistry} onChange={updateMark('chemistry')} />
          <MarkInput label="Maths %" value={marks.maths} onChange={updateMark('maths')} />
        </div>

        {result && (
          <div
            className={`mt-6 rounded-2xl border-2 p-6 ${
              result.eligible ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'
            }`}
          >
            <div className="flex items-start gap-3">
              {result.eligible ? (
                <CheckCircle2 className="mt-1 h-8 w-8 shrink-0 text-green-600" />
              ) : (
                <XCircle className="mt-1 h-8 w-8 shrink-0 text-amber-600" />
              )}
              <div>
                <p className="text-xl font-bold text-slate-900">
                  {result.eligible
                    ? 'You meet the minimum eligibility criteria to apply.'
                    : 'You do not currently meet the minimum eligibility criteria.'}
                </p>
                <p className="mt-2 text-base text-slate-600">
                  Your PCM aggregate is <strong>{result.aggregate.toFixed(1)}%</strong>
                  {!result.meetsPerSubject && ' and at least one subject is below 50%'}.
                </p>
                {result.eligible && (
                  <p className="mt-3 text-sm text-slate-500">
                    This means you meet the baseline published requirement to apply. It is{' '}
                    <strong>not a guarantee of admission</strong> — actual seats are allotted
                    competitively based on your KEAM/JEE rank (Government quota) or merit list
                    position (Management/NRI/OCI quotas), and seat availability in your chosen
                    branch, which NAVIKA cannot predict.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
