
import React, { useState } from 'react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Genre, Tone, VoiceName, ScriptResult, FinalAssets, Scene } from './types';
import JSZip from 'jszip';

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState<string>(process.env.API_KEY || "");
  const [isKeySaved, setIsKeySaved] = useState<boolean>(!!process.env.API_KEY);
  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMsg, setLoadingMsg] = useState<string>("");

  // Config States
  const [selectedGenres, setSelectedGenres] = useState<Genre[]>([]);
  const [selectedTone, setSelectedTone] = useState<Tone>(Tone.FRIENDLY);
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(VoiceName.KORE);
  const [voiceInstruction, setVoiceInstruction] = useState("천천히 감정을 담아서 읽어줘");
  const [sceneCount, setSceneCount] = useState<number>(5);
  
  // Synopsis States
  const [subject, setSubject] = useState("");
  const [protagonist, setProtagonist] = useState("");
  const [background, setBackground] = useState("");
  const [incident, setIncident] = useState("");
  const [emotion, setEmotion] = useState("");
  const [synopsis, setSynopsis] = useState("");

  // Result States
  const [finalAssets, setFinalAssets] = useState<FinalAssets | null>(null);

  const getAI = () => {
    if (!apiKey) throw new Error("API Key가 필요합니다.");
    return new GoogleGenAI({ apiKey });
  };

  const handleGenerateSynopsis = async () => {
    if (!apiKey) return alert("API Key를 입력해주세요.");
    setLoading(true);
    setLoadingMsg("AI가 시나리오 초안을 작성 중입니다...");
    try {
      const ai = getAI();
      const prompt = `유튜브 롱폼 영상 시나리오 초안 작성. 
      장르: ${selectedGenres.join(', ')}, 어조: ${selectedTone}, 주인공: ${protagonist}, 배경: ${background}, 갈등: ${incident}, 감정: ${emotion}, 요약: ${subject}. 
      이야기의 핵심 갈등과 흐름이 잘 드러나도록 1000자 내외로 상세하게 작성해줘.`;
      const response = await ai.models.generateContent({ model: 'gemini-3-pro-preview', contents: prompt });
      setSynopsis(response.text || "");
    } catch (e) { alert("시나리오 생성 실패"); } finally { setLoading(false); }
  };

  const handleFullGenerate = async () => {
    setLoading(true);
    setLoadingMsg(`총 ${sceneCount}개의 장면으로 대본 분할 및 렌더링 중...`);
    try {
      const ai = getAI();
      const scriptPrompt = `시놉시스: ${synopsis}. 
      이 이야기를 바탕으로 반드시 정확히 ${sceneCount}개의 장면(Scene)으로 나눈 상세 대본을 작성해줘. 
      각 장면은 시각적 묘사가 포함된 영문 이미지 프롬프트를 포함해야 해.
      JSON 형식 응답. 필드: title, scenes (배열: id, label, content, imagePrompt(영문))`;

      const scriptResponse = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: scriptPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.INTEGER },
                    label: { type: Type.STRING },
                    content: { type: Type.STRING },
                    imagePrompt: { type: Type.STRING }
                  }
                }
              }
            },
            required: ["title", "scenes"]
          }
        }
      });

      const scriptData: ScriptResult = JSON.parse(scriptResponse.text || "{}");
      const updatedScenes = [...scriptData.scenes];

      // 초기 이미지 순차 생성
      for (let i = 0; i < updatedScenes.length; i++) {
        setLoadingMsg(`시네마틱 이미지 생성 중 (${i+1}/${updatedScenes.length})...`);
        updatedScenes[i].imageUrl = await generateSingleImage(updatedScenes[i].imagePrompt);
      }

      // 초기 TTS 생성
      setLoadingMsg("전체 나레이션 합성 중...");
      const fullText = `${voiceInstruction}. ${updatedScenes.map(s => s.content).join(' ')}`;
      const audioBlob = await generateTTS(fullText);

      setFinalAssets({ script: { ...scriptData, scenes: updatedScenes }, audioBlob });
      setStep(4);
    } catch (e) { console.error(e); alert("제작 중 오류가 발생했습니다."); } finally { setLoading(false); }
  };

  const generateSingleImage = async (prompt: string) => {
    try {
      const ai = getAI();
      const res = await ai.models.generateContent({
        model: "gemini-3-pro-image-preview",
        contents: `Cinematic movie scene, professional lighting, realistic, 4k, no text: ${prompt}`,
        config: { imageConfig: { aspectRatio: "16:9", imageSize: "1K" } }
      });
      const part = res.candidates?.[0]?.content?.parts.find(p => p.inlineData);
      return part ? `data:image/png;base64,${part.inlineData.data}` : null;
    } catch (e) { return null; }
  };

  const generateTTS = async (text: string) => {
    try {
      const ai = getAI();
      const voiceKey = selectedVoice.split(' ')[0];
      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceKey } } }
        }
      });
      const data = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      return data ? new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'audio/wav' }) : null;
    } catch (e) { return null; }
  };

  const regenerateSceneImage = async (sceneId: number) => {
    if (!finalAssets) return;
    setLoading(true);
    setLoadingMsg(`장면 ${sceneId} 이미지 재생성 중...`);
    const scene = finalAssets.script.scenes.find(s => s.id === sceneId);
    if (scene) {
      const newUrl = await generateSingleImage(scene.imagePrompt);
      const newScenes = finalAssets.script.scenes.map(s => s.id === sceneId ? { ...s, imageUrl: newUrl } : s);
      setFinalAssets({ ...finalAssets, script: { ...finalAssets.script, scenes: newScenes } });
    }
    setLoading(false);
  };

  const updateFullTTS = async () => {
    if (!finalAssets) return;
    setLoading(true);
    setLoadingMsg("나레이션 재합성 중...");
    const fullText = `${voiceInstruction}. ${finalAssets.script.scenes.map(s => s.content).join(' ')}`;
    const newAudio = await generateTTS(fullText);
    setFinalAssets({ ...finalAssets, audioBlob: newAudio });
    setLoading(false);
  };

  const downloadZip = async () => {
    if (!finalAssets) return;
    const zip = new JSZip();
    const { script, audioBlob } = finalAssets;
    zip.file("script_data.json", JSON.stringify(script, null, 2));
    script.scenes.forEach((s, i) => {
      if (s.imageUrl) zip.file(`scene_${String(i+1).padStart(2, '0')}.png`, s.imageUrl.split(',')[1], { base64: true });
    });
    if (audioBlob) zip.file("narration.wav", audioBlob);
    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = `${script.title}_Cinema_Package.zip`;
    link.click();
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-10 font-sans text-gray-100 min-h-screen bg-gray-950">
      <header className="mb-12 text-center pt-8">
        <h1 className="text-6xl md:text-8xl font-black bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 bg-clip-text text-transparent mb-4 tracking-tighter">Cinema Pro Studio</h1>
        <p className="text-gray-500 text-xl font-medium">최첨단 AI로 완성하는 고퀄리티 롱폼 제작 엔진</p>
      </header>

      {/* API Key Section */}
      <div className="mb-12 bg-gray-900/40 p-6 rounded-[2.5rem] border border-gray-800 flex flex-col md:flex-row gap-4 items-end shadow-2xl">
        <div className="flex-1 w-full">
          <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest ml-1 mb-2 block">Gemini API Key</label>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded-2xl px-6 py-4 focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="Enter your Gemini API Key..." />
        </div>
        <button onClick={() => { setIsKeySaved(true); alert("API Key 활성화"); }} className={`px-10 py-4 rounded-2xl font-black transition-all shadow-lg ${isKeySaved ? 'bg-emerald-600' : 'bg-blue-600 hover:bg-blue-500'}`}>{isKeySaved ? 'API ACTIVE' : 'ACTIVATE'}</button>
      </div>

      {loading && (
        <div className="fixed inset-0 bg-black/95 z-[100] flex flex-col items-center justify-center p-12 backdrop-blur-2xl">
          <div className="relative w-32 h-32 mb-10">
            <div className="absolute inset-0 border-8 border-blue-500/20 rounded-full"></div>
            <div className="absolute inset-0 border-8 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <p className="text-4xl font-black text-white text-center max-w-2xl animate-pulse">{loadingMsg}</p>
        </div>
      )}

      {/* Step 1: Base Config */}
      {step === 1 && (
        <div className="bg-gray-900/30 p-10 rounded-[3rem] border border-gray-800 space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
          <section className="space-y-8">
            <h2 className="text-3xl font-black flex items-center"><span className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center mr-4 text-xl shadow-lg shadow-blue-500/20">1</span> 기본 장르 및 스타일 설정</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="space-y-4">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest block ml-2">선호 장르</label>
                <div className="flex flex-wrap gap-2">
                  {Object.values(Genre).map(g => (
                    <button key={g} onClick={() => setSelectedGenres(p => p.includes(g) ? p.filter(x => x!==g) : [...p, g])} className={`px-5 py-3 rounded-2xl border text-xs font-bold transition-all ${selectedGenres.includes(g) ? 'bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-500/30' : 'border-gray-800 text-gray-500 hover:border-gray-600 bg-gray-950/50'}`}>{g}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-4">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest block ml-2">이야기 어조</label>
                <div className="grid grid-cols-1 gap-2">
                  {Object.values(Tone).map(t => (
                    <button key={t} onClick={() => setSelectedTone(t)} className={`p-5 text-left rounded-2xl border transition-all flex items-center justify-between ${selectedTone === t ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-gray-800 text-gray-500 bg-gray-950/50'}`}>
                      <span className="font-bold">{t}</span>
                      {selectedTone === t && <div className="w-3 h-3 bg-indigo-500 rounded-full"></div>}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
          <button disabled={!isKeySaved || selectedGenres.length === 0} onClick={() => setStep(2)} className="w-full bg-gradient-to-r from-blue-600 to-indigo-700 py-8 rounded-[2.5rem] font-black text-3xl shadow-2xl hover:scale-[1.02] transition-all disabled:opacity-20 active:scale-95">다음 단계: 스토리 기획 ❯</button>
        </div>
      )}

      {/* Step 2: Storytelling */}
      {step === 2 && (
        <div className="bg-gray-900/30 p-10 rounded-[3rem] border border-gray-800 space-y-10 animate-in slide-in-from-right-12">
          <h2 className="text-4xl font-black">시나리오 브레인스토밍</h2>
          <textarea value={subject} onChange={e => setSubject(e.target.value)} placeholder="만들고 싶은 이야기의 전체적인 줄거리나 핵심 사건을 들려주세요." className="w-full h-80 bg-gray-950 border border-gray-800 rounded-[2.5rem] p-10 text-2xl focus:ring-2 focus:ring-blue-500 outline-none leading-relaxed scrollbar-hide" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <input value={protagonist} onChange={e => setProtagonist(e.target.value)} className="p-6 bg-gray-950 border border-gray-800 rounded-3xl" placeholder="주인공의 이름이나 성격" />
            <input value={background} onChange={e => setBackground(e.target.value)} className="p-6 bg-gray-950 border border-gray-800 rounded-3xl" placeholder="이야기의 배경(시대, 장소)" />
          </div>
          <div className="flex gap-6">
            <button onClick={() => setStep(1)} className="flex-1 py-6 bg-gray-800 rounded-3xl font-black text-xl">이전</button>
            <button onClick={handleGenerateSynopsis} className="flex-[3] py-6 bg-blue-600 rounded-3xl font-black text-2xl shadow-xl">시나리오 초안 생성</button>
          </div>
          {synopsis && (
            <div className="mt-12 p-12 bg-gray-950 rounded-[3.5rem] border border-blue-500/20 shadow-2xl animate-in zoom-in-95">
              <h3 className="text-2xl font-black mb-8 text-blue-400 flex items-center uppercase tracking-tighter"><span className="w-3 h-8 bg-blue-500 rounded-full mr-4"></span> AI 시나리오 검토</h3>
              <textarea value={synopsis} onChange={e => setSynopsis(e.target.value)} className="w-full h-[500px] bg-transparent border-none focus:ring-0 text-gray-300 leading-[2.2] text-xl resize-none scrollbar-hide" />
              <button onClick={() => setStep(3)} className="w-full mt-10 py-8 bg-emerald-600 rounded-[2.5rem] font-black text-3xl shadow-2xl hover:bg-emerald-500 transition-all">다음 단계: 제작 디테일 설정 ❯</button>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Production Settings (Moved here per request) */}
      {step === 3 && (
        <div className="bg-gray-900/30 p-12 rounded-[4rem] border border-gray-800 space-y-16 animate-in zoom-in-90 duration-500">
          <div className="text-center">
            <h2 className="text-5xl font-black mb-6 tracking-tight">프로덕션 최종 설정</h2>
            <p className="text-gray-500 text-xl font-medium">영상의 길이와 나레이션 스타일을 결정하고 빌드를 시작합니다.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            <section className="space-y-10">
              <h3 className="text-3xl font-black flex items-center text-blue-500"><span className="mr-4 text-4xl">📸</span> 장면(이미지) 개수</h3>
              <div className="bg-gray-950 p-10 rounded-[3rem] border border-gray-800 shadow-inner">
                <div className="flex justify-between items-end mb-8">
                  <span className="text-gray-400 font-black uppercase tracking-widest text-sm">목표 장면 수</span>
                  <span className="text-7xl font-black text-blue-500 leading-none">{sceneCount} <span className="text-lg text-gray-700 uppercase">cuts</span></span>
                </div>
                <input type="range" min="5" max="20" step="1" value={sceneCount} onChange={e => setSceneCount(Number(e.target.value))} className="w-full h-3 bg-gray-800 rounded-full appearance-none cursor-pointer accent-blue-500" />
                <div className="flex justify-between mt-6 text-xs font-black text-gray-600 px-1 uppercase tracking-widest">
                  <span>최소 (5)</span>
                  <span>최대 (20)</span>
                </div>
                <p className="mt-10 text-sm text-gray-500 italic bg-blue-500/5 p-4 rounded-2xl border border-blue-500/10">장면 수가 많을수록 서사가 촘촘해지며, 시각적 몰입감이 극대화됩니다.</p>
              </div>
            </section>

            <section className="space-y-10">
              <h3 className="text-3xl font-black flex items-center text-purple-500"><span className="mr-4 text-4xl">🎙️</span> 나레이션 보이스 커스텀</h3>
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.values(VoiceName).map(v => (
                    <button key={v} onClick={() => setSelectedVoice(v)} className={`p-5 text-left rounded-2xl border transition-all flex flex-col gap-1 ${selectedVoice === v ? 'border-purple-500 bg-purple-500/10 text-white shadow-lg' : 'border-gray-800 text-gray-500 bg-gray-950'}`}>
                      <span className="font-black text-sm uppercase">{v.split(' ')[0]}</span>
                      <span className="text-[10px] opacity-60 font-medium">{v}</span>
                    </button>
                  ))}
                </div>
                <div className="pt-6">
                  <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-4 block ml-2">성우 연기 지시문 (AI Prompt)</label>
                  <textarea value={voiceInstruction} onChange={e => setVoiceInstruction(e.target.value)} className="w-full h-40 bg-gray-950 border border-gray-800 rounded-[2rem] p-8 outline-none focus:ring-2 focus:ring-purple-500 resize-none text-lg leading-relaxed shadow-inner" placeholder="예: 무거운 분위기로 차분하게, 마지막은 긴 여운을 남겨주세요." />
                </div>
              </div>
            </section>
          </div>

          <div className="flex gap-6 max-w-4xl mx-auto pt-10">
            <button onClick={() => setStep(2)} className="flex-1 py-8 bg-gray-800 rounded-[2.5rem] font-black text-2xl hover:bg-gray-700 transition-all">기획 단계로</button>
            <button onClick={handleFullGenerate} className="flex-[2] py-8 bg-gradient-to-r from-blue-600 to-indigo-700 rounded-[2.5rem] font-black text-4xl shadow-[0_30px_60px_rgba(37,99,235,0.3)] hover:scale-105 transition-all">빌드 및 렌더링 시작 🚀</button>
          </div>
        </div>
      )}

      {/* Step 4: Final Production Review */}
      {step === 4 && finalAssets && (
        <div className="space-y-16 animate-in fade-in duration-1000 pb-40">
          {/* Dashboard Header */}
          <div className="sticky top-6 z-50 bg-gray-900/70 backdrop-blur-3xl p-10 rounded-[3.5rem] border border-gray-800 shadow-2xl flex flex-col lg:flex-row items-center justify-between gap-10">
            <div className="flex-1 w-full space-y-4">
               <h2 className="text-3xl font-black text-blue-400 truncate tracking-tight">{finalAssets.script.title}</h2>
               <div className="flex flex-wrap items-center gap-6">
                  <audio controls className="flex-1 min-w-[300px] h-14 bg-gray-950 rounded-full border border-gray-800 shadow-inner">
                    <source src={URL.createObjectURL(finalAssets.audioBlob!)} type="audio/wav" />
                  </audio>
                  <div className="flex gap-2">
                    <button onClick={updateFullTTS} className="bg-purple-600 w-14 h-14 rounded-full hover:bg-purple-500 transition-all shadow-xl flex items-center justify-center text-2xl" title="나레이션 즉시 합성">🎙️</button>
                    <button onClick={downloadZip} className="bg-gradient-to-r from-orange-500 to-rose-600 px-10 h-14 rounded-full font-black text-lg shadow-2xl flex items-center gap-3">EXPORT 📦</button>
                  </div>
               </div>
            </div>
          </div>

          {/* Quick Tuning Panel */}
          <div className="bg-gray-900/30 p-12 rounded-[3.5rem] border border-gray-800 grid grid-cols-1 lg:grid-cols-2 gap-12 shadow-2xl">
            <div className="space-y-4">
              <h4 className="text-xl font-black text-purple-400 flex items-center"><span className="mr-3">🎚️</span> 보이스 퀵 튜닝</h4>
              <div className="flex flex-wrap gap-2">
                {Object.values(VoiceName).map(v => (
                  <button key={v} onClick={() => setSelectedVoice(v)} className={`px-5 py-2 rounded-xl text-[10px] font-black border transition-all uppercase tracking-widest ${selectedVoice === v ? 'bg-purple-600 border-purple-400 text-white' : 'bg-gray-950 border-gray-800 text-gray-600 hover:border-gray-700'}`}>{v.split(' ')[0]}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest block ml-2">읽기 스타일 수정</label>
              <div className="flex gap-4">
                <input value={voiceInstruction} onChange={e => setVoiceInstruction(e.target.value)} className="flex-1 bg-gray-950 border border-gray-800 rounded-2xl px-6 py-4 focus:ring-1 focus:ring-purple-500 outline-none transition-all text-sm" />
                <button onClick={updateFullTTS} className="bg-gray-800 px-8 py-4 rounded-2xl font-black text-xs hover:bg-gray-700 transition-all border border-gray-700">UPDATE ↺</button>
              </div>
            </div>
          </div>

          {/* Master Scene Grid */}
          <div className="grid grid-cols-1 gap-16">
            {finalAssets.script.scenes.map((scene, idx) => (
              <div key={scene.id} className="group bg-gray-900/20 rounded-[4rem] border border-gray-800 overflow-hidden flex flex-col lg:flex-row shadow-2xl hover:border-blue-500/40 transition-all duration-700">
                <div className="lg:w-1/2 relative overflow-hidden bg-gray-950 flex items-center justify-center">
                  {scene.imageUrl ? (
                    <img src={scene.imageUrl} className="w-full aspect-video object-cover transition-transform duration-[1.5s] group-hover:scale-110" />
                  ) : (
                    <div className="flex flex-col items-center gap-6">
                      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-xs font-black text-gray-700 uppercase tracking-[0.5em]">Rendering Art...</span>
                    </div>
                  )}
                  <div className="absolute top-10 left-10 bg-black/70 backdrop-blur-xl px-6 py-2 rounded-full text-[12px] font-black tracking-[0.3em] border border-white/10 uppercase z-10">CUT {String(idx + 1).padStart(2, '0')}</div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-12">
                     <button onClick={() => regenerateSceneImage(scene.id)} className="bg-white text-black px-12 py-4 rounded-full font-black shadow-[0_20px_40px_rgba(255,255,255,0.2)] hover:scale-105 active:scale-95 transition-all">IMAGE RE-GENERATE ↺</button>
                  </div>
                </div>
                
                <div className="lg:w-1/2 p-16 flex flex-col justify-between space-y-12">
                  <div className="space-y-8">
                    <h4 className="text-3xl font-black text-white leading-tight">{scene.label}</h4>
                    <textarea 
                      value={scene.content} 
                      onChange={e => {
                        const newScenes = finalAssets.script.scenes.map(s => s.id === scene.id ? {...s, content: e.target.value} : s);
                        setFinalAssets({...finalAssets, script: {...finalAssets.script, scenes: newScenes}});
                      }}
                      className="w-full bg-transparent border-none focus:ring-0 text-xl text-gray-400 leading-[1.8] resize-none h-60 scrollbar-hide font-medium"
                    />
                  </div>

                  <div className="pt-10 border-t border-gray-800/50 space-y-6">
                    <div className="flex flex-col space-y-4">
                      <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest ml-1">AI 이미지 묘사(영문) - 수정 후 재생성 가능</label>
                      <div className="flex gap-4">
                        <input 
                          value={scene.imagePrompt} 
                          onChange={e => {
                            const newScenes = finalAssets.script.scenes.map(s => s.id === scene.id ? {...s, imagePrompt: e.target.value} : s);
                            setFinalAssets({...finalAssets, script: {...finalAssets.script, scenes: newScenes}});
                          }}
                          className="flex-1 bg-gray-950 border border-gray-800 rounded-2xl px-6 py-4 text-sm text-gray-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all font-mono"
                        />
                        <button onClick={() => regenerateSceneImage(scene.id)} className="bg-blue-600/20 text-blue-400 border border-blue-500/30 px-6 rounded-2xl hover:bg-blue-600/40 transition-all font-black text-xs">APPLY</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center pt-20 flex flex-col items-center gap-10">
            <button onClick={downloadZip} className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-24 py-12 rounded-[3.5rem] font-black text-5xl shadow-[0_40px_80px_rgba(37,99,235,0.4)] hover:scale-105 transition-all active:scale-95">ALL ASSETS EXPORT 📦</button>
            <button onClick={() => setStep(1)} className="text-gray-600 hover:text-white font-black text-sm uppercase tracking-[0.5em] transition-colors flex items-center gap-4">
              <span className="text-2xl">↺</span> Start New Production
            </button>
          </div>
        </div>
      )}

      <footer className="mt-40 py-24 border-t border-gray-900 text-center opacity-20">
        <div className="text-5xl mb-6">🎭 📽️ 🎨 🎙️ 🧠</div>
        <p className="text-[10px] font-black tracking-[1.2em] uppercase">Cinema Pro Studio v2.5 • Gemini Intelligence</p>
      </footer>

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes loading-bar {
          0% { width: 0%; }
          50% { width: 70%; }
          100% { width: 100%; }
        }
      `}</style>
    </div>
  );
};

export default App;
