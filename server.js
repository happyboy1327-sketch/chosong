import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import yauzl from 'yauzl';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.PORT || 8080;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const ZIP_PATH = './dict.zip';

// =====================
// Firebase 초기화 개선
// =====================
let POOL_REF = null;
let isFirebaseInitialized = false;

function initializeFirebase() {
  try {
    let serviceAccount = null;

    // 1. 환경변수에서 서비스 계정 찾기
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      let accountStr = process.env.FIREBASE_SERVICE_ACCOUNT;

      // Base64 디코딩 시도
      if (accountStr.startsWith('ey') || accountStr.length > 500) {
        try {
          accountStr = Buffer.from(accountStr, 'base64').toString('utf-8');
        } catch (e) {
          // 그냥 문자열로 사용
        }
      }

      serviceAccount = JSON.parse(accountStr);
    }

    // 2. 환경변수 실패 시 로컬 파일 찾기
    if (!serviceAccount || Object.keys(serviceAccount).length === 0) {
      const possiblePaths = [
        './firebase-key.json',
        './serviceAccountKey.json',
        path.join(process.env.HOME || process.env.USERPROFILE || '.', '.firebase/key.json')
      ];

      for (const filePath of possiblePaths) {
        try {
          if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            serviceAccount = JSON.parse(fileContent);
            console.log(`✅ 로컬 파일에서 서비스 계정 로드: ${filePath}`);
            break;
          }
        } catch (e) {
          // 계속 진행
        }
      }
    }

    // 3. Firebase 초기화
    if (serviceAccount && Object.keys(serviceAccount).length > 0) {
      const databaseURL =
        process.env.FIREBASE_DATABASE_URL ||
        `https://${serviceAccount.project_id}.firebaseio.com`;

      if (admin.apps.length === 0) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: databaseURL
        });
      }

      const db = admin.database();
      POOL_REF = db.ref('quiz_pool');
      isFirebaseInitialized = true;

      console.log(`✅ Firebase 초기화 성공`);
      console.log(`   프로젝트: ${serviceAccount.project_id}`);
      console.log(`   DB URL: ${databaseURL}`);

      return true;
    } else {
      console.warn('⚠️ Firebase 서비스 계정을 찾을 수 없습니다.');
      console.warn('   다음 중 하나를 설정하세요:');
      console.warn('   1. FIREBASE_SERVICE_ACCOUNT 환경변수 (JSON 또는 Base64)');
      console.warn('   2. ./firebase-key.json 파일');
      console.warn('   3. ./serviceAccountKey.json 파일');
      return false;
    }
  } catch (e) {
    console.error('❌ Firebase 초기화 실패:', e.message);
    return false;
  }
}

// Firebase 초기화 실행
initializeFirebase();

app.use(cors());
app.use(express.static(path.join(process.cwd(), 'public')));

// Favicon 404 제거
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// 루트 경로에서 index.html 서빙
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'), (err) => {
    if (err) {
      console.warn('⚠️ index.html을 찾을 수 없습니다');
      res.status(404).json({ error: 'index.html not found' });
    }
  });
});

// 진단용 로깅
app.use((req, res, next) => {
  console.log(`[[REQ]] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

app.get('/api/ping', (req, res) => {
  res.json({ ok: true, now: new Date().toISOString(), pid: process.pid });
});

app.get('/api/test-search', (req, res) => {
  const q = (req.query.word || req.query.q || '').trim();
  if (!q) return res.json([]);
  return res.json([
    { word: '테스트단어', hint: '임시' },
    { word: q + '_매칭', hint: '임시' }
  ]);
});

// =====================
// 초성 추출
// =====================
const CHOSUNG_LIST = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ',
  'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

function getChosung(text) {
  const result = [];
  for (let char of text) {
    const code = char.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      result.push(CHOSUNG_LIST[Math.floor((code - 0xAC00) / 588)]);
    } else if (char === ' ') {
      result.push(' ');
    }
  }
  return result;
}

// =====================
// 힌트 추출
// =====================
function extractHint(posInfo, wordInfo) {
  if (!posInfo) return null;

  if (wordInfo?.word_unit === '속담') {
    for (const pos of posInfo) {
      if (!pos.comm_pattern_info) continue;
      for (const comm of pos.comm_pattern_info) {
        if (!comm.sense_info) continue;
        for (const sense of comm.sense_info) {
          let hint = sense.definition || sense.definition_original;
          if (hint) {
            hint = hint
              .replace(/<[^>]*>/g, '')
              .replace(/\d{5,}/g, '')
              .replace(/'[^']*'/g, '')
              .replace(/[_\[\]「」『』()]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            if (hint.length >= 5 && hint.length <= 200) {
              return '속담: ' + hint;
            }
          }
        }
      }
    }
  }

  for (const pos of posInfo) {
    if (!pos.comm_pattern_info) continue;
    for (const comm of pos.comm_pattern_info) {
      if (!comm.sense_info) continue;
      for (const sense of comm.sense_info) {
        let hint = sense.definition_original;
        if (!hint) continue;
        hint = hint
          .replace(/<[^>]*>/g, '')
          .replace(/\d{5,}/g, '')
          .replace(/'[^']*'/g, '')
          .replace(/[_\[\]「」『』()]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (
          hint.length >= 1 &&
          hint.length <= 160 &&
          !/^\d+$/.test(hint) &&
          !hint.includes('<') &&
          !hint.includes('>')
        ) {
          return hint;
        }
      }
    }
  }
  return null;
}

// =====================
// 단어 필터링
// =====================
function isGoodWord(wordRaw, hint, word_unit, type) {
  if (!wordRaw) return false;
  if (wordRaw.includes('_') || wordRaw.includes('^') || wordRaw.includes('-')) return false;

  if (word_unit === '속담') {
    if (wordRaw.length < 3 || wordRaw.length > 15) return false;
    if (!hint) return false;
    return true;
  }

  const word = wordRaw.trim();
  if (word.length < 2 || word.length > 10) return false;
  if (['혼종어', '외래어'].includes(type)) return false;
  return true;
}

// =====================
// Firebase DB 함수들 (안전하게 개선)
// =====================

async function isWordExistsInDB(word) {
  if (!POOL_REF) {
    console.warn('⚠️ isWordExistsInDB: POOL_REF 미설정');
    return false;
  }

  try {
    const snapshot = await POOL_REF.orderByChild('word').equalTo(word).once('value');
    return snapshot.exists();
  } catch (error) {
    console.error(`❌ [중복체크 오류] ${word}:`, error?.message || error);
    return false; // 에러 발생 시 false 반환 (서버는 계속 동작)
  }
}

async function addWordToPool(wordObj) {
  if (!POOL_REF) {
    console.warn('⚠️ addWordToPool: POOL_REF 미설정');
    return null;
  }

  try {
    const key = `${wordObj.word}_${Date.now()}`;
    await POOL_REF.child(key).set(wordObj);
    return key;
  } catch (error) {
    console.error(`❌ [DB저장 오류] ${wordObj.word}:`, error?.message || error);
    return null;
  }
}

async function getPoolFromDB() {
  if (!POOL_REF) {
    console.warn('⚠️ getPoolFromDB: POOL_REF 미설정, 빈 배열 반환');
    return [];
  }

  try {
    const snapshot = await POOL_REF.once('value');
    const data = snapshot.val();
    if (!data) return [];
    return Object.values(data);
  } catch (error) {
    console.error(`❌ [DB로드 오류]:`, error?.message || error);
    return [];
  }
}

// =====================
// 유틸리티
// =====================
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// =====================
// API: 검색
// =====================
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  const db = await loadDictionary();
  const results = db.filter(item => item.word.includes(q));

  let responded = false;

  yauzl.open(ZIP_PATH, { lazyEntries: true, decodeStrings: false }, (err, zipfile) => {
    if (err || !zipfile) {
      if (!responded) {
        responded = true;
        return res.json(results);
      }
      return;
    }

    zipfile.readEntry();

    zipfile.on('entry', entry => {
      if (!/\.json$/i.test(entry.fileName)) {
        return zipfile.readEntry();
      }

      zipfile.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          return zipfile.readEntry();
        }

        const chunks = [];
        stream.on('data', ch => chunks.push(ch));
        stream.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const items = parsed?.channel?.item;

            if (Array.isArray(items)) {
              for (const raw of items) {
                const wordRaw = raw?.word_info?.word;
                if (!wordRaw) continue;

                if (wordRaw.toLowerCase().includes(q.toLowerCase())) {
                  const hint = extractHint(raw.word_info?.pos_info, raw.word_info);
                  results.push({
                    word: wordRaw,
                    hint: hint || '정의 없음'
                  });
                }
              }
            }
          } catch (e) {}
          zipfile.readEntry();
        });
      });
    });

    zipfile.on('end', () => {
      if (!responded) {
        responded = true;
        return res.json(results);
      }
    });
  });
});

// =====================
// API: 퀴즈 배치
// =====================
app.get('/api/newbatch', async (req, res) => {
  try {
    const poolData = await getPoolFromDB();
    if (poolData.length === 0) return res.json([]);

    const shuffled = [...poolData];
    shuffleArray(shuffled);
    const result = shuffled.slice(0, 19);
    return res.json(result);
  } catch (error) {
    console.error(`❌ [배치생성 오류]:`, error?.message || error);
    return res.json([]);
  }
});

// =====================
// API: DB 초기화
// =====================
app.get('/api/clear-pool', async (req, res) => {
  if (!POOL_REF) {
    return res.json({ success: false, message: 'Firebase 미설정' });
  }

  try {
    await POOL_REF.remove();
    return res.json({ success: true, message: '퀴즈 풀 전체 삭제 완료' });
  } catch (error) {
    console.error(`❌ [DB초기화 오류]:`, error?.message || error);
    return res.json({ success: false, message: `오류: ${error?.message || error}` });
  }
});

// =====================
// API: 단어 추가
// =====================
app.get('/api/add-word', async (req, res) => {
  const { word, hint } = req.query;
  if (!word || !hint) {
    return res.json({ success: false, message: '단어와 뜻이 필요합니다.' });
  }

  try {
    const cho = getChosung(word);
    if (!cho || cho.length === 0) {
      return res.json({ success: false, message: '초성을 추출할 수 없습니다.' });
    }

    const exists = await isWordExistsInDB(word);
    if (exists) {
      return res.json({ success: false, message: '이미 추가된 단어입니다.' });
    }

    const wordObj = {
      word: word,
      question: cho,
      hint: hint || '정의 없음',
      addedAt: new Date().toISOString()
    };

    const key = await addWordToPool(wordObj);
    if (!key) {
      return res.json({ success: false, message: '단어 저장 실패 (Firebase 미설정)' });
    }

    const poolData = await getPoolFromDB();
    const totalCount = poolData.length;
    return res.json({
      success: true,
      message: `${word} 추가됨 (총 ${totalCount}개)`,
      key
    });
  } catch (error) {
    console.error(`❌ [단어추가 오류]:`, error?.message || error);
    return res.json({ success: false, message: `오류 발생: ${error?.message || error}` });
  }
});

// =====================
// ZIP 로딩
// =====================
function loadDictionary(limit = 7) {
  return new Promise((resolve, reject) => {
    const choGroups = new Map();

    yauzl.open(ZIP_PATH, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err || new Error('ZIP 열기 실패'));

      zipfile.readEntry();

      zipfile.on('entry', entry => {
        if (!/\.json$/i.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }

        zipfile.openReadStream(entry, (err, readStream) => {
          if (err || !readStream) {
            zipfile.readEntry();
            return;
          }

          const buffer = [];
          readStream.on('data', chunk => buffer.push(chunk));

          readStream.on('end', () => {
            try {
              const jsonStr = Buffer.concat(buffer).toString('utf8');
              const parsed = JSON.parse(jsonStr);
              const items = parsed?.channel?.item;

              if (Array.isArray(items)) {
                for (const raw of items) {
                  const wordRaw = raw?.word_info?.word;
                  if (!wordRaw) continue;

                  const unit = raw.word_info?.word_unit;
                  const type = raw.word_info?.word_type;
                  const hint = extractHint(raw.word_info?.pos_info, raw.word_info);

                  if (!isGoodWord(wordRaw, hint, unit, type)) continue;

                  const cho = getChosung(wordRaw);
                  if (!cho) continue;

                  const choKey = cho.join('');
                  if (!choGroups.has(choKey)) choGroups.set(choKey, []);
                  choGroups.get(choKey).push({
                    word: wordRaw,
                    question: cho,
                    hint: hint || '정의 없음'
                  });
                }
              }
            } catch (e) {
              // 파싱 오류는 무시
            } finally {
              zipfile.readEntry();
            }
          });

          readStream.on('error', () => {
            zipfile.readEntry();
          });
        });
      });

      zipfile.on('end', () => {
        const allChoKeys = Array.from(choGroups.keys());
        shuffleArray(allChoKeys);
        const result = [];
        for (const choKey of allChoKeys) {
          if (result.length >= limit) break;
          const group = choGroups.get(choKey);
          if (!group || group.length === 0) continue;
          const picked = group[Math.floor(Math.random() * group.length)];
          result.push(picked);
        }
        resolve(result);
      });

      zipfile.on('error', e => reject(e));
    });
  });
}

// =====================
// 서버 시작
// =====================
async function startServer() {
  console.log('🚀 [서버시작] 초기화 시작');

  try {
    const existingPool = await getPoolFromDB();
    console.log(`📊 [서버시작] 기존 Firebase 퀴즈 풀: ${existingPool.length}개`);

    if (!isFirebaseInitialized) {
      console.warn(
        '⚠️ Firebase가 초기화되지 않았습니다. ZIP 데이터를 데이터베이스에 저장할 수 없습니다.'
      );
      console.warn('   메모리 검색만 사용 가능합니다.');
    } else {
      const newData = await loadDictionary(7);
      console.log(`📥 [서버시작] ZIP 로드 완료: ${newData.length}개 단어`);

      let savedCount = 0;
      const seenDuringStartup = new Set();

      for (const item of newData) {
        try {
          if (!item?.word) continue;
          const normalized = item.word.trim();
          if (seenDuringStartup.has(normalized)) continue;

          const exists = await isWordExistsInDB(normalized);
          if (exists) {
            seenDuringStartup.add(normalized);
            continue;
          }

          const key = await addWordToPool(item);
          if (key) {
            savedCount++;
            seenDuringStartup.add(normalized);
            console.log(`✅ [저장완료] "${normalized}" 저장됨`);
          }
        } catch (error) {
          console.error('단어 추가 실패:', error?.message || error);
          continue;
        }
      }

      const finalPool = await getPoolFromDB();
      console.log(`📊 [서버시작] 최종 풀 조회 완료: ${finalPool.length}개`);
    }

    // 서버 리스닝
    if (!process.env.VERCEL) {
      app.listen(PORT, () => {
        console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
      });
    } else {
      console.log('ℹ️ Vercel 환경: listen 생략 (서버리스 함수로 동작)');
    }
  } catch (error) {
    console.error('❌ [서버시작] 심각한 오류:', error?.stack || error);
    if (!process.env.VERCEL) process.exit(1);
    throw error;
  }
}

// 서버 시작
startServer().catch(err =>
  console.error('startServer failed:', err?.message || err)
);