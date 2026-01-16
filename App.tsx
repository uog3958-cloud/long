
import React, { useState } from 'react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Genre, Tone, WorkMode, ScriptResult, FinalAssets } from './types';
import JSZip from 'jszip';

const App: React.FC = () => {
  // UI States
  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMsg, setLoadingMsg] = useState<string>("");

  // Config States
  const [selectedGenres, setSelectedGenres] = useState<Genre[]>([]);
  const [selectedTone, setSelectedTone] = useState<Tone>(Tone.FRIENDLY);
  const [workMode, setWorkMode] = useState<WorkMode>(WorkMode.NEW);
  
  // Synopsis Input States
  const [subject, setSubject] = useState("");
  const [protagonist, setProtagonist] = useState("");
  const [background, setBackground] = useState("");
  const [incident, setIncident] = useState("");
  const [emotion, setEmotion] = useState("");
  const [synopsis, setSynopsis] = useState("");

  // Generation Results
  const [finalAssets, setFinalAssets] = useState<FinalAssets | null>(null);

  const toggleGenre = (genre: Genre) => {
    setSelectedGenres(prev => 
      prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]
    );
  };

  const handleGenerateSynopsis = async () => {
    setLoading(true);
    setLoadingMsg("AI가 깊이 있는 롱폼 시나리오를 구성 중입니다...");
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `
        다음 정보를 바탕으로 유튜브 롱폼(5~10분 분량) 영상 시놉시스를 작성해줘.
        장르: ${selectedGenres.join(', ')}
        어조: ${selectedTone}
        주인공: ${protagonist}
        배경: ${background}
        핵심 사건: ${incident}
        핵심 감정: ${emotion}
        내용 요약: ${subject}
        
        시놉시스는 기-승-전-결의 갈등 구조가 명확하게 드러나도록 약 1000자 내외로 상세하게 작성해줘.
      `;
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt
      });
      setSynopsis(response.text || "");
    } catch (error) {
      console.error(error);
      alert("시놉시스 생성 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleFullGenerate = async () => {
    setLoading(true);
    setLoadingMsg("롱폼 대본 구성, 시네마틱 이미지, 전문 나레이션 생성 중...");
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      // 1. Long-form Script & Image Prompt Generation (Gemini 3 Pro for complex reasoning)
      const scriptPrompt = `
        시놉시스를 바탕으로 정교한 롱폼 영상 대본을 작성해줘.
        시놉시스: ${synopsis}
        어조: ${selectedTone}

        요구사항:
        1. JSON 형식으로 응답해줘.
        2. 필드: 
           - title: 영상 제목
           - intro: 시청자를 사로잡는 오프닝 (약 200자)
           - development: 사건의 시작과 전개 (약 600자)
           - climax: 갈등의 폭발과 절정 (약 600자)
           - resolution: 사건의 해결 (약 400자)
           - outro: 엔딩 멘트 및 여운 (약 200자)
           - imagePrompt: 이 영상의 가장 상징적인 장면을 묘사한 고품질 시네마틱 이미지 생성용 영문 프롬프트
      `;

      const scriptResponse = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: scriptPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              intro: { type: Type.STRING },
              development: { type: Type.STRING },
              climax: { type: Type.STRING },
              resolution: { type: Type.STRING },
              outro: { type: Type.STRING },
              imagePrompt: { type: Type.STRING }
            },
            required: ["title", "intro", "development", "climax", "resolution", "outro", "imagePrompt"]
          }
        }
      });

      const scriptData: ScriptResult = JSON.parse(scriptResponse.text || "{}");

      // 2. High Quality Image Generation
      let imageUrl = "";
      const imageResponse = await ai.models.generateContent({
        model: "gemini-3-pro-image-preview", // 롱폼에 걸맞는 고화질 모델
        contents: `A high-quality cinematic movie poster style visual: ${scriptData.imagePrompt}. Professional lighting, 4k resolution, emotional atmosphere, no text.`,
        config: {
          imageConfig: { aspectRatio: "16:9", imageSize: "1K" }
        }
      });

      for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
        }
      }

      // 3. Audio (TTS) Generation
      const fullText = `${scriptData.intro}. ${scriptData.development}. ${scriptData.climax}. ${scriptData.resolution}. ${scriptData.outro}`;
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: fullText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const audioData = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      let audioBlob = null;
      if (audioData) {
        const audioBytes = Uint8Array.from(atob(audioData), c => c.charCodeAt(0));
        audioBlob = new Blob([audioBytes], { type: 'audio/wav' });
      }

      setFinalAssets({
        script: scriptData,
        imageUrl: imageUrl,
        audioBlob: audioBlob
      });
      setStep(4);
    } catch (error) {
      console.error(error);
      alert("생성 작업 중 오류가 발생했습니다. API 키 권한이나 할당량을 확인해주세요.");
    } finally {
      setLoading(false);
    }
  };

  const downloadZip = async () => {
    if (!finalAssets) return;
    const zip = new JSZip();
    const { script, imageUrl, audioBlob } = finalAssets;

    zip.file(`${script.title}_full_script.json`, JSON.stringify(script, null, 2));
    const fullText = `[제목] ${script.title}\n\n[도입] ${script.intro}\n\n[전개] ${script.development}\n\n[절정] ${script.climax}\n\n[해결] ${script.resolution}\n\n[엔딩] ${script.outro}`;
    zip.file(`${script.title}_script.txt`, fullText);

    if (imageUrl) {
      const imgData = imageUrl.split(',')[1];
      zip.file(`${script.title}_poster.png`, imgData, { base64: true });
    }
    
    if (audioBlob) {
      zip.file(`${script.title}_narration.wav`, audioBlob);
    }

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${script.title}_LongForm_Package.zip`;
    link.click();
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-10">
      <header className="mb-10 text-center">
        <div className="inline-block px-3 py-1 bg-blue-500/10 border border-blue-500/50 rounded-full text-blue-400 text-xs font-bold mb-4">
          LONG-FORM PRODUCTION MODE
        </div>
        <h1 className="text-5xl font-black bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 bg-clip-text text-transparent mb-3">
          Gemini Cinema Studio
        </h1>
        <p className="text-gray-400 text-lg">깊이 있는 서사, 고화질 이미지, 완벽한 나레이션의 롱폼 영상 제작</p>
      </header>

      {/* Progress Stepper */}
      <div className="flex justify-between mb-12 px-6">
        {[1, 2, 3, 4].map(s => (
          <div key={s} className={`flex items-center ${s <= step ? 'text-blue-400' : 'text-gray-600'}`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 font-bold ${s <= step ? 'border-blue-400 bg-blue-400/10' : 'border-gray-600'}`}>
              {s}
            </div>
            <span className="ml-3 hidden md:inline font-medium">{s === 1 ? '기본 설정' : s === 2 ? '스토리 기획' : s === 3 ? '시나리오 검토' : '최종 자산'}</span>
          </div>
        ))}
      </div>

      {loading && (
        <div className="fixed inset-0 bg-black/90 flex flex-col items-center justify-center z-50 p-6 text-center backdrop-blur-sm">
          <div className="w-20 h-20 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-6"></div>
          <p className="text-2xl font-bold text-white mb-2">{loadingMsg}</p>
          <p className="text-gray-500">롱폼 대본은 데이터가 많아 시간이 조금 더 소요될 수 있습니다.</p>
        </div>
      )}

      {/* STEP 1: Common Settings */}
      {step === 1 && (
        <div className="bg-gray-800/50 backdrop-blur-md rounded-3xl p-8 border border-gray-700 shadow-2xl space-y-10 animate-in fade-in zoom-in-95 duration-500">
          <section>
            <h2 className="text-2xl font-bold mb-6 flex items-center">
              <span className="bg-blue-500 p-2 rounded-lg mr-3">🎭</span> 장르 선택 (다중 선택)
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {Object.values(Genre).map(g => (
                <button
                  key={g}
                  onClick={() => toggleGenre(g)}
                  className={`p-3 text-sm rounded-xl border transition-all duration-300 font-medium ${
                    selectedGenres.includes(g) 
                    ? 'border-blue-500 bg-blue-500/20 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)]' 
                    : 'border-gray-700 hover:border-gray-500 text-gray-400 bg-gray-900/50'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-6 flex items-center">
              <span className="bg-purple-500 p-2 rounded-lg mr-3">🗣️</span> 전체적인 어조
            </h2>
            <div className="flex gap-4">
              {Object.values(Tone).map(t => (
                <button
                  key={t}
                  onClick={() => setSelectedTone(t)}
                  className={`flex-1 p-4 rounded-xl border transition-all duration-300 font-bold ${
                    selectedTone === t 
                    ? 'border-purple-500 bg-purple-500/20 text-white shadow-[0_0_15px_rgba(168,85,247,0.3)]' 
                    : 'border-gray-700 text-gray-400 bg-gray-900/50'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </section>

          <button 
            disabled={selectedGenres.length === 0}
            onClick={() => setStep(2)}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 py-5 rounded-2xl font-black text-xl transition-all shadow-xl hover:scale-[1.01] active:scale-[0.99]"
          >
            기획 단계로 이동
          </button>
        </div>
      )}

      {/* STEP 2: Story Mode & Input */}
      {step === 2 && (
        <div className="bg-gray-800/50 backdrop-blur-md rounded-3xl p-8 border border-gray-700 shadow-2xl space-y-8 animate-in slide-in-from-right-10 duration-500">
          <section>
            <h2 className="text-2xl font-bold mb-4 flex items-center">
              <span className="bg-indigo-500 p-2 rounded-lg mr-3">🎬</span> 작업 방식
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.values(WorkMode).map(m => (
                <button
                  key={m}
                  onClick={() => setWorkMode(m)}
                  className={`p-3 text-sm rounded-xl border transition-all ${
                    workMode === m ? 'border-indigo-500 bg-indigo-500/20 text-white font-bold' : 'border-gray-700 text-gray-400'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6">
             <div className="group">
              <label className="block text-sm font-bold text-gray-400 mb-2 group-focus-within:text-blue-400 transition-colors">전체 사연/아이디어</label>
              <textarea 
                value={subject} 
                onChange={e => setSubject(e.target.value)}
                placeholder="롱폼 영상의 핵심이 되는 긴 이야기를 들려주세요."
                className="w-full bg-gray-900 border border-gray-700 rounded-2xl p-4 h-40 focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold text-gray-400 mb-2">주인공 설정</label>
                <input value={protagonist} onChange={e => setProtagonist(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-blue-500" placeholder="성격, 나이, 특징 등" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-400 mb-2">공간/시대 배경</label>
                <input value={background} onChange={e => setBackground(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-blue-500" placeholder="장소, 연도, 사회 분위기" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-400 mb-2">주요 갈등 요약</label>
                <input value={incident} onChange={e => setIncident(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-blue-500" placeholder="누가, 무엇 때문에 부딪히는지" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-400 mb-2">최종 전달 감정</label>
                <input value={emotion} onChange={e => setEmotion(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-blue-500" placeholder="감동, 공포, 분노, 카타르시스 등" />
              </div>
            </div>
          </div>

          <div className="flex gap-4 pt-4 border-t border-gray-700">
            <button onClick={() => setStep(1)} className="flex-1 bg-gray-700 hover:bg-gray-600 py-4 rounded-2xl font-bold transition-colors">이전으로</button>
            <button onClick={handleGenerateSynopsis} className="flex-[2] bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 py-4 rounded-2xl font-black shadow-lg hover:shadow-indigo-500/30 transition-all">
              AI 롱폼 시나리오 기획 시작 ✨
            </button>
          </div>
          
          {synopsis && (
            <div className="mt-8 p-6 bg-gray-900/80 rounded-3xl border border-blue-500/30 animate-in fade-in slide-in-from-top-4">
              <h3 className="text-xl font-black mb-4 flex items-center">
                <span className="text-blue-400 mr-2">✦</span> 생성된 시나리오 (수정 가능)
              </h3>
              <textarea 
                value={synopsis}
                onChange={e => setSynopsis(e.target.value)}
                className="w-full bg-transparent border-none rounded-lg p-0 h-64 text-gray-300 leading-relaxed focus:ring-0 resize-none text-base"
              />
              <button onClick={() => setStep(3)} className="w-full mt-6 bg-green-600 hover:bg-green-500 py-4 rounded-2xl font-black text-lg transition-all shadow-lg hover:shadow-green-500/20">
                시나리오 확정 및 제작 단계로 ❯
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP 3: Confirm & Final Generate */}
      {step === 3 && (
        <div className="bg-gray-800/80 backdrop-blur-xl rounded-3xl p-10 shadow-2xl text-center space-y-8 animate-in zoom-in-95 duration-300 border border-gray-700">
          <div className="w-24 h-24 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto text-5xl shadow-[0_0_30px_rgba(34,197,94,0.2)]">
            ✓
          </div>
          <div>
            <h2 className="text-3xl font-black mb-3">제작 준비가 완료되었습니다.</h2>
            <p className="text-gray-400 text-lg">Gemini 3 Pro 모델이 이 시나리오를 바탕으로 <br/> <span className="text-blue-400 font-bold">5부작 대본, 4K 포스터, 고음질 나레이션</span>을 생성합니다.</p>
          </div>
          
          <div className="p-6 bg-gray-950 rounded-2xl text-left text-base text-gray-400 max-h-56 overflow-y-auto border border-gray-800 custom-scrollbar italic leading-relaxed">
            "{synopsis}"
          </div>

          <div className="flex gap-4">
            <button onClick={() => setStep(2)} className="flex-1 bg-gray-700 hover:bg-gray-600 py-5 rounded-2xl font-bold">기획 수정</button>
            <button onClick={handleFullGenerate} className="flex-[2] bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 py-5 rounded-2xl font-black text-xl flex items-center justify-center gap-3 shadow-2xl hover:scale-[1.02] transition-all">
              최종 시나리오 빌드 시작 🚀
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Results & Download */}
      {step === 4 && finalAssets && (
        <div className="space-y-8 animate-in fade-in duration-1000">
          <div className="bg-blue-500/10 border border-blue-500/30 p-6 rounded-3xl text-center">
            <h2 className="text-2xl font-black text-blue-400 mb-1">{finalAssets.script.title}</h2>
            <p className="text-gray-500">롱폼 시나리오 빌드 결과물</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-gray-800/50 rounded-3xl p-8 border border-gray-700 shadow-xl">
                <h2 className="text-xl font-black mb-6 flex items-center border-b border-gray-700 pb-4">
                  <span className="bg-blue-500 w-2 h-6 rounded-full mr-3"></span> 전체 시나리오 대본
                </h2>
                <div className="space-y-8 text-base leading-loose max-h-[700px] overflow-y-auto pr-4 custom-scrollbar">
                  <div>
                    <span className="inline-block px-3 py-1 bg-red-500/20 text-red-400 rounded-lg text-xs font-black mb-3">PART 1. INTRO</span>
                    <p className="bg-gray-900/50 p-5 rounded-2xl border-l-4 border-red-500 text-gray-200">{finalAssets.script.intro}</p>
                  </div>
                  <div>
                    <span className="inline-block px-3 py-1 bg-orange-500/20 text-orange-400 rounded-lg text-xs font-black mb-3">PART 2. DEVELOPMENT</span>
                    <p className="text-gray-300 px-2">{finalAssets.script.development}</p>
                  </div>
                  <div>
                    <span className="inline-block px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-lg text-xs font-black mb-3">PART 3. CLIMAX</span>
                    <p className="text-gray-200 px-2 font-medium bg-white/5 p-4 rounded-xl border border-white/10">{finalAssets.script.climax}</p>
                  </div>
                  <div>
                    <span className="inline-block px-3 py-1 bg-green-500/20 text-green-400 rounded-lg text-xs font-black mb-3">PART 4. RESOLUTION</span>
                    <p className="text-gray-300 px-2">{finalAssets.script.resolution}</p>
                  </div>
                  <div>
                    <span className="inline-block px-3 py-1 bg-purple-500/20 text-purple-400 rounded-lg text-xs font-black mb-3">PART 5. OUTRO</span>
                    <p className="text-gray-400 px-2 italic">{finalAssets.script.outro}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-gray-800/50 rounded-3xl p-6 border border-gray-700 shadow-xl">
                <h2 className="text-xl font-black mb-4 flex items-center">
                  <span className="bg-indigo-500 w-2 h-6 rounded-full mr-3"></span> 메인 비주얼
                </h2>
                {finalAssets.imageUrl ? (
                  <div className="group relative overflow-hidden rounded-2xl shadow-2xl">
                    <img src={finalAssets.imageUrl} alt="Generated" className="w-full aspect-[16/9] object-cover transition-transform duration-700 group-hover:scale-110" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-4">
                      <p className="text-xs text-gray-300 line-clamp-2">{finalAssets.script.imagePrompt}</p>
                    </div>
                  </div>
                ) : (
                  <div className="w-full aspect-video bg-gray-900 rounded-2xl flex items-center justify-center text-gray-600 border border-dashed border-gray-700">이미지 로드 중...</div>
                )}
              </div>

              <div className="bg-gray-800/50 rounded-3xl p-6 border border-gray-700 shadow-xl">
                <h2 className="text-xl font-black mb-4 flex items-center">
                  <span className="bg-emerald-500 w-2 h-6 rounded-full mr-3"></span> 고음질 나레이션
                </h2>
                {finalAssets.audioBlob ? (
                  <div className="bg-gray-950 p-4 rounded-2xl">
                    <audio controls className="w-full">
                      <source src={URL.createObjectURL(finalAssets.audioBlob)} type="audio/wav" />
                    </audio>
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">음성 파일을 준비하지 못했습니다.</p>
                )}
              </div>

              <button 
                onClick={downloadZip}
                className="w-full bg-gradient-to-br from-orange-500 to-rose-600 hover:from-orange-400 hover:to-rose-500 py-6 rounded-3xl font-black text-xl shadow-[0_10px_30px_rgba(244,63,94,0.3)] flex items-center justify-center gap-4 transition-all hover:-translate-y-1 active:translate-y-0"
              >
                <span className="text-2xl">📦</span> 패키지 전체 다운로드
              </button>
            </div>
          </div>
          
          <div className="text-center pt-10">
            <button onClick={() => setStep(1)} className="text-gray-500 hover:text-white transition-colors flex items-center justify-center mx-auto gap-2">
              <span>↺</span> 새로운 롱폼 프로젝트 시작
            </button>
          </div>
        </div>
      )}

      <footer className="mt-20 text-center border-t border-gray-800 pt-10 pb-10">
        <p className="text-gray-600 text-sm tracking-widest uppercase font-bold">
          Powered by Gemini 3 Pro & 2.5 Flash Cinema Engine
        </p>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #374151; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #4b5563; }
      `}</style>
    </div>
  );
};

export default App;
