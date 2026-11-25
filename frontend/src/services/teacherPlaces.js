// Teachers on the kiosk map: the Ask NAVIKA faculty directory (/api/faculty,
// rag/faculty_directory.py) gives each teacher's department; this links a
// department to its office on the map. The directory has no cabin numbers,
// so a teacher's route ends at their department office, where staff can
// point to the cabin.

// Department (as the faculty directory names it) -> the office's destination id.
export const DEPARTMENT_OFFICES = {
  'Computer Science & Engineering': 'rb2_room_301',
  'Artificial Intelligence & Data Science': 'rb4_room_504',
  'Cyber Security': 'rb6_room_703',
  'Electrical & Electronics Engineering': 'rb1_eee_department',
  'Computer Applications': 'mg1_dept_computer_applications',
  'Civil Engineering': 'mg2_pdf15',
  'Mechanical Engineering': 'mg3_pdf17',
  'Electronics & Communication Engineering': 'mg3_pdf26',
  'Basic Science and Humanities': 'mg4_pdf20',
}

/** The office on the map for `person`'s department, or null when it is not mapped. */
export function teacherOffice(model, person) {
  const id = DEPARTMENT_OFFICES[person?.department]
  return (id && model.destinations.find((place) => place.id === id)) || null
}

// Titles are left out when matching: "dr anu" and "anu" both find "Dr. Anu Mary".
const plain = (text) => text.toLowerCase().replace(/\b(dr|prof|mr|mrs|ms|er)\b\.?/g, ' ').replace(/[^a-z]+/g, ' ').trim()

/** Teachers whose name matches `query` (3+ letters): whole name, or the start of any part of it. */
export function searchTeachers(faculty, query, limit = 6) {
  const wanted = plain(query)
  if (wanted.length < 3) return []
  return faculty.filter((person) => {
    const name = plain(person.name)
    return name.includes(wanted) || name.split(' ').some((part) => part.startsWith(wanted))
  }).slice(0, limit)
}
