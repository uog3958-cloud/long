
export enum Genre {
  MAK장 = "충격적인 막장 사연",
  HUMAN = "감동적인 휴먼 드라마",
  TEARS = "눈물나는 인생 고백",
  MYSTERY = "미스터리 추리극",
  THRILLER = "손에 땀을 쥐는 스릴러",
  REVENGE = "속 시원한 사이다 복수극",
  YADAM = "조선야담 (민담, 괴담)",
  SF = "SF / 판타지 세계관",
  HISTORY = "역사 / 시대극",
  FAMILY = "가슴 따뜻한 가족 이야기",
  LESSON = "사연으로 배우는 인생교훈",
  CHALLENGE = "인생도전 (시니어 성장담)",
  SURPRISE = "썰프라이즈 On TV",
  ADAPTATION = "드라마·영화 각색",
  YONGMUN = "용문",
  TRUE_CRIME = "실화 바탕 사건사고",
  ROMANCE = "한국형 멜로 / 운명 로맨스",
  GUKBONG = "국뽕 드라마"
}

export enum Tone {
  FORMAL = "설명체 (-습니다)",
  FRIENDLY = "친근체 (-요)",
  NOVEL = "소설체 (-다)"
}

export enum VoiceName {
  KORE = "Kore (표준 차분한 남성)",
  PUCK = "Puck (밝고 경쾌한 남성)",
  CHARON = "Charon (깊고 중후한 남성)",
  FENRIR = "Fenrir (강렬하고 날카로운 남성)",
  ZEPHYR = "Zephyr (부드러운 남성)"
}

export enum WorkMode {
  NEW = "새로운 스토리 구상",
  UPLOAD = "내 대본 사용하기 (TXT)",
  EXTEND = "대본 이어쓰기 (8부작 확장)",
  RESTORE = "지난 글 수정 / 복원"
}

export interface Scene {
  id: number;
  label: string;
  content: string;
  imagePrompt: string;
  imageUrl?: string | null;
}

export interface ScriptResult {
  title: string;
  scenes: Scene[];
}

export interface FinalAssets {
  script: ScriptResult;
  audioBlob: Blob | null;
}
