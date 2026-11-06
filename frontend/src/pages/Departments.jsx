import { useEffect, useMemo, useState } from 'react'
import { Building2, ExternalLink, UserRound } from 'lucide-react'
import { getDepartmentDirectory } from '../services/chatApi'

export default function Departments() {
  const [departments, setDepartments] = useState([])
  const [selectedCode, setSelectedCode] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDepartmentDirectory().then((data) => {
      setDepartments(data)
      setSelectedCode(data[0]?.code ?? null)
      setLoading(false)
    })
  }, [])

  const activeDepartment = useMemo(
    () => departments.find((department) => department.code === selectedCode),
    [departments, selectedCode]
  )

  if (loading) {
    return <p className="text-center text-lg font-semibold text-slate-500">Loading departments...</p>
  }

  if (departments.length === 0) {
    return (
      <div className="rounded-2xl border-[3px] border-ink-900 bg-white p-10 text-center shadow-[6px_6px_0_0_#160f0f]">
        <h1 className="text-3xl font-black text-ink-900">Departments unavailable</h1>
        <p className="mt-3 text-lg text-slate-500">Please check back later or ask NAVIKA directly.</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <h1 className="text-center text-4xl font-black tracking-tight text-ink-900 md:text-5xl">
        Departments
      </h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {departments.map((department) => (
          <button
            key={department.code}
            type="button"
            onClick={() => setSelectedCode(department.code)}
            className={`flex items-center gap-4 rounded-xl border-[3px] border-ink-900 px-5 py-5 text-left transition-all duration-150 ${
              selectedCode === department.code
                ? 'bg-brand-500 text-white shadow-[4px_4px_0_0_#160f0f]'
                : 'bg-white shadow-[3px_3px_0_0_#160f0f] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-brand-50 hover:shadow-[5px_5px_0_0_#160f0f]'
            }`}
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border-[3px] border-ink-900 bg-accent-300 text-ink-900">
              <Building2 className="h-6 w-6" />
            </div>
            <span className={`text-lg font-bold ${selectedCode === department.code ? 'text-white' : 'text-ink-900'}`}>{department.name}</span>
          </button>
        ))}
      </div>

      {activeDepartment && (
        <div className="rounded-2xl border-[3px] border-ink-900 bg-white p-6 shadow-[6px_6px_0_0_#160f0f] md:p-8">
          <h2 className="text-2xl font-black text-ink-900">{activeDepartment.name}</h2>

          {activeDepartment.hod && (
            <div className="mt-5 flex items-center gap-4 rounded-xl border-[3px] border-ink-900 bg-cream-50 p-4">
              {activeDepartment.hod.photo ? (
                <img
                  src={activeDepartment.hod.photo}
                  alt={activeDepartment.hod.name}
                  className="h-16 w-16 rounded-lg border-[3px] border-ink-900 object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border-[3px] border-ink-900 bg-white text-slate-400">
                  <UserRound className="h-8 w-8" />
                </div>
              )}
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-brand-600">
                  Head of Department
                </div>
                <div className="text-lg font-bold text-ink-900">{activeDepartment.hod.name}</div>
              </div>
            </div>
          )}

          {activeDepartment.description && (
            <p className="mt-5 text-lg leading-7 text-slate-700">{activeDepartment.description}</p>
          )}

          <a
            href={activeDepartment.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex items-center gap-2 rounded-xl border-[3px] border-ink-900 bg-accent-300 px-5 py-3 text-base font-bold text-ink-900 shadow-[3px_3px_0_0_#160f0f] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_#160f0f]"
          >
            View courses, seats & full details
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      )}
    </div>
  )
}
