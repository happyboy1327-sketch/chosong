module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  const word = String(req.query.word || '').trim();
  const hint = String(req.query.hint || '').trim();

  if (!word) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).send(JSON.stringify({ success: false, message: 'word required' }));
  }

  // 여기서 실제 저장 로직을 넣을 수 있음. 현재는 확인 응답만 반환.
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).send(JSON.stringify({ success: true, message: `${word} 추가 완료` }));
};