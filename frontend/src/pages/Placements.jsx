import { useEffect, useMemo, useState } from 'react'
import { Briefcase, Building2, TrendingUp } from 'lucide-react'
import { getPlacementDirectory } from '../services/chatApi'

const TOP_RECRUITERS_SHOWN = 10

function StatTile({ icon: Icon, label, value, muted = false }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border-[3px] border-ink-900 bg-white p-6 shadow-[5px_5px_0_0_#160f0f]">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-[3px] border-ink-900 bg-accent-300 text-ink-900">
        <Icon className="h-7 w-7" />
      </div>
      <div>
        <div className="text-sm font-bold uppercase tracking-wide text-slate-500">{label}</div>
        <div className={`mt-1 text-3xl font-black ${muted ? 'text-slate-400' : 'text-ink-900'}`}>{value}</div>
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
        <span className="truncate pr-2 font-bold text-ink-900">{name}</span>
        <span className="shrink-0 font-black text-brand-600">{offers}</span>
      </div>
      <div className="h-4 w-full overflow-hidden rounded-full border-[2px] border-ink-900 bg-white">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${widthPercent}%` }} />
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
    return <p className="text-center text-lg font-semibold text-slate-500">Loading placement statistics...</p>
  }

  if (batches.length === 0) {
    return (
      <div className="rounded-2xl border-[3px] border-ink-900 bg-white p-10 text-center shadow-[6px_6px_0_0_#160f0f]">
        <h1 className="text-3xl font-black text-ink-900">Placement statistics unavailable</h1>
        <p className="mt-3 text-lg text-slate-500">Please check back later or ask NAVIKA directly.</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <h1 className="text-center text-4xl font-black tracking-tight text-ink-900 md:text-5xl">
        Placement Statistics
      </h1>

      <div className="flex flex-wrap justify-center gap-3">
        {batches.map((batch) => (
          <button
            key={batch.batchRange}
            type="button"
            onClick={() => setSelectedBatch(batch.batchRange)}
            className={`rounded-xl border-[3px] border-ink-900 px-6 py-4 text-xl font-bold transition-all duration-150 ${
              selectedBatch === batch.batchRange
                ? 'bg-brand-500 text-white shadow-[4px_4px_0_0_#160f0f]'
                : 'bg-white text-ink-900 shadow-[3px_3px_0_0_#160f0f] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-brand-50 hover:shadow-[5px_5px_0_0_#160f0f]'
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

          <div className="rounded-2xl border-[3px] border-ink-900 bg-white p-6 shadow-[5px_5px_0_0_#160f0f] md:p-8">
            <h2 className="mb-5 text-2xl font-black text-ink-900">Top Recruiters</h2>
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

          <div className="rounded-2xl border-[3px] border-ink-900 bg-white p-6 shadow-[5px_5px_0_0_#160f0f] md:p-8">
            <h2 className="mb-5 text-2xl font-black text-ink-900">
              All Recruiters ({activeBatch.recruiters.length})
            </h2>
            <div className="max-h-[480px] overflow-y-auto rounded-xl border-[3px] border-ink-900">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-accent-300 text-sm font-bold uppercase tracking-wide text-ink-900">
                  <tr>
                    <th className="border-b-[3px] border-ink-900 px-4 py-3">Recruiter</th>
                    <th className="border-b-[3px] border-ink-900 px-4 py-3">Offers</th>
                    <th className="border-b-[3px] border-ink-900 px-4 py-3">CTC</th>
                  </tr>
                </thead>
                <tbody>
                  {[...activeBatch.recruiters]
                    .sort((a, b) => b.offers - a.offers)
                    .map((recruiter) => (
                      <tr key={recruiter.recruiter} className="border-t border-ink-900/15">
                        <td className="px-4 py-3 font-semibold text-slate-800">{recruiter.recruiter}</td>
                        <td className="px-4 py-3 font-black text-brand-600">{recruiter.offers}</td>
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
