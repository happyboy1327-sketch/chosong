const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');

const ZIP_PATH = path.join(__dirname, '..', 'dict.zip'); // 프로젝트 루트/dict.zip

function setCorsHeaders(res) {
  // 필요에 따라 '*' 대신 특정 도메인으로 변경하세요
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
}

function readZipMatches(q, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const results = [];
    let finished = false;
    const safeResolve = () => {
      if (!finished) {
        finished = true;
        resolve(results);
      }
    };

    if (!fs.existsSync(ZIP_PATH)) return safeResolve();

    yauzl.open(ZIP_PATH, { lazyEntries: true, decodeStrings: true }, (err, zipfile) => {
      if (err || !zipfile) {
        console.error('yauzl.open error', err);
        return safeResolve();
      }

      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        const filename = String(entry.fileName || '');
        if (!/\.json$/i.test(filename)) return zipfile.readEntry();

        zipfile.openReadStream(entry, (err, stream) => {
          if (err || !stream) {
            console.error('openReadStream error', err);
            return zipfile.readEntry();
          }

          const chunks = [];
          stream.on('data', (ch) => chunks.push(ch));
          stream.on('end', () => {
            try {
              const text = Buffer.concat(chunks).toString('utf8');
              const parsed = JSON.parse(text);
              const items = parsed?.channel?.item ?? parsed?.items ?? parsed;
              if (Array.isArray(items)) {
                for (const raw of items) {
                  const wordRaw = raw?.word_info?.word ?? raw?.word;
                  if (!wordRaw) continue;
                  if (String(wordRaw).toLowerCase().includes(q.toLowerCase())) {
                    const hint = raw?.word_info?.pos_info ?? raw?.hint ?? '';
                    results.push({ word: String(wordRaw), hint: hint || '정의 없음' });
                  }
                }
              }
            } catch (e) {
              console.error('JSON parse error for', filename, e);
            }
            zipfile.readEntry();
          });

          stream.on('error', (e) => {
            console.error('stream error', e);
            zipfile.readEntry();
          });
        });
      });

      zipfile.on('end', () => safeResolve());
      zipfile.on('error', (e) => {
        console.error('zipfile error', e);
        safeResolve();
      });
    });

    setTimeout(() => {
      console.warn('zip processing timeout');
      safeResolve();
    }, timeoutMs);
  });
}

module.exports = async (req, res) => {
  try {
    // 모든 응답에 CORS 헤더 설정
    setCorsHeaders(res);

    // 프리플라이트 요청 처리
    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }

    const q = String((req.query.q || req.body?.q || '').trim());
    res.setHeader('Content-Type', 'application/json');

    if (!q) return res.status(200).send(JSON.stringify([]));

    const results = []; // dict.json 사용 안함

    const zipMatches = await readZipMatches(q, 5000);
    for (const m of zipMatches) {
      if (!results.some(r => String(r.word) === String(m.word))) results.push(m);
    }

    return res.status(200).send(JSON.stringify(results));
  } catch (err) {
    console.error('API /api/search error', err);
    setCorsHeaders(res);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).send(JSON.stringify([]));
  }
};