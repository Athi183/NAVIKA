import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ArrowUp, ChevronDown } from 'lucide-react'
import Button from '../components/common/Button'
import ChatMessage from '../components/ai/ChatMessage'
import FacultyFlashcard from '../components/ai/FacultyFlashcard'
import FacultySearch from '../components/ai/FacultySearch'
import SuggestedQuestions from '../components/ai/SuggestedQuestions'
import VoiceButton from '../components/ai/VoiceButton'
import { askNavika, getFacultyDirectory, voiceControls } from '../services/chatApi'
import { demoSuggestions } from '../data/demoChat'

// A stable id for the voice-response toggle (speakMessage below), since
// the flashcard isn't a chat message with its own id.
const FACULTY_CARD_ID = 'faculty-card'

// Faculty selected from the search dropdown are answered directly from
// the structured directory data (name/designation/department/interests
// parsed straight from the crawled staff pages -- see
// rag/faculty_directory.py), not by round-tripping through NAVIKA's own
// chat pipeline. That's deliberate, not just an optimization: this
// project has repeatedly hit Groq's rate limits, and a dropdown pick
// is exactly the kind of lookup that doesn't need an LLM call at all
// when the structured answer is already sitting in memory.
//
// Plain sentences, not markdown -- this only ever feeds speech (the
// flashcard itself renders the structured fields directly), so there's
// no markdown to strip and nothing for a filename-with-parentheses photo
// URL (see stripMarkdownForSpeech in chatApi.js) to leak into speech.
function facultySpeechText(person) {
  const parts = [`${person.name}.`, `${person.designation}, ${person.department}.`]
  if (person.location) parts.push(`Located at ${person.location}.`)
  if (person.interests.length > 0) parts.push(`Research interests: ${person.interests.join(', ')}.`)
  return parts.join(' ')
}

function createTimestamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// The browser's own Malayalam speech recognition (Web Speech API, 'ml-IN')
// has been observed to lose track of the language entirely once a spoken
// utterance includes a number -- a real Malayalam sentence like "2026
// ബാച്ചിലെ പ്ലേസ്മെന്റ് സ്ഥിതിവിവരക്കണക്കുകൾ" came back transcribed almost
// entirely as English words, with only the year itself surviving
// correctly. That's a limitation of the browser's own recognizer, not
// something this app's code can fix -- but silently submitting that
// botched, now-mostly-English transcript as if it were the real question
// is its own separate problem: it gets answered in English even though
// the person asked in Malayalam, which is confusing in a different way
// than an obviously-wrong transcript would be. Catching the specific
// signature of this failure (ML mode was selected, but the result that
// came back has no Malayalam script in it at all) and asking to repeat
// instead turns a silent wrong-language answer into a clear, actionable
// "that didn't come through right" moment.
const MALAYALAM_SCRIPT_PATTERN = /[ഀ-ൿ]/

export default function Assistant() {
  const [query, setQuery] = useState('')
  const nextMessageId = useRef(1)
  const [messages, setMessages] = useState([
    { id: 0, speaker: 'NAVIKA', text: 'How can I help you?', timestamp: createTimestamp() },
  ])
  const [loading, setLoading] = useState(false)
  const [facultyDirectory, setFacultyDirectory] = useState([])
  // The faculty member currently shown in the centered flashcard popup
  // (see FacultyFlashcard), or null when it's closed.
  const [facultyCard, setFacultyCard] = useState(null)
  // Collapsed by default -- six chips sitting open above every chat felt
  // crowded; tucking them behind a toggle keeps the first screen mostly
  // just the faculty search and the chat itself.
  const [isSampleQuestionsOpen, setIsSampleQuestionsOpen] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState('')
  const [isListening, setIsListening] = useState(false)
  // Which language the mic listens for — has to be chosen up front,
  // unlike typed text: a speech recognizer needs to know what language
  // to expect *before* it starts listening, it can't detect that from
  // the audio after the fact the way clean_text() can detect Malayalam
  // script from typed text. Voice *output* has no such constraint — it's
  // auto-detected per response in chatApi.js from the answer text itself.
  const [inputLang, setInputLang] = useState('en')
  // Which message is currently being spoken, by id — not a plain
  // isSpeaking boolean, since a per-message speaker button (below) needs
  // to know specifically WHICH message that is, and only one utterance
  // can ever be playing at once regardless of which button started it.
  const [speakingMessageId, setSpeakingMessageId] = useState(null)
  const lastVoiceTranscriptRef = useRef('')
  const suggestions = useMemo(() => demoSuggestions, [])

  // A kiosk home-screen button (Home.jsx) can deep-link straight into an
  // answer instead of landing on an empty chat -- navigate('/assistant',
  // { state: { presetQuery: '...' } }) for a one-tap question, or
  // { state: { focusFacultySearch: true } } to land with the faculty
  // search box already open. location.state is read once on mount only
  // (see the two effects below); it's not meant to react to later
  // in-page navigation.
  const location = useLocation()
  const [focusFacultySearch] = useState(() => Boolean(location.state?.focusFacultySearch))

  // Fetched once per page load, not per keystroke in FacultySearch --
  // it's a stable list until the site is re-crawled and the backend
  // restarted, so there's nothing to gain from re-fetching it on every
  // search.
  useEffect(() => {
    getFacultyDirectory().then(setFacultyDirectory)
  }, [])

  // Single toggle shared by the header "Voice response" button and every
  // per-message speaker button: pressing the control for whichever
  // message is already playing stops it; pressing any other one starts
  // (and replaces) playback for that message instead.
  const speakMessage = (id, text) => {
    if (speakingMessageId === id) {
      voiceControls.stopVoiceResponse()
      setSpeakingMessageId(null)
      return
    }

    const result = voiceControls.startVoiceResponse(text, {
      onStart: () => setSpeakingMessageId(id),
      onEnd: () => setSpeakingMessageId((current) => (current === id ? null : current)),
    })

    if (!result.ok) {
      setVoiceStatus(result.message)
    }
  }

  const handleAsk = async (submittedQuery = query) => {
    const trimmed = (submittedQuery || '').trim()
    if (!trimmed) return

    setMessages((current) => [...current, { id: nextMessageId.current++, speaker: 'USER', text: trimmed, timestamp: createTimestamp() }])
    setQuery('')
    setLoading(true)

    const response = await askNavika(trimmed)
    setLoading(false)

    const responseId = nextMessageId.current++
    setMessages((current) => [...current, { id: responseId, speaker: 'NAVIKA', text: response.text, timestamp: createTimestamp() }])

    if (response.kind === 'route') {
      setVoiceStatus('Route guidance ready for navigation.')
    }

    speakMessage(responseId, response.text)
  }

  // Fires once on page load when a kiosk home-screen button sent a
  // preset question (see the location.state comment above) -- the
  // empty dependency array plus the ref guard means this can never
  // re-fire on a later re-render, only on the initial mount.
  const hasAskedPreset = useRef(false)
  useEffect(() => {
    const presetQuery = location.state?.presetQuery
    if (presetQuery && !hasAskedPreset.current) {
      hasAskedPreset.current = true
      handleAsk(presetQuery)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Answers instantly from the already-fetched directory data instead of
  // calling handleAsk/askNavika -- no backend round trip, no LLM call.
  // Opens the flashcard rather than posting chat bubbles: this is a
  // single self-contained lookup, not part of the conversation transcript.
  const handleFacultySelect = (person) => {
    setFacultyCard(person)
    speakMessage(FACULTY_CARD_ID, facultySpeechText(person))
  }

  const closeFacultyCard = () => {
    if (speakingMessageId === FACULTY_CARD_ID) {
      voiceControls.stopVoiceResponse()
      setSpeakingMessageId(null)
    }
    setFacultyCard(null)
  }

  const handleVoiceInput = () => {
    // Toggle: pressing the mic again while it's already listening cancels
    // it instead of starting a second, overlapping session — this is the
    // only way to back out of voice input without either waiting for the
    // browser's own silence detection or submitting a partial sentence.
    if (isListening) {
      voiceControls.stopVoiceInput()
      return
    }

    const result = voiceControls.startVoiceInput({
      lang: inputLang,
      onStart: () => {
        setIsListening(true)
        // Kept in English regardless of inputLang rather than hardcoding
        // a Malayalam translation here — the toggle buttons already show
        // which mode is active, and this is just a status line, not
        // something whose correctness the bilingual feature itself
        // depends on (unlike the actual chat responses, which the LLM
        // generates natively rather than a hardcoded string here).
        setVoiceStatus(`Listening for ${inputLang === 'ml' ? 'Malayalam' : 'English'}... (press the mic again to stop)`)
      },
      // Live captioning only — this fires repeatedly while the user is
      // still mid-sentence, so it must never itself trigger handleAsk.
      onInterimResult: (transcript) => setQuery(transcript),
      // Fires once per complete sentence (see chatApi.js) — this is the
      // only place a voice question actually gets submitted.
      onResult: (transcript) => {
        const cleanedTranscript = transcript.trim()
        if (!cleanedTranscript || cleanedTranscript === lastVoiceTranscriptRef.current) {
          return
        }

        // See MALAYALAM_SCRIPT_PATTERN above: ML mode selected, but the
        // browser's recognizer produced no Malayalam script at all --
        // the transcript is kept in the input box (so it's visible and
        // editable) but NOT auto-submitted, rather than silently sending
        // a botched, likely-wrong-language question and getting an
        // English answer back to a Malayalam question.
        if (inputLang === 'ml' && !MALAYALAM_SCRIPT_PATTERN.test(cleanedTranscript)) {
          lastVoiceTranscriptRef.current = cleanedTranscript
          setQuery(cleanedTranscript)
          setVoiceStatus("Didn't catch that in Malayalam — try speaking again, or edit the text below before sending.")
          return
        }

        lastVoiceTranscriptRef.current = cleanedTranscript
        setQuery(cleanedTranscript)
        setVoiceStatus('Voice captured and sent to NAVIKA.')
        handleAsk(cleanedTranscript)
      },
      onError: (message) => setVoiceStatus(message),
      onEnd: () => {
        setIsListening(false)
        setVoiceStatus('Voice input stopped. Press the mic again to keep speaking.')
      },
    })

    if (!result.ok) {
      setVoiceStatus(result.message)
      return
    }
  }

  const lastNavikaMessage = [...messages].reverse().find((message) => message.speaker === 'NAVIKA')
  const isHeaderSpeaking = lastNavikaMessage != null && speakingMessageId === lastNavikaMessage.id

  return (
    <div className="space-y-5">
      <div className="relative rounded-2xl border-[3px] border-ink-900 bg-ink-900 p-5 shadow-[6px_6px_0_0_#d8151c]">
        <span className="absolute -top-3 left-5 -rotate-3 rounded-md border-[2px] border-ink-900 bg-accent-400 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-ink-900">
          Online now
        </span>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-brand-400">NAVIKA AI ASSISTANT</div>
            <h2 className="mt-2 text-2xl font-black text-white">How can I help you?</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border-[2px] border-white/20 p-1 text-xs font-bold" title="Voice input language">
              {[
                { code: 'en', label: 'EN' },
                { code: 'ml', label: 'ML' },
              ].map(({ code, label }) => (
                <button
                  key={code}
                  type="button"
                  disabled={isListening}
                  onClick={() => setInputLang(code)}
                  className={`rounded px-2.5 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    inputLang === code ? 'bg-accent-400 text-ink-900' : 'text-white/60 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <VoiceButton label={isListening ? "Stop listening" : "Voice input"} active={isListening} onClick={handleVoiceInput} />
            <VoiceButton
              label={isHeaderSpeaking ? "Stop speaking" : "Voice response"}
              active={isHeaderSpeaking}
              variant="output"
              onClick={() => lastNavikaMessage && speakMessage(lastNavikaMessage.id, lastNavikaMessage.text)}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border-[3px] border-ink-900 bg-white p-4 shadow-[6px_6px_0_0_#160f0f]">
        {/* Only shown when this page was opened from the dedicated "Find a
            Teacher" tile (Home.jsx) -- the generic "Ask Anything" chat
            already has its own way to ask about a teacher (typing the
            question), so showing this same dropdown there too would just
            be a second, redundant way to do the same lookup. */}
        {focusFacultySearch && (
          <FacultySearch faculty={facultyDirectory} onSelect={handleFacultySelect} autoFocus={focusFacultySearch} />
        )}

        <div className="mb-4">
          <button
            type="button"
            onClick={() => setIsSampleQuestionsOpen((open) => !open)}
            aria-expanded={isSampleQuestionsOpen}
            className="flex w-full items-center justify-between rounded-xl border-[3px] border-ink-900 bg-brand-100 px-3.5 py-2.5 text-sm font-extrabold text-ink-900 transition hover:bg-brand-200"
          >
            <span>Sample Questions</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isSampleQuestionsOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {isSampleQuestionsOpen && (
            <div className="mt-3">
              <SuggestedQuestions suggestions={suggestions} onSelect={handleAsk} />
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-xl border-[3px] border-ink-900 bg-cream-50 p-4">
          <div className="max-h-[440px] overflow-y-auto pr-2">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                speaker={message.speaker}
                text={message.text}
                timestamp={message.timestamp}
                isSpeaking={speakingMessageId === message.id}
                onToggleSpeak={message.speaker === 'NAVIKA' ? () => speakMessage(message.id, message.text) : undefined}
              />
            ))}
            {loading && <ChatMessage speaker="NAVIKA" text="" timestamp={createTimestamp()} isLoading />}
          </div>

          <div className="mt-4 flex gap-3">
            <VoiceButton label={isListening ? "Stop listening" : "Voice input"} active={isListening} onClick={handleVoiceInput} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleAsk()
              }}
              placeholder="Ask something about the campus..."
              className="flex-1 rounded-xl border-[3px] border-ink-900 bg-white px-4 py-3 text-sm text-ink-900 outline-none placeholder:text-slate-400"
            />
            <Button variant="brutal" onClick={() => handleAsk()} className="gap-2 rounded-xl px-5 py-3">
              <span>ASK NAVIKA</span>
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>

          {voiceStatus && (
            <div className="mt-2 inline-block rounded-md border-[2px] border-ink-900 bg-accent-300 px-3 py-1 text-xs font-bold text-ink-900">
              {voiceStatus}
            </div>
          )}
        </div>
      </div>

      <FacultyFlashcard
        person={facultyCard}
        onClose={closeFacultyCard}
        isSpeaking={speakingMessageId === FACULTY_CARD_ID}
        onToggleSpeak={() => facultyCard && speakMessage(FACULTY_CARD_ID, facultySpeechText(facultyCard))}
      />
    </div>
  )
}
