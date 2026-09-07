import { demoSuggestions } from '../data/demoChat'
import { demoRoute } from '../data/demoMap'

const demoMode = true

export const voiceControls = {
  startVoiceInput: ({ onStart, onResult, onError, onEnd } = {}) => {
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
    recognition.continuous = true

    recognition.onstart = () => {
      onStart?.()
    }

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? '')
        .join(' ')
        .trim()

      if (transcript) {
        onResult?.(transcript)
      }
    }

    recognition.onerror = () => {
      onError?.('Voice input unavailable. You can continue using text.')
    }

    recognition.onend = () => {
      onEnd?.()
    }

    recognition.start()

    return {
      ok: true,
      message: 'Listening...',
    }
  },

  startVoiceResponse: (text) => {
    if (!('speechSynthesis' in window)) {
      return {
        ok: false,
        message: 'Voice response unavailable in this browser.',
      }
    }

    const utterance = new SpeechSynthesisUtterance(text || 'NAVIKA is ready to help.')
    utterance.lang = 'en-US'
    utterance.rate = 1
    utterance.pitch = 1
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)

    return {
      ok: true,
      message: 'NAVIKA is speaking.',
    }
  },
}

export async function askNavika(query) {
  const normalized = (query || '').trim()

  if (!normalized) {
    return {
      text: 'Please type a question about the campus or route guidance.',
      kind: 'info',
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
