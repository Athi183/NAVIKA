import { useEffect, useMemo, useState } from 'react'
import { Briefcase, Building2, TrendingUp } from 'lucide-react'
import { getPlacementDirectory } from '../services/chatApi'

const TOP_RECRUITERS_SHOWN = 10

function StatTile({ icon: Icon, label, value, muted = false }) {
  return (
    <div className="flex items-center gap-4 rounded-3xl border-2 border-slate-200 bg-white p-6">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-500">
        <Icon className="h-7 w-7" />
      </div>
      <div>
        <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <div className={`mt-1 text-3xl font-black ${muted ? 'text-slate-400' : 'text-slate-900'}`}>{value}</div>
      </div>
    </div>
  )
}

// Hand-rolled bars instead of a charting library -- no extra dependency
// to install right before a kiosk demo, and large static bars read more
// clearly on a touch kiosk than a hover-tooltip chart would anyway (there
// is no mouse hovering a kiosk screen).
function RecruiterBar({ name, offers, maxOffers }) {
  const widthPercent = Math.max(4, Math.round((offers / maxOffers) * 100))
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="truncate pr-2 font-semibold text-slate-700">{name}</span>
        <span className="shrink-0 font-bold text-brand-500">{offers}</span>
      </div>
      <div className="h-4 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-400" style={{ width: `${widthPercent}%` }} />
      </div>
    </div>
  )
}

export default function Placements() {
  const [batches, setBatches] = useState([])
  const [selectedBatch, setSelectedBatch] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPlacementDirectory().then((data) => {
      setBatches(data)
      setSelectedBatch(data[0]?.batchRange ?? null)
      setLoading(false)
    })
  }, [])

  const activeBatch = useMemo(
    () => batches.find((batch) => batch.batchRange === selectedBatch),
    [batches, selectedBatch]
  )

  const topRecruiters = useMemo(() => {
    if (!activeBatch) return []
    return [...activeBatch.recruiters]
      .sort((a, b) => b.offers - a.offers)
      .slice(0, TOP_RECRUITERS_SHOWN)
  }, [activeBatch])

  const maxOffers = topRecruiters[0]?.offers ?? 1

  if (loading) {
    return <p className="text-center text-lg text-slate-500">Loading placement statistics...</p>
  }

  if (batches.length === 0) {
    return (
      <div className="rounded-3xl border-2 border-slate-200 bg-white p-10 text-center">
        <h1 className="text-3xl font-black text-slate-900">Placement statistics unavailable</h1>
        <p className="mt-3 text-lg text-slate-500">Please check back later or ask NAVIKA directly.</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <h1 className="text-center text-4xl font-black tracking-tight text-slate-900 md:text-5xl">
        Placement Statistics
      </h1>

      <div className="flex flex-wrap justify-center gap-3">
        {batches.map((batch) => (
          <button
            key={batch.batchRange}
            type="button"
            onClick={() => setSelectedBatch(batch.batchRange)}
            className={`rounded-2xl border-2 px-6 py-4 text-xl font-bold transition-colors ${
              selectedBatch === batch.batchRange
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300'
            }`}
          >
            {batch.batchRange.replace('-', ' – ')}
          </button>
        ))}
      </div>

      {activeBatch && (
        <>
          <div className="grid gap-5 sm:grid-cols-3">
            <StatTile icon={Briefcase} label="Total Offers" value={activeBatch.totalOffers ?? 'N/A'} />
            <StatTile
              icon={TrendingUp}
              label="Highest Package"
              value={activeBatch.highestPackage ?? 'Not published'}
              muted={!activeBatch.highestPackage}
            />
            <StatTile icon={Building2} label="Companies" value={activeBatch.recruiters.length} />
          </div>

          <div className="rounded-3xl border-2 border-slate-200 bg-white p-6 md:p-8">
            <h2 className="mb-5 text-2xl font-bold text-slate-900">Top Recruiters</h2>
            <div className="space-y-4">
              {topRecruiters.map((recruiter) => (
                <RecruiterBar
                  key={recruiter.recruiter}
                  name={recruiter.recruiter}
                  offers={recruiter.offers}
                  maxOffers={maxOffers}
                />
              ))}
            </div>
          </div>

          <div className="rounded-3xl border-2 border-slate-200 bg-white p-6 md:p-8">
            <h2 className="mb-5 text-2xl font-bold text-slate-900">
              All Recruiters ({activeBatch.recruiters.length})
            </h2>
            <div className="max-h-[480px] overflow-y-auto rounded-xl border border-slate-100">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-slate-50 text-sm uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Recruiter</th>
                    <th className="px-4 py-3">Offers</th>
                    <th className="px-4 py-3">CTC</th>
                  </tr>
                </thead>
                <tbody>
                  {[...activeBatch.recruiters]
                    .sort((a, b) => b.offers - a.offers)
                    .map((recruiter) => (
                      <tr key={recruiter.recruiter} className="border-t border-slate-100">
                        <td className="px-4 py-3 font-semibold text-slate-800">{recruiter.recruiter}</td>
                        <td className="px-4 py-3 font-bold text-brand-500">{recruiter.offers}</td>
                        <td className="px-4 py-3 text-slate-600">{recruiter.ctc}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
