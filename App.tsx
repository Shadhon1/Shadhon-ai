
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Mic, MicOff, MessageSquare, Volume2, Info, LogOut } from 'lucide-react';
import { TranscriptItem, ConnectionStatus } from './types';
import { decode, decodeAudioData, createPcmBlob } from './services/audioUtils';

const SADHAN_PROMPT = `তুমি একজন বুদ্ধিমান, বিনয়ী এবং অত্যন্ত সহায়ক এআই অ্যাসিস্ট্যান্ট। তোমার নাম সাধন। তোমার কাজ হলো ব্যবহারকারীকে সঠিক তথ্য দিয়ে সাহায্য করা এবং তাদের সাথে বন্ধুত্বপূর্ণ আলোচনা করা।
মূল নির্দেশাবলী:
- ভাষা: ব্যবহারকারী যে ভাষায় কথা বলবে (বাংলা বা ইংরেজি), তুমি সেই ভাষাতেই উত্তর দেবে। ভাষা সহজ এবং সাবলীল হতে হবে।
- আচরণ: সবসময় ইতিবাচক এবং সম্মানজনক আচরণ করবে। যদি কোনো প্রশ্নের উত্তর তোমার জানা না থাকে, তবে ভুল তথ্য না দিয়ে বিনয়ের সাথে তা স্বীকার করবে।
- উত্তর প্রদানের স্টাইল: উত্তরগুলো খুব বেশি বড় করবে না, পয়েন্ট আকারে লিখবে যাতে পড়তে সুবিধা হয়। প্রয়োজনে বোল্ড টেক্সট ব্যবহার করে গুরুত্বপূর্ণ অংশ হাইলাইট করবে। সবশেষে ব্যবহারকারীকে জিজ্ঞাসা করবে আর কোনো সাহায্য লাগবে কি না।`;

const VoiceBackground: React.FC<{ active: boolean }> = ({ active }) => {
  const bars = useMemo(() => Array.from({ length: 24 }), []);
  
  return (
    <div className="absolute inset-0 pointer-events-none flex items-end justify-center pb-0 opacity-10 transition-opacity duration-1000 overflow-hidden">
      <div className="wave-container px-4">
        {bars.map((_, i) => (
          <div
            key={i}
            className={`wave-bar ${active ? 'animate-wave' : ''}`}
            style={{
              height: active ? undefined : '20px',
              animationDelay: `${i * 0.1}s`,
              opacity: active ? 1 : 0.3,
              width: 'clamp(4px, 1.5vw, 10px)'
            }}
          />
        ))}
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentInput, setCurrentInput] = useState('');
  const [currentOutput, setCurrentOutput] = useState('');

  // Refs for audio and connection
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcripts
  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
    }
  }, [transcripts, currentInput, currentOutput]);

  const handleStop = useCallback(() => {
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch (e) {}
      sessionRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    audioSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    audioSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setStatus(ConnectionStatus.DISCONNECTED);
    setIsSpeaking(false);
  }, []);

  const handleStart = async () => {
    setStatus(ConnectionStatus.CONNECTING);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      // Initialize audio contexts
      if (!inputAudioCtxRef.current) {
        inputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      if (!outputAudioCtxRef.current) {
        outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SADHAN_PROMPT,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setStatus(ConnectionStatus.CONNECTED);
            // Setup microphone streaming
            const source = inputAudioCtxRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioCtxRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioCtxRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Transcriptions
            if (message.serverContent?.inputTranscription) {
              setCurrentInput(prev => prev + (message.serverContent?.inputTranscription?.text || ''));
            } else if (message.serverContent?.outputTranscription) {
              setCurrentOutput(prev => prev + (message.serverContent?.outputTranscription?.text || ''));
            }

            if (message.serverContent?.turnComplete) {
              // Finalize transcriptions for this turn
              setTranscripts(prev => [
                ...prev,
                { id: Math.random().toString(), sender: 'user', text: currentInput || '...', timestamp: new Date() },
                { id: Math.random().toString(), sender: 'sadhan', text: currentOutput || '...', timestamp: new Date() }
              ]);
              setCurrentInput('');
              setCurrentOutput('');
            }

            // Handle Audio
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData) {
              setIsSpeaking(true);
              const ctx = outputAudioCtxRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              
              source.addEventListener('ended', () => {
                audioSourcesRef.current.delete(source);
                if (audioSourcesRef.current.size === 0) setIsSpeaking(false);
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              audioSourcesRef.current.add(source);
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              audioSourcesRef.current.forEach(s => s.stop());
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setStatus(ConnectionStatus.ERROR);
            handleStop();
          },
          onclose: () => {
            setStatus(ConnectionStatus.DISCONNECTED);
            handleStop();
          }
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (error) {
      console.error("Failed to connect:", error);
      setStatus(ConnectionStatus.ERROR);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto shadow-2xl bg-white overflow-hidden relative border-x border-slate-200">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg">
            <Volume2 size={24} />
          </div>
          <div>
            <h1 className="font-bold text-lg text-slate-800 leading-tight">Sadhan AI (সাধন)</h1>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Smart Assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status === ConnectionStatus.CONNECTED && (
            <div className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full text-sm font-medium border border-green-200 animate-pulse">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              Live
            </div>
          )}
          <button className="p-2 text-slate-400 hover:bg-slate-50 rounded-full transition-colors">
            <Info size={20} />
          </button>
        </div>
      </header>

      {/* Main Conversation Area */}
      <main className="flex-1 overflow-hidden flex flex-col relative bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-indigo-50/30 via-white to-white">
        
        {/* Subtle Background Wave Visualizer */}
        <VoiceBackground active={isSpeaking} />

        {/* Visualizer / Avatar Area */}
        <div className="flex-shrink-0 py-12 flex flex-col items-center justify-center z-10">
          <div className={`relative w-48 h-48 flex items-center justify-center transition-all duration-500 ${isSpeaking ? 'scale-110' : 'scale-100'}`}>
            {/* Outer Rings */}
            <div className={`absolute inset-0 border-4 border-indigo-100 rounded-full ${isSpeaking ? 'animate-ping' : ''}`}></div>
            <div className={`absolute inset-4 border-2 border-indigo-200 rounded-full ${status === ConnectionStatus.CONNECTED ? 'animate-pulse' : ''}`}></div>
            
            {/* Core Avatar */}
            <div className={`w-32 h-32 rounded-full flex items-center justify-center z-10 transition-all duration-300 shadow-2xl ${
              status === ConnectionStatus.CONNECTED 
                ? 'bg-gradient-to-br from-indigo-500 to-indigo-700' 
                : 'bg-slate-300'
            }`}>
               {isSpeaking ? (
                 <div className="flex gap-1.5 h-10 items-center">
                    {[0.6, 0.4, 0.8, 0.5, 0.9, 0.7].map((h, i) => (
                      <div 
                        key={i} 
                        className="w-1.5 bg-white rounded-full animate-bounce"
                        style={{ height: `${h * 100}%`, animationDelay: `${i * 0.1}s` }}
                      />
                    ))}
                 </div>
               ) : (
                 <Mic size={48} className="text-white opacity-80" />
               )}
            </div>
          </div>
          
          <div className="mt-8 text-center px-6">
            <h2 className="text-xl font-semibold text-slate-800">
              {status === ConnectionStatus.DISCONNECTED ? "Sadhan is ready to help" : 
               status === ConnectionStatus.CONNECTING ? "Connecting to Sadhan..." :
               status === ConnectionStatus.CONNECTED ? (isSpeaking ? "Sadhan is speaking..." : "Listening to you...") :
               "Something went wrong"}
            </h2>
            <p className="text-slate-500 mt-1 max-w-xs mx-auto text-sm leading-relaxed">
              {status === ConnectionStatus.DISCONNECTED ? "Tap the microphone to start a conversation in Bengali or English." : 
               status === ConnectionStatus.CONNECTED ? "Speak naturally. Sadhan will respond in real-time." : ""}
            </p>
          </div>
        </div>

        {/* Transcripts Display */}
        <div 
          ref={transcriptScrollRef}
          className="flex-1 px-6 pb-8 overflow-y-auto space-y-4 scroll-smooth z-10"
        >
          {transcripts.map((item) => (
            <div 
              key={item.id} 
              className={`flex ${item.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[85%] px-4 py-3 rounded-2xl shadow-sm border ${
                item.sender === 'user' 
                  ? 'bg-slate-800 text-white border-slate-700' 
                  : 'bg-white text-slate-800 border-slate-200'
              }`}>
                <p className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: item.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                <span className="text-[10px] opacity-60 mt-1 block">
                  {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}
          
          {/* Ongoing Transcriptions */}
          {currentInput && (
            <div className="flex justify-end">
              <div className="max-w-[85%] px-4 py-3 rounded-2xl bg-slate-100/80 backdrop-blur-sm text-slate-500 italic text-sm animate-pulse border border-slate-200">
                {currentInput}...
              </div>
            </div>
          )}
          {currentOutput && (
            <div className="flex justify-start">
              <div className="max-w-[85%] px-4 py-3 rounded-2xl bg-indigo-50/80 backdrop-blur-sm text-indigo-900 text-sm animate-pulse border border-indigo-100">
                {currentOutput}...
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer Controls */}
      <footer className="bg-white border-t border-slate-200 p-6 flex flex-col items-center gap-4 z-20">
        <div className="flex items-center gap-4">
          {status === ConnectionStatus.CONNECTED ? (
            <button 
              onClick={handleStop}
              className="flex items-center justify-center w-16 h-16 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-lg shadow-red-200 transition-all transform active:scale-95 group"
            >
              <MicOff size={28} />
            </button>
          ) : (
            <button 
              onClick={handleStart}
              disabled={status === ConnectionStatus.CONNECTING}
              className={`flex items-center justify-center w-16 h-16 rounded-full shadow-lg transition-all transform active:scale-95 ${
                status === ConnectionStatus.CONNECTING 
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200'
              }`}
            >
              {status === ConnectionStatus.CONNECTING ? (
                 <div className="w-6 h-6 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <Mic size={28} />
              )}
            </button>
          )}
        </div>
        
        <div className="text-[11px] font-medium text-slate-400 flex items-center gap-4 uppercase tracking-[0.1em]">
          <span className="flex items-center gap-1"><MessageSquare size={12}/> English</span>
          <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
          <span className="flex items-center gap-1"><MessageSquare size={12}/> বাংলা</span>
        </div>
      </footer>

      {/* Empty State / Initial Instructions Overlay */}
      {transcripts.length === 0 && status === ConnectionStatus.DISCONNECTED && (
        <div className="absolute top-[60%] left-0 right-0 pointer-events-none flex justify-center opacity-40 z-10">
           <div className="animate-bounce">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 5V19M12 19L5 12M12 19L19 12" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
