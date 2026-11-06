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
    return <p className="text-center text-lg text-slate-500">Loading departments...</p>
  }

  if (departments.length === 0) {
    return (
      <div className="rounded-3xl border-2 border-slate-200 bg-white p-10 text-center">
        <h1 className="text-3xl font-black text-slate-900">Departments unavailable</h1>
        <p className="mt-3 text-lg text-slate-500">Please check back later or ask NAVIKA directly.</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <h1 className="text-center text-4xl font-black tracking-tight text-slate-900 md:text-5xl">
        Departments
      </h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {departments.map((department) => (
          <button
            key={department.code}
            type="button"
            onClick={() => setSelectedCode(department.code)}
            className={`flex items-center gap-4 rounded-2xl border-2 px-5 py-5 text-left transition-colors ${
              selectedCode === department.code
                ? 'border-brand-500 bg-brand-50'
                : 'border-slate-200 bg-white hover:border-brand-300'
            }`}
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-500">
              <Building2 className="h-6 w-6" />
            </div>
            <span className="text-lg font-bold text-slate-900">{department.name}</span>
          </button>
        ))}
      </div>

      {activeDepartment && (
        <div className="rounded-3xl border-2 border-slate-200 bg-white p-6 md:p-8">
          <h2 className="text-2xl font-black text-slate-900">{activeDepartment.name}</h2>

          {activeDepartment.hod && (
            <div className="mt-5 flex items-center gap-4 rounded-2xl bg-slate-50 p-4">
              {activeDepartment.hod.photo ? (
                <img
                  src={activeDepartment.hod.photo}
                  alt={activeDepartment.hod.name}
                  className="h-16 w-16 rounded-full border border-slate-200 object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 text-slate-400">
                  <UserRound className="h-8 w-8" />
                </div>
              )}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Head of Department
                </div>
                <div className="text-lg font-bold text-slate-900">{activeDepartment.hod.name}</div>
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
            className="mt-6 inline-flex items-center gap-2 rounded-xl border-2 border-brand-200 px-5 py-3 text-base font-semibold text-brand-600 hover:border-brand-400"
          >
            View courses, seats & full details
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      )}
    </div>
  )
}
