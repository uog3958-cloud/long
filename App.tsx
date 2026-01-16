
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

  // TTS 미리보기 기능
  const previewVoice = async (voiceName: VoiceName) => {
    try {
      const ai = getAI();
      const voiceKey = voiceName.split(' ')[0];
      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `안녕하세요, 제 목소리는 ${voiceKey}입니다. 잘 부탁드립니다.` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceKey } } }
        }
      });
      const data = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (data) {
        const audio = new Audio(`data:audio/wav;base64,${data}`);
        audio.play();
      }
    } catch (e) { console.error("미리듣기 실패"); }
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

      // 이미지 생성을 고속화하기 위해 병렬 처리 (제한적)
      setLoadingMsg("이미지 고속 생성 엔진 가동 중...");
      const imagePromises = updatedScenes.map(async (scene, i) => {
        return generateSingleImage(scene.imagePrompt);
      });
      
      const images = await Promise.all(imagePromises);
      images.forEach((url, i) => { updatedScenes[i].imageUrl = url; });

      setLoadingMsg("나레이션 합성 중...");
      const fullText = `${voiceInstruction}. ${updatedScenes.map(s => s.content).join(' ')}`;
      const audioBlob = await generateTTS(fullText);

      setFinalAssets({ script: { ...scriptData, scenes: updatedScenes }, audioBlob });
      setStep(4);
    } catch (e) { alert("제작 중 오류 발생"); } finally { setLoading(false); }
  };

  // 이미지 생성 속도 단축을 위해 gemini-2.5-flash-image 사용
  const generateSingleImage = async (prompt: string) => {
    try {
      const ai = getAI();
      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash-image", // 고속 생성을 위해 모델 변경
        contents: `Cinematic, photorealistic, 4k: ${prompt}`,
        config: { imageConfig: { aspectRatio: "16:9" } }
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
    <div className="max-w-4xl mx-auto p-4 md:p-6 font-sans text-gray-200 min-h-screen bg-gray-950">
      <header className="mb-6 text-center pt-4">
        <h1 className="text-3xl md:text-4xl font-black bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent mb-1 tracking-tighter">Cinema Studio</h1>
        <p className="text-gray-500 text-[10px] font-medium uppercase tracking-[0.2em]">High Performance AI Engine</p>
      </header>

      {/* API Key */}
      <div className="mb-4 bg-gray-900/40 p-3 rounded-xl border border-gray-800 flex gap-2 items-end shadow-xl">
        <div className="flex-1">
          <label className="text-[8px] font-black text-gray-600 uppercase tracking-widest ml-1 mb-1 block">API Key</label>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-1.5 text-[10px] focus:ring-1 focus:ring-blue-500 outline-none" placeholder="Gemini API Key..." />
        </div>
        <button onClick={() => { setIsKeySaved(true); alert("활성화됨"); }} className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${isKeySaved ? 'bg-emerald-700' : 'bg-blue-700'}`}>{isKeySaved ? 'ACTIVE' : 'ACTIVATE'}</button>
      </div>

      {loading && (
        <div className="fixed inset-0 bg-black/90 z-[100] flex flex-col items-center justify-center p-6 backdrop-blur-sm">
          <div className="w-12 h-12 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-4"></div>
          <p className="text-sm font-bold text-white text-center animate-pulse">{loadingMsg}</p>
        </div>
      )}

      {step === 1 && (
        <div className="bg-gray-900/30 p-5 rounded-2xl border border-gray-800 space-y-4 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest block ml-1">장르</label>
              <div className="flex flex-wrap gap-1">
                {Object.values(Genre).slice(0, 15).map(g => (
                  <button key={g} onClick={() => setSelectedGenres(p => p.includes(g) ? p.filter(x => x!==g) : [...p, g])} className={`px-2 py-1 rounded-md border text-[9px] font-bold transition-all ${selectedGenres.includes(g) ? 'bg-blue-600 border-blue-400 text-white' : 'border-gray-800 text-gray-600 bg-gray-950/50'}`}>{g}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest block ml-1">어조</label>
              <div className="grid grid-cols-1 gap-1">
                {Object.values(Tone).map(t => (
                  <button key={t} onClick={() => setSelectedTone(t)} className={`px-3 py-1.5 text-left rounded-md border text-[10px] transition-all flex items-center justify-between ${selectedTone === t ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-gray-800 text-gray-500 bg-gray-950/50'}`}>
                    <span>{t}</span>
                    {selectedTone === t && <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></div>}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button disabled={!isKeySaved} onClick={() => setStep(2)} className="w-full bg-blue-700 py-3 rounded-xl font-black text-sm shadow-lg hover:bg-blue-600 transition-all disabled:opacity-30">스토리 기획 시작</button>
        </div>
      )}

      {step === 2 && (
        <div className="bg-gray-900/30 p-5 rounded-2xl border border-gray-800 space-y-3 animate-in slide-in-from-right-4">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-400">시나리오 구상</h2>
          <textarea value={subject} onChange={e => setSubject(e.target.value)} placeholder="이야기 내용을 입력하세요..." className="w-full h-32 bg-gray-950 border border-gray-800 rounded-xl p-4 text-xs focus:ring-1 focus:ring-blue-500 outline-none leading-relaxed" />
          <div className="grid grid-cols-2 gap-2">
            <input value={protagonist} onChange={e => setProtagonist(e.target.value)} className="p-2.5 bg-gray-950 border border-gray-800 rounded-lg text-[10px]" placeholder="주인공 정보" />
            <input value={background} onChange={e => setBackground(e.target.value)} className="p-2.5 bg-gray-950 border border-gray-800 rounded-lg text-[10px]" placeholder="배경 정보" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="flex-1 py-2.5 bg-gray-800 rounded-lg text-[10px] font-bold">이전</button>
            <button onClick={handleGenerateSynopsis} className="flex-[2] py-2.5 bg-blue-700 rounded-lg text-[10px] font-black">시나리오 생성</button>
          </div>
          {synopsis && (
            <div className="mt-3 p-4 bg-gray-950 rounded-xl border border-blue-500/10">
              <textarea value={synopsis} onChange={e => setSynopsis(e.target.value)} className="w-full h-40 bg-transparent border-none focus:ring-0 text-gray-400 text-[11px] leading-relaxed resize-none scrollbar-hide" />
              <button onClick={() => setStep(3)} className="w-full mt-3 py-3 bg-emerald-700 rounded-lg font-black text-sm">제작 설정 이동</button>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="bg-gray-900/30 p-6 rounded-2xl border border-gray-800 space-y-6 animate-in zoom-in-95">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <section className="space-y-3">
              <h3 className="text-xs font-black text-blue-500 uppercase tracking-widest">장면 수</h3>
              <div className="bg-gray-950 p-4 rounded-xl border border-gray-800">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[9px] text-gray-600 font-bold">총 장면</span>
                  <span className="text-2xl font-black text-blue-500">{sceneCount} <small className="text-[10px] text-gray-700">CUTS</small></span>
                </div>
                <input type="range" min="5" max="20" value={sceneCount} onChange={e => setSceneCount(Number(e.target.value))} className="w-full h-1 bg-gray-800 rounded-full appearance-none accent-blue-500" />
              </div>
            </section>
            <section className="space-y-3">
              <h3 className="text-xs font-black text-purple-500 uppercase tracking-widest">나레이션 (미리듣기 가능)</h3>
              <div className="grid grid-cols-5 gap-1">
                {Object.values(VoiceName).map(v => (
                  <button key={v} onClick={() => { setSelectedVoice(v); previewVoice(v); }} className={`py-1.5 rounded-md border text-[8px] font-black transition-all ${selectedVoice === v ? 'border-purple-500 bg-purple-500/20 text-white' : 'border-gray-800 text-gray-700 bg-gray-950'}`}>{v.split(' ')[0]}</button>
                ))}
              </div>
              <textarea value={voiceInstruction} onChange={e => setVoiceInstruction(e.target.value)} className="w-full h-16 bg-gray-950 border border-gray-800 rounded-lg p-3 text-[10px] outline-none" placeholder="어조 지시문..." />
            </section>
          </div>
          <button onClick={handleFullGenerate} className="w-full py-4 bg-gradient-to-r from-blue-700 to-indigo-800 rounded-xl font-black text-lg shadow-xl hover:scale-[1.01] transition-all">빌드 및 고속 렌더링 🚀</button>
        </div>
      )}

      {step === 4 && finalAssets && (
        <div className="space-y-4 animate-in fade-in duration-700 pb-20">
          <div className="sticky top-2 z-50 bg-gray-900/80 backdrop-blur-md p-3 rounded-xl border border-gray-800 shadow-2xl flex items-center justify-between gap-3">
            <div className="flex-1">
              <h2 className="text-[10px] font-black text-blue-400 truncate mb-1">{finalAssets.script.title}</h2>
              <audio controls className="w-full h-6 bg-gray-950 rounded-full">
                <source src={URL.createObjectURL(finalAssets.audioBlob!)} type="audio/wav" />
              </audio>
            </div>
            <button onClick={downloadZip} className="bg-orange-700 px-4 py-2 rounded-lg font-black text-[10px] shadow-lg">EXPORT 📦</button>
          </div>

          {/* Quick Control */}
          <div className="bg-gray-900/30 p-3 rounded-xl border border-gray-800 flex items-center justify-between">
            <div className="flex-1 max-w-xs space-y-1">
              <label className="text-[8px] font-black text-gray-600 uppercase tracking-widest block">보이스 업데이트</label>
              <div className="flex gap-1.5">
                <input value={voiceInstruction} onChange={e => setVoiceInstruction(e.target.value)} className="flex-1 bg-gray-950 border border-gray-800 rounded-md px-2 py-1 text-[9px] outline-none" />
                <button onClick={updateFullTTS} className="bg-purple-700 w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-black">↺</button>
              </div>
            </div>
            <button onClick={() => setStep(1)} className="text-[8px] font-black text-gray-700 uppercase tracking-widest hover:text-white">New Project</button>
          </div>

          {/* Scene Grid */}
          <div className="grid grid-cols-1 gap-4">
            {finalAssets.script.scenes.map((scene, idx) => (
              <div key={scene.id} className="group bg-gray-900/20 rounded-2xl border border-gray-800 overflow-hidden flex flex-col md:flex-row shadow-sm">
                <div className="md:w-5/12 relative aspect-video bg-gray-950">
                  {scene.imageUrl ? (
                    <img src={scene.imageUrl} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  ) : (
                    <div className="flex items-center justify-center h-full text-[8px] text-gray-800">RENDERING...</div>
                  )}
                  <div className="absolute top-2 left-2 bg-black/70 px-1.5 py-0.5 rounded-md text-[7px] font-black tracking-widest border border-white/5 uppercase">CUT {idx + 1}</div>
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button onClick={() => regenerateSceneImage(scene.id)} className="bg-white text-black px-4 py-1.5 rounded-full font-black text-[9px] shadow-lg active:scale-95 transition-all">이미지 재생성</button>
                  </div>
                </div>
                
                <div className="md:w-7/12 p-4 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <h4 className="text-[10px] font-black text-white">{scene.label}</h4>
                    <textarea 
                      value={scene.content} 
                      onChange={e => {
                        const newScenes = finalAssets.script.scenes.map(s => s.id === scene.id ? {...s, content: e.target.value} : s);
                        setFinalAssets({...finalAssets, script: {...finalAssets.script, scenes: newScenes}});
                      }}
                      className="w-full bg-transparent border-none focus:ring-0 text-[11px] text-gray-400 leading-relaxed resize-none h-20 scrollbar-hide"
                    />
                  </div>
                  <div className="flex justify-end">
                     <button onClick={() => regenerateSceneImage(scene.id)} className="text-[8px] font-black text-blue-800 hover:text-blue-500 uppercase tracking-tighter">Regenerate</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center pt-8">
            <button onClick={downloadZip} className="bg-blue-700 px-10 py-3 rounded-xl font-black text-sm shadow-xl hover:scale-105 transition-all">전체 다운로드 (.ZIP)</button>
          </div>
        </div>
      )}

      <footer className="mt-10 py-6 border-t border-gray-900 text-center opacity-10">
        <p className="text-[7px] font-black tracking-[0.4em] uppercase">Cinema Studio v2.7 • Performance Optimized</p>
      </footer>

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        input[type="range"]::-webkit-slider-thumb { border-radius: 50%; width: 10px; height: 10px; }
      `}</style>
    </div>
  );
};

export default App;
