/**
 * ═══════════════════════════════════════════════════════════
 *   أثر AI — الوسيط الأمني (Secure Backend Proxy)
 *   api/ask.js — دالة Vercel Serverless
 * ═══════════════════════════════════════════════════════════
 */

const GEMINI_URL = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

// النماذج الرسمية المستقرة والسريعة المتاحة عبر Gemini API
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

const MAX_TEXT = 8000;          // أقصى طول لنص الطالب
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 10;            // طلبات/دقيقة لكل مستخدم
const DAILY_MAX = 120;          // طلبات/يوم لكل مستخدم

const minuteBuckets = new Map();
const dailyBuckets = new Map();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const ip = (typeof fwd === 'string' ? fwd.split(',')[0] : (req.socket && req.socket.remoteAddress)) || 'unknown';
  return ip.trim();
}

function checkRate(ip) {
  const now = Date.now();
  const day = new Date().toISOString().slice(0, 10);

  let m = minuteBuckets.get(ip);
  if (!m || now > m.resetAt) {
    m = { count: 0, resetAt: now + RATE_WINDOW_MS };
    minuteBuckets.set(ip, m);
  }
  m.count += 1;

  const dKey = ip + '|' + day;
  const dCount = (dailyBuckets.get(dKey) || 0) + 1;
  dailyBuckets.set(dKey, dCount);

  if (minuteBuckets.size > 5000) minuteBuckets.clear();
  if (dailyBuckets.size > 10000) dailyBuckets.clear();

  if (m.count > RATE_MAX) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((m.resetAt - now) / 1000)) };
  }
  if (dCount > DAILY_MAX) {
    return { ok: false, retryAfter: 3600 };
  }
  return { ok: true };
}

const SUBJECTS = ['رياضيات', 'فيزياء', 'كيمياء', 'أحياء', 'لغة عربية', 'لغة إنجليزية', 'تاريخ', 'جغرافيا', 'فلسفة', 'علم النفس'];
const GRADES = ['الأول الثانوي', 'الثاني الثانوي', 'الثالث الثانوي'];
const MODES = ['explain', 'summarize', 'quiz', 'chat'];

const SYSTEM_BASE = [
  'أنت «أثر AI»، مساعد تعليمي متخصص في مساعدة طلاب المرحلة الثانوية العرب.',
  'قواعدك: العربية الفصحى المبسطة، تنظيم الإجابة بعناوين ونقاط، أمثلة تطبيقية من الحياة اليومية،',
  'تشجيع الطالب دائماً، وعدم الخوض في مواضيع خارج النطاق الأكاديمي إلا إيجازاً ثم التوجيه للدراسة.',
].join(' ');

function buildPrompt(mode, subject, grade, text) {
  const ctx = `المادة: ${subject || 'عام'}. الصف الدراسي: ${grade || 'ثانوي'}.`;
  switch (mode) {
    case 'explain':
      return {
        system: SYSTEM_BASE,
        user: `${ctx}\nاشرح للطالب موضوع «${text}» شرحاً مفصلاً ومنظماً: عناوين رئيسية وفرعية، نقاط واضحة، ومثال تطبيقي في النهاية.`,
        json: false,
      };
    case 'summarize':
      return {
        system: SYSTEM_BASE,
        user: `${ctx}\nلخّص «${text}» في نقاط مركزة سهلة الحفظ للمذاكرة السريعة، ثم اختم بأهم المصطلحات وأوزانها في الامتحان.`,
        json: false,
      };
    case 'quiz':
      return {
        system: SYSTEM_BASE + ' عند وضع الاختبار، أخرج JSON صرفاً فقط دون أي نص خارج الهيكل.',
        user: `${ctx}\nأنشئ 5 أسئلة اختيار من متعدد متنوعة في الصعوبة عن «${text}» بمستوى يناسب الصف الدراسي.\n` +
          'أخرج JSON بالصيغة التالية حصراً:\n' +
          '{"questions":[{"question":"نص السؤال","options":["أ","ب","ج","د"],"correct":0,"explanation":"سبب الإجابة الصحيحة"}]}\n' +
          'حيث correct هو رقم الخيار الصحيح من 0 إلى 3.',
        json: true,
      };
    default:
      return { system: SYSTEM_BASE, user: `${ctx}\nسؤال الطالب: ${text}`, json: false };
  }
}

function clean(text) {
  return String(text || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

async function callGemini(model, apiKey, system, user) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(GEMINI_URL(model, apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 2048 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    const text = ((data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts) || [])
      .map((p) => p.text || '')
      .join('')
      .trim();
    if (!text) return { ok: false, status: 502 };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, status: e.name === 'AbortError' ? 504 : 500 };
  } finally {
    clearTimeout(timer);
  }
}

function validQuiz(parsed) {
  if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) return false;
  return parsed.questions.every((q) =>
    q &&
    typeof q.question === 'string' && q.question.length > 3 &&
    Array.isArray(q.options) && q.options.length >= 2 &&
    Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length
  );
}

function extractJson(raw) {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const origin = req.headers.origin;
  const allowedOrigin =
    origin && (origin.endsWith('.vercel.app') || /localhost:\d+$/.test(origin)) ? origin : null;
  if (allowedOrigin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'طريقة الطلب غير مدعومة.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      message: 'لم يُضبط مفتاح Gemini في الخادم بعد. أضف GEMINI_API_KEY في إعدادات Environment بمنصة Vercel.',
    });
  }

  const ip = clientIp(req);
  const rate = checkRate(ip);
  if (!rate.ok) {
    return res.status(429).json({
      ok: false,
      retryAfter: rate.retryAfter,
      message: 'أُرسلت طلبات كثيرة خلال فترة قصيرة. انتظر لحظات ثم أعد المحاولة.',
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const b = body || {};

  const safeMode = MODES.includes(b.mode) ? b.mode : 'chat';
  const safeSubject = SUBJECTS.includes(b.subject) ? b.subject : '';
  const safeGrade = GRADES.includes(b.grade) ? b.grade : '';
  const safeText = clean(b.text);

  if (!safeText || safeText.length < 2) {
    return res.status(400).json({ ok: false, message: 'اكتب سؤالك أو نص الدرس أولاً.' });
  }

  const prompt = buildPrompt(safeMode, safeSubject, safeGrade, safeText);

  let lastStatus = 500;
  for (const model of MODELS) {
    const r = await callGemini(model, apiKey, prompt.system, prompt.user);
    if (r.ok) {
      if (prompt.json) {
        const parsed = extractJson(r.text);
        if (validQuiz(parsed)) {
          return res.status(200).json({ ok: true, mode: 'quiz', quiz: parsed });
        }
        return res.status(200).json({ ok: true, mode: 'chat', text: r.text });
      }
      return res.status(200).json({ ok: true, mode: safeMode, text: r.text });
    }
    lastStatus = r.status;
  }

  const crowded = lastStatus === 429 || lastStatus === 503;
  return res.status(crowded ? 429 : 502).json({
    ok: false,
    retryAfter: crowded ? 30 : undefined,
    message: crowded
      ? 'الخدمة مزدحمة حالياً (تجاوز الحصة المجانية مؤقتاً). انتظر نحو دقيقة ثم أعد المحاولة.'
      : 'تعذر الاتصال بالخدمة حالياً. تحقق من الاتصال بالإنترنت ثم أعد المحاولة.',
  });
};
                   
