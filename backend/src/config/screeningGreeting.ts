import type { Language } from "./language";

export const SCREENING_GREETINGS: Record<Language, string> = {
  en: "Hello! I'm your health screening assistant. I'll ask you a few questions about your current health concern. What is your name?",
  hi: "नमस्ते! मैं आपका हेल्थ स्क्रीनिंग असिस्टेंट हूँ। मैं आपकी वर्तमान स्वास्थ्य समस्या के बारे में कुछ सवाल पूछूँगा। आपका नाम क्या है?",
};

export const FALLBACK_MESSAGES: Record<Language, { empty: string; error: string }> = {
  en: {
    empty: "I didn't quite catch that. Could you please repeat?",
    error: "I'm sorry, I had trouble processing that. Could you please repeat?",
  },
  hi: {
    empty: "मैं आपकी बात ठीक से समझ नहीं पाया। कृपया दोबारा बताएं।",
    error: "माफ़ कीजिए, मैं इसे संसाधित नहीं कर सका। क्या आप दोहरा सकते हैं?",
  },
};

export const LOCALIZED_ERRORS: Record<Language, { ttsUnavailable: string }> = {
  en: {
    ttsUnavailable:
      "The voice service is not configured. Please check the server configuration and try again.",
  },
  hi: {
    ttsUnavailable:
      "वॉइस सेवा कॉन्फ़िगर नहीं है। कृपया सर्वर कॉन्फ़िगरेशन जांचें और पुनः प्रयास करें।",
  },
};
