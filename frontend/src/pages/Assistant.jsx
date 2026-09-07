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
  const [messages, setMessages] = useState([
    { speaker: 'NAVIKA', text: 'How can I help you?', timestamp: createTimestamp() },
    { speaker: 'USER', text: 'Who is the CSE HOD?', timestamp: createTimestamp() },
    { speaker: 'NAVIKA', text: 'The CSE Department is headed by Dr. Aisha Nair, with the department supporting software engineering, AI, and computational systems.', timestamp: createTimestamp() },
  ])
  const [loading, setLoading] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState('')
  const lastVoiceTranscriptRef = useRef('')
  const suggestions = useMemo(() => demoSuggestions, [])

  const handleAsk = async (submittedQuery = query) => {
    const trimmed = (submittedQuery || '').trim()
    if (!trimmed) return

    setMessages((current) => [...current, { speaker: 'USER', text: trimmed, timestamp: createTimestamp() }])
    setQuery('')
    setLoading(true)

    const response = await askNavika(trimmed)
    setLoading(false)

    setMessages((current) => [...current, { speaker: 'NAVIKA', text: response.text, timestamp: createTimestamp() }])

    if (response.kind === 'route') {
      setVoiceStatus('Route guidance ready for navigation.')
    }

    const speakResult = voiceControls.startVoiceResponse(response.text)
    if (!speakResult.ok) {
      setVoiceStatus(speakResult.message)
    }
  }

  const handleVoiceInput = () => {
    const result = voiceControls.startVoiceInput({
      onStart: () => setVoiceStatus('Listening...'),
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
      onEnd: () => setVoiceStatus('Voice input stopped. Press the mic again to keep speaking.'),
    })

    if (!result.ok) {
      setVoiceStatus(result.message)
      return
    }
  }

  const handleVoiceOutput = () => {
    const lastResponse = [...messages].reverse().find((message) => message.speaker === 'NAVIKA')
    const result = voiceControls.startVoiceResponse(lastResponse?.text || 'NAVIKA is ready to help.')
    if (!result.ok) {
      setVoiceStatus(result.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-emerald-300">NAVIKA AI ASSISTANT</div>
          <h2 className="mt-2 text-2xl font-semibold text-white">How can I help you?</h2>
        </div>
        <div className="flex gap-2">
          <VoiceButton label="Voice input" onClick={handleVoiceInput} />
          <VoiceButton label="Voice response" variant="output" onClick={handleVoiceOutput} />
        </div>
      </div>

      <Card className="p-4">
        <div className="mb-4">
          <SuggestedQuestions suggestions={suggestions} onSelect={handleAsk} />
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="max-h-[440px] overflow-y-auto pr-2">
            {messages.map((message, index) => (
              <ChatMessage key={`${message.speaker}-${index}`} speaker={message.speaker} text={message.text} timestamp={message.timestamp} />
            ))}
            {loading && <ChatMessage speaker="NAVIKA" text="" timestamp={createTimestamp()} isLoading />}
          </div>

          <div className="mt-4 flex gap-3">
            <VoiceButton label="Voice input" onClick={handleVoiceInput} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleAsk()
              }}
              placeholder="Ask something about the campus..."
              className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-400"
            />
            <Button onClick={() => handleAsk()} className="gap-2 rounded-xl px-4 py-3">
              <span>ASK NAVIKA</span>
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>

          {voiceStatus && <div className="mt-2 text-xs text-amber-200">{voiceStatus}</div>}
        </div>
      </Card>
    </div>
  )
}
