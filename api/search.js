const fs = require('fs');
const path = require('path');

// 필요하면 실제 검색 로직으로 교체
async function performSearch(q) {
  // 예시: dict.zip이나 DB가 있으면 여기서 읽어 결과 반환
  // 현재는 샘플 데이터로 동작
  const sample = [
    { word: "사과", hint: "과일" },
    { word: "바나나", hint: "노란 과일" },
    { word: "컴퓨터", hint: "전자 기기" }
  ];
  return sample.filter(item => String(item.word).toLowerCase().includes(q.toLowerCase()));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(200).send(JSON.stringify([]));

    const results = await performSearch(q);
    return res.status(200).send(JSON.stringify(Array.isArray(results) ? results : []));
  } catch (err) {
    console.error('/api/search error', err && err.stack ? err.stack : err);
    // 에러가 나도 HTML이 아닌 JSON으로 응답
    return res.status(500).send(JSON.stringify({ error: 'internal' }));
  }
};