export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "طريقة الطلب غير مسموحة"
    });
  }

  const {
    subject = "عام",
    task = "مستكشف المفاهيم",
    query,
    grade = "المرحلة الثانوية",
    studentName,
    statusName
  } = req.body || {};

  const name = studentName || statusName || "الطالب";
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "مفتاح Gemini غير موجود في إعدادات Vercel"
    });
  }

  if (!query || !query.trim()) {
    return res.status(400).json({
      error: "يرجى كتابة السؤال أولاً"
    });
  }

  const systemPrompt = `
أنت Athar AI (أثر)، معلم أكاديمي متخصص.
تساعد طلاب الثانوية العامة في الصف: ${grade}.
اسم الطالب: ${name}.
المادة: ${subject}.
المهمة الحالية: ${task}.

قواعدك:
1. اشرح باللغة العربية الواضحة.
2. ابدأ من الأساسيات ثم انتقل للتفاصيل.
3. استخدم أمثلة تعليمية.
4. عند التلخيص نظم المعلومات في نقاط.
5. عند حل المسائل اكتب القانون ثم خطوات الحل.
6. لا تخترع معلومات من المنهاج.
7. إذا كانت معلومات المنهاج غير متوفرة اطلب من الطالب إرسال النص أو صورة الدرس.
8. ناقش الطالب وصحح أخطاءه بلطف ودقة.
`;

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: [
            {
              role: "user",
              parts: [{ text: query }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4096
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API Error:", data);

      return res.status(502).json({
        error:
          data.error?.message ||
          `خطأ من Gemini: ${response.status}`
      });
    }

    const parts = data.candidates?.[0]?.content?.parts || [];

    const reply = parts
      .filter(part => typeof part.text === "string")
      .map(part => part.text)
      .join("\n")
      .trim();

    if (!reply) {
      console.error("Empty Gemini response:", data);

      return res.status(502).json({
        error: data.promptFeedback?.blockReason
          ? `تم رفض الطلب: ${data.promptFeedback.blockReason}`
          : `لم تصل إجابة نصية من Gemini. السبب: ${
              data.candidates?.[0]?.finishReason || "غير معروف"
            }`
      });
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("Server Error:", err);

    return res.status(500).json({
      error: "خطأ في الاتصال بخادم الذكاء الاصطناعي: " + err.message
    });
  }
}
