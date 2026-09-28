import { useMemo, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import Button from '../components/common/Button'
import Card from '../components/common/Card'
import ChatMessage from '../components/ai/ChatMessage'
import SuggestedQuestions from '../components/ai/SuggestedQuestions'
import VoiceButton from '../components/ai/VoiceButton'
import { askNavika, voiceControls } from '../services/chatApi'
import { demoSuggestions } from '../data/demoChat'

function createTimestamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function Assistant() {
  const [query, setQuery] = useState('')
  const nextMessageId = useRef(1)
  const [messages, setMessages] = useState([
    { id: 0, speaker: 'NAVIKA', text: 'How can I help you?', timestamp: createTimestamp() },
  ])
  const [loading, setLoading] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState('')
  const [isListening, setIsListening] = useState(false)
  // Which message is currently being spoken, by id — not a plain
  // isSpeaking boolean, since a per-message speaker button (below) needs
  // to know specifically WHICH message that is, and only one utterance
  // can ever be playing at once regardless of which button started it.
  const [speakingMessageId, setSpeakingMessageId] = useState(null)
  const lastVoiceTranscriptRef = useRef('')
  const suggestions = useMemo(() => demoSuggestions, [])

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
      onStart: () => {
        setIsListening(true)
        setVoiceStatus('Listening... (press the mic again to stop)')
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
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-brand-500">NAVIKA AI ASSISTANT</div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">How can I help you?</h2>
        </div>
        <div className="flex gap-2">
          <VoiceButton label={isListening ? "Stop listening" : "Voice input"} active={isListening} onClick={handleVoiceInput} />
          <VoiceButton
            label={isHeaderSpeaking ? "Stop speaking" : "Voice response"}
            active={isHeaderSpeaking}
            variant="output"
            onClick={() => lastNavikaMessage && speakMessage(lastNavikaMessage.id, lastNavikaMessage.text)}
          />
        </div>
      </div>

      <Card className="p-4">
        <div className="mb-4">
          <SuggestedQuestions suggestions={suggestions} onSelect={handleAsk} />
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
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
              className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500"
            />
            <Button onClick={() => handleAsk()} className="gap-2 rounded-xl px-4 py-3">
              <span>ASK NAVIKA</span>
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>

          {voiceStatus && <div className="mt-2 text-xs text-brand-500">{voiceStatus}</div>}
        </div>
      </Card>
    </div>
  )
}
