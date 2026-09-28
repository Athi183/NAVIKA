import { demoSuggestions } from '../data/demoChat'
import { demoRoute } from '../data/demoMap'

// Shares navigationApi.js's VITE_API_BASE_URL (same backend host) but
// uses its own demo-mode flag rather than VITE_ENABLE_DEMO_MODE: the
// chat backend (/api/chat) is live, but the navigation backend
// (/destinations, /route) isn't implemented yet, so flipping one shared
// flag to turn on real chat would also silently break the working
// navigation demo by pointing it at endpoints that don't exist.
const baseUrl = import.meta.env.VITE_API_BASE_URL || ''
const demoMode = !baseUrl || import.meta.env.VITE_ENABLE_CHAT_DEMO_MODE === 'true'

const SESSION_STORAGE_KEY = 'navika-chat-session-id'

// One id per browser tab session (sessionStorage, not localStorage) so
// the backend's ConversationContext can thread follow-ups — "what about
// the vice principal" right after "who is the principal" — across
// separate askNavika() calls. Generated once and reused for every
// request in this tab; a fresh tab gets a fresh conversation.
function getSessionId() {
  try {
    let id = window.sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (!id) {
      id = crypto.randomUUID()
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, id)
    }
    return id
  } catch {
    // sessionStorage can throw in a locked-down/private browsing context —
    // fall back to a per-call id rather than breaking the chat entirely.
    // Conversation continuity is lost, but the assistant still answers.
    return crypto.randomUUID()
  }
}

// Names of macOS's classic "novelty" system voices (Fred, Bahh, Zarvox,
// Trinoids, etc.) — Safari's Web Speech API pulls from the same system
// voice list as everything else on the Mac, so without filtering these
// out, picking whatever voice happens to sort first can land on one of
// these instead of a normal-sounding one. Matched by exact voice name.
const NOVELTY_VOICE_NAMES = new Set([
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos',
  'wobble', 'fred', 'good news', 'jester', 'junior', 'kathy', 'organ',
  'superstar', 'ralph', 'trinoids', 'whisper', 'zarvox', 'eddy', 'flo',
  'grandma', 'grandpa', 'reed', 'rocko', 'sandy', 'shelley',
])

function scoreVoice(voice) {
  const name = voice.name.toLowerCase()

  if (NOVELTY_VOICE_NAMES.has(name)) return -1000
  if (!voice.lang.toLowerCase().startsWith('en')) return -500

  // Chrome ships its own cloud-quality "Google ..." voices, independent
  // of whatever's installed on the OS — clearly the best option when
  // present, so it outranks everything else including the OS default.
  if (name.includes('google')) return 100
  if (name.includes('natural') || name.includes('neural') || name.includes('premium') || name.includes('enhanced')) return 90
  if (voice.lang.toLowerCase() === 'en-us') return 50
  if (voice.default) return 40

  return 10
}

let cachedVoices = null

function pickBestVoice() {
  // getVoices() can return an empty list on the very first call in some
  // browsers (notably Chrome) until the async voiceschanged event fires.
  // Caching after the first non-empty read avoids re-picking (and
  // potentially re-scoring inconsistently) on every single utterance.
  if (!cachedVoices) {
    const voices = window.speechSynthesis.getVoices()
    if (voices.length > 0) {
      cachedVoices = voices
    }
  }

  if (!cachedVoices || cachedVoices.length === 0) return null

  return cachedVoices.reduce((best, voice) =>
    scoreVoice(voice) > scoreVoice(best) ? voice : best
  )
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoices = window.speechSynthesis.getVoices()
  }
}

// The LLM's answers are markdown-formatted ("**Dr. Neelakantan**", "- item"
// bullet lists, "## Heading"), which reads fine visually but SpeechSynthesis
// has no idea what markdown is — it reads every "*", "#", "_" and backtick
// out loud as a literal symbol. This strips markdown syntax down to plain
// words before anything is spoken, without touching what's displayed in
// the chat bubble (that still shows the raw markdown text as-is).
function stripMarkdownForSpeech(text) {
  return text
    // bullet/numbered list markers at the start of a line
    .replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, '')
    // headings: "## Heading" -> "Heading"
    .replace(/^#{1,6}[ \t]+/gm, '')
    // bold/italic emphasis: **text**, __text__, *text*, _text_ -> text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // inline/fenced code: `text` -> text
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    // anything left over (unpaired symbols) rather than reading it aloud
    .replace(/[*_#`]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

// Tracked so startVoiceResponse can always stop any in-progress
// recognition before speaking — closes the same feedback-loop risk for
// the "Voice response" replay button, not just the automatic
// ask-then-speak flow (which stops it directly, right on final result).
let activeRecognition = null

export const voiceControls = {
  startVoiceInput: ({ onStart, onResult, onInterimResult, onError, onEnd } = {}) => {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition ||
      window.mozSpeechRecognition ||
      window.msSpeechRecognition

    if (!SpeechRecognition) {
      return {
        ok: false,
        message:
          'Voice input is not supported in this browser. Please use Chrome or Edge on localhost/desktop, or continue with text input.',
      }
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.interimResults = true
    // continuous:true was the source of a much worse bug than the
    // interim-results one above: it keeps the microphone open
    // indefinitely, including while startVoiceResponse() is playing the
    // answer back through the speakers. Without headphones, the mic
    // picks that playback up as if it were new speech, transcribes it
    // (badly, since it's hearing synthesized audio through room
    // acoustics, not a person), and submits it as another question —
    // which is exactly the observed symptom: the first answer is fine,
    // then it starts "hearing" its own voice, glitches, and eventually
    // asks something unanswerable. One utterance per mic press (below)
    // plus stopping the instant a final result arrives (further down)
    // closes the mic before any audio ever plays back.
    recognition.continuous = false

    recognition.onstart = () => {
      onStart?.()
    }

    // With interimResults on, the browser fires onresult repeatedly while
    // the user is still mid-sentence — event.results contains BOTH
    // interim and final segments together, growing one word at a time
    // ("who", "who is", "who is the", ...). Treating every one of those
    // firings as a submitted question (the previous behavior: joining
    // *all* results and calling onResult on every firing) is what sent
    // each partial fragment to the backend as its own question — hence
    // one real sentence turning into a burst of incomplete ones, each
    // failing retrieval on its own. Only a result flagged `isFinal` is an
    // actual complete utterance; interim segments are surfaced via
    // onInterimResult purely for live captioning, and never submitted.
    recognition.onresult = (event) => {
      let interimTranscript = ''
      let finalTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ''

        if (result.isFinal) {
          finalTranscript += text
        } else {
          interimTranscript += text
        }
      }

      if (interimTranscript.trim()) {
        onInterimResult?.(interimTranscript.trim())
      }

      if (finalTranscript.trim()) {
        // Stop listening the instant we have a complete utterance,
        // rather than waiting on continuous/silence-detection timing —
        // this is what actually guarantees the mic is closed before the
        // answer comes back and gets spoken aloud.
        recognition.stop()
        onResult?.(finalTranscript.trim())
      }
    }

    recognition.onerror = (event) => {
      // 'aborted' fires when stopVoiceInput() cancels a session the user
      // started on purpose — that's not a failure, so don't show an
      // "unavailable" error for it; onEnd's own status message covers it.
      if (event.error === 'aborted') return
      onError?.('Voice input unavailable. You can continue using text.')
    }

    recognition.onend = () => {
      if (activeRecognition === recognition) {
        activeRecognition = null
      }
      onEnd?.()
    }

    // Starting a new mic session while one is somehow already open (the
    // mic button shouldn't allow this, but nothing else guarantees it)
    // would risk two overlapping recognizers on the same input — stop
    // any stale one first.
    activeRecognition?.stop()
    activeRecognition = recognition
    recognition.start()

    return {
      ok: true,
      message: 'Listening...',
    }
  },

  // Cancels an in-progress mic session — e.g. the mic was pressed by
  // accident, or the user wants to bail out without submitting whatever
  // was captured so far. abort() (not stop()) is deliberate: stop()
  // still delivers a final result for audio already captured, which
  // would submit a possibly-partial question the user was trying to
  // cancel, not just close the mic.
  stopVoiceInput: () => {
    activeRecognition?.abort()
  },

  startVoiceResponse: (text, { onStart, onEnd } = {}) => {
    if (!('speechSynthesis' in window)) {
      return {
        ok: false,
        message: 'Voice response unavailable in this browser.',
      }
    }

    // Belt-and-suspenders against the mic-hears-the-speaker feedback
    // loop: the automatic ask-then-speak flow already stops recognition
    // itself the moment it has a final transcript, but the separate
    // "Voice response" replay button calls straight into here with no
    // such guarantee, so stop here too before any audio plays.
    activeRecognition?.stop()

    const speechText = stripMarkdownForSpeech(text || 'NAVIKA is ready to help.')
    const utterance = new SpeechSynthesisUtterance(speechText)
    utterance.lang = 'en-US'
    utterance.rate = 0.95
    utterance.pitch = 1

    const voice = pickBestVoice()
    if (voice) {
      utterance.voice = voice
    }

    utterance.onstart = () => onStart?.()
    utterance.onend = () => onEnd?.()
    // cancel() (stopVoiceResponse, or the next speak() call replacing an
    // in-progress one) fires 'error' instead of 'end' — without handling
    // it here too, the caller's isSpeaking state gets stuck true forever
    // after a manual stop, which then makes the button look broken (it's
    // not that the click didn't register, it's that the UI still thinks
    // something is playing). Chrome reports 'canceled'/'interrupted' for
    // this, but the exact string isn't consistent across browsers/OS
    // versions — rather than trying to enumerate every variant, treat
    // ANY error as "no longer playing", since that's true regardless of
    // what the specific error code says.
    utterance.onerror = () => {
      onEnd?.()
    }

    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)

    return {
      ok: true,
      message: 'NAVIKA is speaking.',
    }
  },

  // Silences whatever NAVIKA is currently saying — the automatic
  // answer-then-speak playback and the manual "Voice response" replay
  // both go through startVoiceResponse above, so stopping here covers
  // either trigger.
  stopVoiceResponse: () => {
    window.speechSynthesis.cancel()
  },
}

async function askBackend(question) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: question, session_id: getSessionId() }),
  })

  if (!response.ok) {
    throw new Error(`NAVIKA backend returned ${response.status}`)
  }

  const data = await response.json()

  // Route-triggering (kind: 'route') is a separate system (indoor
  // navigation/pathfinding) the chat backend doesn't touch — every real
  // backend answer is plain info until that's wired up too.
  return {
    text: data.answer,
    kind: 'info',
  }
}

export async function askNavika(query) {
  const normalized = (query || '').trim()

  if (!normalized) {
    return {
      text: 'Please type a question about the campus or route guidance.',
      kind: 'info',
    }
  }

  if (!demoMode) {
    try {
      return await askBackend(normalized)
    } catch {
      return {
        text: "NAVIKA couldn't reach the campus assistant service right now. Please try again in a moment.",
        kind: 'info',
      }
    }
  }

  const lowerQuery = normalized.toLowerCase()

  if (demoMode && lowerQuery.includes('cse') && lowerQuery.includes('hod')) {
    return {
      text: 'The CSE Department is headed by Dr. Aisha Nair. She leads the department with a focus on software engineering, AI, and systems design.',
      kind: 'info',
    }
  }

  if (demoMode && lowerQuery.includes('department') && lowerQuery.includes('available')) {
    return {
      text: 'Available departments in the demo include CSE, ECE, Mechanical, Civil, MBA, and the Administrative block.',
      kind: 'info',
    }
  }

  if (demoMode && lowerQuery.includes('library')) {
    return {
      text: 'The central library is located on the first floor and is open for student access and research support.',
      kind: 'info',
    }
  }

  if (demoMode && lowerQuery.includes('facility')) {
    return {
      text: 'Campus facilities include the library, labs, auditorium, sports complex, cafeteria, and administrative services.',
      kind: 'info',
    }
  }

  if (
    demoMode &&
    (lowerQuery.includes('how do i get to') ||
      lowerQuery.includes('get to') ||
      lowerQuery.includes('where is') ||
      lowerQuery.includes('route')) &&
    lowerQuery.includes('cse')
  ) {
    return {
      text: 'The CSE Department is located on the first floor. A route is ready for navigation.',
      kind: 'route',
      route: demoRoute,
    }
  }

  return {
    text: 'NAVIKA is currently running in Demo Mode. Ask about departments, facilities, or route guidance using the sample prompts.',
    kind: 'info',
    suggestions: demoSuggestions,
  }
}

export async function getSuggestedQuestions() {
  return demoSuggestions
}
