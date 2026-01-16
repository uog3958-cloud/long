
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

  const [selectedGenres, setSelectedGenres] = useState<Genre[]>([]);
  const [selectedTone, setSelectedTone] = useState<Tone>(Tone.FRIENDLY);
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(VoiceName.KORE);
  const [voiceInstruction, setVoiceInstruction] = useState("천천히 감정을 담아서 읽어줘");
  const [sceneCount, setSceneCount] = useState<number>(5);
  
  const [subject, setSubject] = useState("");
  const [protagonist, setProtagonist] = useState("");
  const [background, setBackground] = useState("");
  const [synopsis, setSynopsis] = useState("");

  const [finalAssets, setFinalAssets] = useState<FinalAssets | null>(null);

  const getAI = () => {
    if (!apiKey) throw new Error("API Key가 필요합니다.");
    return new GoogleGenAI({ apiKey });
  };

  const handleGenerateSynopsis = async () => {
    if (!apiKey) return alert("API Key를 입력해주세요.");
    setLoading(true);
    setLoadingMsg("시나리오 초안 작성 중...");
    try {
      const ai = getAI();
      const prompt = `유튜브 영상 시나리오 초안 작성. 장르: ${selectedGenres.join(', ')}, 어조: ${selectedTone}, 주인공: ${protagonist}, 배경: ${background}, 요약: ${subject}. 800자 내외로 상세하게 작성.`;
      const response = await ai.models.generateContent({ model: 'gemini-3-pro-preview', contents: prompt });
      setSynopsis(response.text || "");
    } catch (e) { alert("생성 실패"); } finally { setLoading(false); }
  };

  const handleFullGenerate = async () => {
    setLoading(true);
    setLoadingMsg(`${sceneCount}개 장면 렌더링 중...`);
    try {
      const ai = getAI();
      const scriptPrompt = `시놉시스: ${synopsis}. 정확히 ${sceneCount}개의 장면으로 나눈 대본 작성. JSON 형식 응답. 필드: title, scenes (배열: id, label, content, imagePrompt(영문))`;

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
            }
          }
        }
      });

      const scriptData: ScriptResult = JSON.parse(scriptResponse.text || "{}");
      const updatedScenes = [...scriptData.scenes];

      for (let i = 0; i < updatedScenes.length; i++) {
        setLoadingMsg(`이미지 생성 중 (${i+1}/${updatedScenes.length})...`);
        updatedScenes[i].imageUrl = await generateSingleImage(updatedScenes[i].imagePrompt);
      }

      setLoadingMsg("나레이션 합성 중...");
      const fullText = `${voiceInstruction}. ${updatedScenes.map(s => s.content).join(' ')}`;
      const audioBlob = await generateTTS(fullText);

      setFinalAssets({ script: { ...scriptData, scenes: updatedScenes }, audioBlob });
      setStep(4);
    } catch (e) { alert("제작 중 오류 발생"); } finally { setLoading(false); }
  };

  const generateSingleImage = async (prompt: string) => {
    try {
      const ai = getAI();
      const res = await ai.models.generateContent({
        model: "gemini-3-pro-image-preview",
        contents: `Cinematic movie scene, 4k, realistic, no text: ${prompt}`,
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
    setLoadingMsg(`장면 ${sceneId} 이미지 재생성...`);
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
    setLoadingMsg("나레이션 업데이트...");
    const fullText = `${voiceInstruction}. ${finalAssets.script.scenes.map(s => s.content).join(' ')}`;
    const newAudio = await generateTTS(fullText);
    setFinalAssets({ ...finalAssets, audioBlob: newAudio });
    setLoading(false);
  };

  const downloadZip = async () => {
    if (!finalAssets) return;
    const zip = new JSZip();
    const { script, audioBlob } = finalAssets;
    zip.file("script.json", JSON.stringify(script, null, 2));
    script.scenes.forEach((s, i) => {
      if (s.imageUrl) zip.file(`scene_${i+1}.png`, s.imageUrl.split(',')[1], { base64: true });
    });
    if (audioBlob) zip.file("voiceover.wav", audioBlob);
    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = `Cinema_Project.zip`;
    link.click();
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 font-sans text-gray-200 min-h-screen bg-gray-950">
      <header className="mb-6 text-center pt-4">
        <h1 className="text-4xl md:text-5xl font-black bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent mb-1 tracking-tighter">Cinema Studio</h1>
        <p className="text-gray-500 text-sm font-medium">컴팩트 AI 롱폼 제작 엔진</p>
      </header>

      {/* API Key */}
      <div className="mb-6 bg-gray-900/40 p-4 rounded-2xl border border-gray-800 flex gap-3 items-end shadow-xl">
        <div className="flex-1">
          <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1 mb-1 block">API Key</label>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2 text-xs focus:ring-1 focus:ring-blue-500 outline-none" placeholder="Gemini API Key..." />
        </div>
        <button onClick={() => { setIsKeySaved(true); alert("활성화됨"); }} className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${isKeySaved ? 'bg-emerald-700' : 'bg-blue-700'}`}>{isKeySaved ? 'ACTIVE' : 'ACTIVATE'}</button>
      </div>

      {loading && (
        <div className="fixed inset-0 bg-black/90 z-[100] flex flex-col items-center justify-center p-6 backdrop-blur-sm">
          <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-6"></div>
          <p className="text-xl font-bold text-white text-center animate-pulse">{loadingMsg}</p>
        </div>
      )}

      {step === 1 && (
        <div className="bg-gray-900/30 p-6 rounded-3xl border border-gray-800 space-y-6 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest block ml-1">장르 선택</label>
              <div className="flex flex-wrap gap-1.5">
                {Object.values(Genre).slice(0, 12).map(g => (
                  <button key={g} onClick={() => setSelectedGenres(p => p.includes(g) ? p.filter(x => x!==g) : [...p, g])} className={`px-3 py-1.5 rounded-xl border text-[10px] font-bold transition-all ${selectedGenres.includes(g) ? 'bg-blue-600 border-blue-400 text-white' : 'border-gray-800 text-gray-500 bg-gray-950/50'}`}>{g}</button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest block ml-1">어조</label>
              <div className="grid grid-cols-1 gap-1.5">
                {Object.values(Tone).map(t => (
                  <button key={t} onClick={() => setSelectedTone(t)} className={`px-4 py-2 text-left rounded-xl border text-[11px] transition-all flex items-center justify-between ${selectedTone === t ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-gray-800 text-gray-500 bg-gray-950/50'}`}>
                    <span>{t}</span>
                    {selectedTone === t && <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button disabled={!isKeySaved} onClick={() => setStep(2)} className="w-full bg-blue-700 py-4 rounded-2xl font-black text-lg shadow-lg hover:bg-blue-600 transition-all disabled:opacity-30">스토리 기획 시작</button>
        </div>
      )}

      {step === 2 && (
        <div className="bg-gray-900/30 p-6 rounded-3xl border border-gray-800 space-y-4 animate-in slide-in-from-right-8">
          <h2 className="text-xl font-black">시나리오 구상</h2>
          <textarea value={subject} onChange={e => setSubject(e.target.value)} placeholder="이야기 내용을 입력하세요..." className="w-full h-48 bg-gray-950 border border-gray-800 rounded-2xl p-5 text-sm focus:ring-1 focus:ring-blue-500 outline-none leading-relaxed" />
          <div className="grid grid-cols-2 gap-3">
            <input value={protagonist} onChange={e => setProtagonist(e.target.value)} className="p-3 bg-gray-950 border border-gray-800 rounded-xl text-xs" placeholder="주인공 정보" />
            <input value={background} onChange={e => setBackground(e.target.value)} className="p-3 bg-gray-950 border border-gray-800 rounded-xl text-xs" placeholder="배경 정보" />
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="flex-1 py-3 bg-gray-800 rounded-xl text-xs font-bold">이전</button>
            <button onClick={handleGenerateSynopsis} className="flex-[2] py-3 bg-blue-700 rounded-xl text-sm font-black">시나리오 생성</button>
          </div>
          {synopsis && (
            <div className="mt-4 p-5 bg-gray-950 rounded-2xl border border-blue-500/20">
              <textarea value={synopsis} onChange={e => setSynopsis(e.target.value)} className="w-full h-64 bg-transparent border-none focus:ring-0 text-gray-400 text-xs leading-relaxed resize-none" />
              <button onClick={() => setStep(3)} className="w-full mt-4 py-4 bg-emerald-700 rounded-xl font-black text-lg">제작 설정 이동</button>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="bg-gray-900/30 p-8 rounded-3xl border border-gray-800 space-y-8 animate-in zoom-in-95">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <section className="space-y-4">
              <h3 className="text-base font-black text-blue-500">장면 수 설정</h3>
              <div className="bg-gray-950 p-6 rounded-2xl border border-gray-800">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">장면 수</span>
                  <span className="text-3xl font-black text-blue-500">{sceneCount} <small className="text-xs text-gray-700">CUTS</small></span>
                </div>
                <input type="range" min="5" max="20" value={sceneCount} onChange={e => setSceneCount(Number(e.target.value))} className="w-full h-1.5 bg-gray-800 rounded-full appearance-none accent-blue-500" />
              </div>
            </section>
            <section className="space-y-4">
              <h3 className="text-base font-black text-purple-500">나레이션 설정</h3>
              <div className="grid grid-cols-3 gap-1.5">
                {Object.values(VoiceName).map(v => (
                  <button key={v} onClick={() => setSelectedVoice(v)} className={`py-2 rounded-lg border text-[9px] font-black transition-all ${selectedVoice === v ? 'border-purple-500 bg-purple-500/20 text-white' : 'border-gray-800 text-gray-600 bg-gray-950'}`}>{v.split(' ')[0]}</button>
                ))}
              </div>
              <textarea value={voiceInstruction} onChange={e => setVoiceInstruction(e.target.value)} className="w-full h-20 bg-gray-950 border border-gray-800 rounded-xl p-4 text-[11px] outline-none" placeholder="어조 지시문..." />
            </section>
          </div>
          <button onClick={handleFullGenerate} className="w-full py-5 bg-gradient-to-r from-blue-700 to-indigo-800 rounded-2xl font-black text-xl shadow-xl hover:scale-[1.01] transition-all">빌드 및 렌더링 시작 🚀</button>
        </div>
      )}

      {step === 4 && finalAssets && (
        <div className="space-y-6 animate-in fade-in duration-700 pb-20">
          <div className="sticky top-2 z-50 bg-gray-900/80 backdrop-blur-xl p-4 rounded-2xl border border-gray-800 shadow-2xl flex items-center justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-sm font-black text-blue-400 truncate mb-1">{finalAssets.script.title}</h2>
              <audio controls className="w-full h-8 bg-gray-950 rounded-full">
                <source src={URL.createObjectURL(finalAssets.audioBlob!)} type="audio/wav" />
              </audio>
            </div>
            <button onClick={downloadZip} className="bg-orange-700 px-6 py-3 rounded-xl font-black text-xs shadow-lg">EXPORT 📦</button>
          </div>

          {/* Quick Control */}
          <div className="bg-gray-900/30 p-4 rounded-2xl border border-gray-800 grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest">보이스 지시문</label>
              <div className="flex gap-2">
                <input value={voiceInstruction} onChange={e => setVoiceInstruction(e.target.value)} className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-1.5 text-[10px] outline-none" />
                <button onClick={updateFullTTS} className="bg-purple-700 px-3 rounded-lg text-[9px] font-black">↺</button>
              </div>
            </div>
            <div className="flex items-end justify-end">
              <button onClick={() => setStep(1)} className="text-[9px] font-black text-gray-600 uppercase tracking-widest hover:text-white">New Project</button>
            </div>
          </div>

          {/* Scene Grid */}
          <div className="grid grid-cols-1 gap-6">
            {finalAssets.script.scenes.map((scene, idx) => (
              <div key={scene.id} className="group bg-gray-900/20 rounded-3xl border border-gray-800 overflow-hidden flex flex-col md:flex-row shadow-lg">
                <div className="md:w-5/12 relative aspect-video bg-gray-950">
                  {scene.imageUrl ? (
                    <img src={scene.imageUrl} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  ) : (
                    <div className="flex items-center justify-center h-full text-[9px] text-gray-700">RENDERING...</div>
                  )}
                  <div className="absolute top-3 left-3 bg-black/70 px-2 py-0.5 rounded-lg text-[8px] font-black tracking-widest border border-white/5 uppercase">CUT {idx + 1}</div>
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button onClick={() => regenerateSceneImage(scene.id)} className="bg-white text-black px-5 py-2 rounded-full font-black text-[10px] shadow-xl hover:scale-105 active:scale-95 transition-all">이미지 재생성 ↺</button>
                  </div>
                </div>
                
                <div className="md:w-7/12 p-6 flex flex-col justify-between">
                  <div className="space-y-2">
                    <h4 className="text-xs font-black text-white">{scene.label}</h4>
                    <textarea 
                      value={scene.content} 
                      onChange={e => {
                        const newScenes = finalAssets.script.scenes.map(s => s.id === scene.id ? {...s, content: e.target.value} : s);
                        setFinalAssets({...finalAssets, script: {...finalAssets.script, scenes: newScenes}});
                      }}
                      className="w-full bg-transparent border-none focus:ring-0 text-sm text-gray-400 leading-relaxed resize-none h-24 scrollbar-hide font-medium"
                    />
                  </div>
                  <div className="flex justify-end pt-2">
                     <button onClick={() => regenerateSceneImage(scene.id)} className="text-[9px] font-black text-blue-500 hover:underline">REGENERATE THIS IMAGE</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center pt-10">
            <button onClick={downloadZip} className="bg-blue-700 px-12 py-5 rounded-2xl font-black text-xl shadow-xl hover:scale-105 transition-all">전체 다운로드 (.ZIP)</button>
          </div>
        </div>
      )}

      <footer className="mt-20 py-10 border-t border-gray-900 text-center opacity-10">
        <p className="text-[8px] font-black tracking-[0.5em] uppercase">Cinema Studio v2.6 • Minimalist UI</p>
      </footer>

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        input[type="range"]::-webkit-slider-thumb { border-radius: 50%; width: 12px; height: 12px; }
      `}</style>
    </div>
  );
};

export default App;
