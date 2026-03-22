import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY! });

export const getFinancialAdvice = async (transactions: any[]) => {
  const recentTxs = transactions.slice(0, 10).map(t => `${t.date.split('T')[0]} - ${t.category}: ${t.type === 'expense' ? '-' : '+'}$${t.amount}`).join('\n');
  const prompt = `Analiza mis transacciones recientes y dame un consejo financiero breve, amigable y motivador de máximo 2 oraciones. Dirígete a mí directamente. Mis registros recientes:\n${recentTxs || "No hay transacciones recientes, motívame a usar la app."}`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction: "Eres un experto asesor financiero y un asistente de análisis de datos para una app móvil.",
    },
  });

  return response.text;
};

export const analyzeSmartText = async (text: string) => {
  const prompt = `Analiza el siguiente texto escrito de forma natural por un usuario y extrae los datos de la transacción financiera.
  Texto: "${text}"
  Fecha de hoy de referencia: ${new Date().toISOString().split('T')[0]}
  Categorías válidas obligatorias: Súper, Comida, Bencina, Arriendo, Otros, Ingresos.
  Determina si es ingreso ('income') o gasto ('expense').`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction: "Eres un experto asesor financiero y un asistente de análisis de datos para una app móvil.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          amount: { type: Type.NUMBER },
          category: { type: Type.STRING },
          note: { type: Type.STRING },
          date: { type: Type.STRING },
          type: { type: Type.STRING },
        },
      },
    },
  });

  return JSON.parse(response.text || '{}');
};
