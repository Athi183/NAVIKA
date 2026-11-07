// Each of these was verified directly against the live backend (not
// guessed) to give a clean, confident answer -- see
// rag/test_retrieval_suite.py and this session's live testing. A couple
// of originally-tempting questions were deliberately left out: "Where is
// the library?" currently has no precise on-campus location data for
// the main library (it's a separate building not covered by the DXF
// floor-plan data this app has), and "How do I get to the CSE
// Department?" triggers an honest "no verified route" disclaimer rather
// than a clean answer -- both are real, working behavior, just not a
// good first impression for a suggested-question chip.
export const demoSuggestions = [
  'Who is the principal?',
  'Who is the HOD of CSE?',
  'What departments are available?',
  'What are the admission requirements?',
  'What facilities does the CSE department have?',
  'What are the placement statistics for the 2022-2026 batch?',
]

export const demoConversation = [
  {
    speaker: 'NAVIKA',
    text: 'How can I help you today?',
    timestamp: '09:41 AM',
  },
  {
    speaker: 'USER',
    text: 'Who is the CSE HOD?',
    timestamp: '09:42 AM',
  },
  {
    speaker: 'NAVIKA',
    text: 'The CSE Department is headed by Dr. Aisha Nair, with the department supporting software engineering, AI, and computational systems.',
    timestamp: '09:42 AM',
  },
]
