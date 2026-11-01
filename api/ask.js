export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { subject, task, query, grade, studentName } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) return res.status(500).json({ error: 'Server API key missing' });
  
  const systemPrompt = `أنت Athar AI (أثر)، معلم خبير في مناهج الثانوية لصف ${grade}. الطالب ${studentName}. المادة: ${subject} | المهمة: ${task}. قدّم إجابة دقيقة وعلمية ومفصلة.`;
  
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\nسؤال الطالب: ${query}` }] }]
      })
    });
    
    const data = await response.json();
    const reply = data.candidates ? data.candidates[0].content.parts[0].text : 'عذراً، لم يتمكن النموذج من الرد.';
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to connect to AI server' });
  }
}
