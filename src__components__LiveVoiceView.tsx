import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Send, Volume2, VolumeX } from 'lucide-react';
import type { ForgeConfig, LocalDocument } from '../types/llm';
import { buildOfflineAnswer } from '../utils/offlineAssistant';
import { buildSystemInstruction } from '../utils/modelCatalog';
import { useOnlineStatus } from '../utils/pwa';

interface LiveVoiceViewProps {
  forgeConfig: ForgeConfig;
  documents: LocalDocument[];
}

interface VoiceTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

const VOICES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir'] as const;

function float32PcmToBase64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i += 1) {
    float32[i] = int16[i] / 0x8000;
  }
  return float32;
}

export function LiveVoiceView({ forgeConfig, documents }: LiveVoiceViewProps) {
  const isOnline = useOnlineStatus();
  const [voiceName, setVoiceName] = useState<(typeof VOICES)[number]>('Zephyr');
  const [sessionState, setSessionState] = useState<
    'idle' | 'connecting' | 'live' | 'offline-local'
  >('idle');
  const [muted, setMuted] = useState(false);
  const [statusNote, setStatusNote] = useState(
    'Ready for real-time voice streaming via gemini-3.8-live (16kHz in / 24kHz out).',
  );
  const [textInput, setTextInput] = useState('');
  const [turns, setTurns] = useState<VoiceTurn[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const mutedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length]);

  const stopPlaybackQueue = () => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Ignore already stopped source
      }
    }
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
  };

  const cleanupSession = () => {
    stopPlaybackQueue();
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => undefined);
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => undefined);
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  useEffect(() => {
    return () => {
      cleanupSession();
    };
  }, []);

  const appendTurn = (role: 'user' | 'assistant', chunkText: string, appendToLast: boolean) => {
    const clean = chunkText;
    if (!clean.trim()) return;
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (appendToLast && last && last.role === role) {
        return [
          ...prev.slice(0, -1),
          { ...last, text: `${last.text}${clean}` },
        ];
      }
      return [
        ...prev,
        {
          id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role,
          text: clean.trimStart(),
          timestamp: Date.now(),
        },
      ];
    });
  };

  const speakLocalOffline = (promptText: string) => {
    appendTurn('user', promptText, false);
    const answer = buildOfflineAnswer({
      prompt: promptText,
      modelId: 'gemini',
      forgeName: forgeConfig.name,
      documents,
      reasoningDepth: 'balanced',
      historyCount: turns.length + 1,
    });
    appendTurn('assistant', answer, false);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const plain = answer.replace(/[#*`>_-]/g, ' ').slice(0, 700);
      const utterance = new SpeechSynthesisUtterance(plain);
      utterance.rate = 1.02;
      window.speechSynthesis.speak(utterance);
    }
  };

  const playPcm24kChunk = (base64Audio: string) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;
    const samples = base64PcmToFloat32(base64Audio);
    if (samples.length === 0) return;

    const buffer = ctx.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(new Float32Array(samples), 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(nextStartTimeRef.current, ctx.currentTime);
    source.start(startAt);
    nextStartTimeRef.current = startAt + buffer.duration;

    activeSourcesRef.current.add(source);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
    };
  };

  const startLiveSession = async () => {
    if (sessionState === 'live' || sessionState === 'connecting') {
      cleanupSession();
      setSessionState('idle');
      setStatusNote('Voice conversation ended.');
      return;
    }

    if (!isOnline) {
      setSessionState('offline-local');
      setStatusNote(
        'Offline Local Speech Mode active — send a prompt below for spoken on-device RAG responses.',
      );
      return;
    }

    setSessionState('connecting');
    setStatusNote('Connecting to gemini-3.8-live real-time audio bridge...');

    try {
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = micStream;

      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const systemInstruction = buildSystemInstruction('forge', forgeConfig, []).slice(0, 1800);
      const wsUrl = `${wsProto}//${window.location.host}/api/live?voice=${encodeURIComponent(
        voiceName,
      )}&systemInstruction=${encodeURIComponent(systemInstruction)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        const source = inputCtx.createMediaStreamSource(micStream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (event) => {
          if (mutedRef.current || ws.readyState !== WebSocket.OPEN) return;
          const channel = event.inputBuffer.getChannelData(0);
          const audioBase64 = float32PcmToBase64(channel);
          ws.send(JSON.stringify({ audio: audioBase64 }));
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            data?: string;
            text?: string;
            message?: string;
          };

          if (msg.type === 'ready') {
            setSessionState('live');
            setStatusNote(`Live with gemini-3.8-live (${voiceName}) — speak naturally or type below.`);
          } else if (msg.type === 'audio' && msg.data) {
            playPcm24kChunk(msg.data);
          } else if (msg.type === 'inputTranscript' && msg.text) {
            appendTurn('user', msg.text, true);
          } else if (msg.type === 'outputTranscript' && msg.text) {
            appendTurn('assistant', msg.text, true);
          } else if (msg.type === 'interrupted') {
            stopPlaybackQueue();
          } else if (msg.type === 'error') {
            cleanupSession();
            setSessionState('offline-local');
            setStatusNote(
              msg.message ||
                'Live WebSocket unavailable here — switched to Offline Local Speech Mode.',
            );
          } else if (msg.type === 'closed') {
            cleanupSession();
            setSessionState('idle');
            setStatusNote('Live voice session closed.');
          }
        } catch {
          // Ignore malformed event
        }
      };

      ws.onerror = () => {
        cleanupSession();
        setSessionState('offline-local');
        setStatusNote(
          'Real-time WebSocket route requires Node runtime; using On-Device Local Speech Mode.',
        );
      };
    } catch (err: unknown) {
      cleanupSession();
      const message =
        err instanceof Error ? err.message : 'Microphone permission or audio setup failed.';
      setSessionState('offline-local');
      setStatusNote(`${message} Using On-Device Local Speech Mode.`);
    }
  };

  const handleSendTextTurn = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = textInput.trim();
    if (!clean) return;
    setTextInput('');

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      appendTurn('user', clean, false);
      wsRef.current.send(JSON.stringify({ text: clean }));
      return;
    }

    speakLocalOffline(clean);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-4 py-4 md:px-6 dark:border-slate-800 dark:bg-[#0F131B]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Live Voice Studio
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {statusNote}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label htmlFor="live-voice-select" className="sr-only">
              Select Gemini Live voice
            </label>
            <select
              id="live-voice-select"
              value={voiceName}
              disabled={sessionState === 'live' || sessionState === 'connecting'}
              onChange={(e) => setVoiceName(e.target.value as (typeof VOICES)[number])}
              className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 disabled:opacity-60 dark:border-slate-800 dark:bg-[#141923] dark:text-slate-200"
            >
              {VOICES.map((v) => (
                <option key={v} value={v}>
                  Voice: {v}
                </option>
              ))}
            </select>

            {sessionState === 'live' && (
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                aria-pressed={muted}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#141923] dark:text-slate-200"
              >
                {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                <span>{muted ? 'Unmute Mic' : 'Mute Mic'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={startLiveSession}
              className={`inline-flex h-9 items-center gap-2 rounded-lg px-4 text-xs font-semibold text-white transition-colors ${
                sessionState === 'live' || sessionState === 'connecting'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {sessionState === 'live' || sessionState === 'connecting' ? (
                <>
                  <MicOff className="h-3.5 w-3.5" />
                  <span>{sessionState === 'connecting' ? 'Connecting...' : 'End Voice'}</span>
                </>
              ) : (
                <>
                  <Mic className="h-3.5 w-3.5" />
                  <span>Start Live Voice</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {turns.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-[#121721] dark:text-slate-300">
              <p className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Real-Time Bidirectional Voice (`gemini-3.8-live`)
              </p>
              <p className="mt-2 leading-relaxed">
                Click <strong>Start Live Voice</strong> to open a bidirectional 16kHz/24kHz PCM stream with live input and output transcription, or send a message below to test local spoken RAG responses even offline.
              </p>
            </div>
          ) : (
            turns.map((turn) => (
              <div
                key={turn.id}
                className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-2xl rounded-xl border px-4 py-3 text-sm leading-relaxed ${
                    turn.role === 'user'
                      ? 'border-blue-200 bg-blue-50 text-slate-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-slate-100'
                      : 'border-slate-200 bg-white text-slate-800 dark:border-slate-800 dark:bg-[#121721] dark:text-slate-200'
                  }`}
                >
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {turn.role === 'user' ? 'You' : `Gemini Live (${voiceName})`}
                  </div>
                  <p className="whitespace-pre-wrap">{turn.text}</p>
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-4 py-3.5 md:px-6 dark:border-slate-800 dark:bg-[#0F131B]">
        <form onSubmit={handleSendTextTurn} className="mx-auto flex max-w-4xl items-center gap-3">
          <label htmlFor="live-voice-text-input" className="sr-only">
            Send text into voice session
          </label>
          <input
            id="live-voice-text-input"
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={
              sessionState === 'live'
                ? 'Inject a text message into the live audio session...'
                : 'Type a prompt for spoken local response (works offline)...'
            }
            className="h-10 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-[#141923] dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={!textInput.trim()}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-45"
          >
            <Send className="h-4 w-4" />
            <span>Speak</span>
          </button>
        </form>
      </div>
    </div>
  );
}
