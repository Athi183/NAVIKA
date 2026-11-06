import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'

const MAX_RESULTS = 8

// A combobox rather than a plain <select>: with ~190 faculty across 9
// departments, scrolling a native dropdown to find one name is exactly
// the friction this feature exists to remove. Typing "sheena" or
// "cyber security" narrows it instantly instead.
export default function FacultySearch({ faculty = [], onSelect, autoFocus = false }) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const inputRef = useRef(null)

  // autoFocus can't just run once on mount: `faculty` arrives async (see
  // Assistant.jsx's own fetch effect) and this component renders nothing
  // at all until it does (the `faculty.length === 0` guard below), so an
  // on-mount focus would fire before the input element even exists. Wait
  // for the directory to actually be there instead.
  useEffect(() => {
    if (autoFocus && faculty.length > 0) {
      inputRef.current?.focus()
      setIsOpen(true)
    }
  }, [autoFocus, faculty.length])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) {
      return faculty.slice(0, MAX_RESULTS)
    }
    return faculty
      .filter((person) =>
        person.name.toLowerCase().includes(needle) ||
        person.department.toLowerCase().includes(needle) ||
        person.designation.toLowerCase().includes(needle)
      )
      .slice(0, MAX_RESULTS)
  }, [faculty, query])

  if (faculty.length === 0) {
    return null
  }

  const handlePick = (person) => {
    setQuery('')
    setIsOpen(false)
    onSelect?.(person)
  }

  return (
    <div className="relative mb-4">
      <div className="flex items-center gap-2 rounded-xl border-[3px] border-ink-900 bg-white px-3.5 py-2.5 shadow-[3px_3px_0_0_#160f0f] transition-shadow focus-within:shadow-[5px_5px_0_0_#160f0f]">
        <Search className="h-4 w-4 shrink-0 text-ink-900" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={`Search ${faculty.length} faculty by name, department, or designation...`}
          className="w-full border-none text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
          onChange={(event) => {
            setQuery(event.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          // A plain onBlur would close the dropdown before a click on a
          // result ever registers (blur fires first) -- delaying it lets
          // the result button's onClick run, then closes the list.
          onBlur={() => setTimeout(() => setIsOpen(false), 150)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setIsOpen(false)
              inputRef.current?.blur()
            }
          }}
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            className="shrink-0 text-slate-400 hover:text-slate-600"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setQuery('')}
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        )}
      </div>

      {isOpen && (
        <div className="absolute z-10 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border-[3px] border-ink-900 bg-white shadow-[4px_4px_0_0_#160f0f]">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-400">No faculty match "{query}".</p>
          ) : (
            results.map((person) => (
              <button
                key={person.name}
                type="button"
                // onMouseDown (not onClick) fires before the input's onBlur
                // closes the list, so the click still lands on this row.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handlePick(person)}
                className="flex w-full items-center gap-3 border-b-2 border-ink-900/10 px-3 py-2.5 text-left last:border-b-0 hover:bg-accent-300"
              >
                {person.photo ? (
                  <img
                    src={person.photo}
                    alt={person.name}
                    loading="lazy"
                    className="h-10 w-10 shrink-0 rounded-lg border-[2px] border-ink-900 object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded-lg border-[2px] border-ink-900 bg-brand-100" />
                )}
                <div className="flex flex-col items-start gap-0.5">
                  <span className="text-sm font-medium text-slate-800">{person.name}</span>
                  <span className="text-xs text-slate-500">
                    {person.designation} · {person.department}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
