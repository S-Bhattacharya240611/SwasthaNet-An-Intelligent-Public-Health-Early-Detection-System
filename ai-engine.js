import { GoogleGenAI, Type } from '@google/genai';
import { pipeline, cos_sim, env } from '@xenova/transformers';

// CRITICAL FIX: Disable local models to prevent Vite SPA fallback from returning index.html
env.allowLocalModels = false;
env.useBrowserCache = false;

export class AIEngine {
    constructor() {
        this.mode = 'initializing'; // 'initializing', 'ai', 'expert'
        this.extractor = null;
        this.gemini = null;

        try {
            if (process.env.GEMINI_API_KEY) {
                this.gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            }
        } catch (e) {
            console.warn("Gemini API Key not found or error initializing:", e);
        }
        
        // Expanded symptoms dictionary for AI embedding comparison
        this.symptomDict = [
            "Headache", "Fever", "Cough", "Fatigue", "Nausea", 
            "Shortness of breath", "Body ache", "Sore throat", "Dizziness",
            "Stomach ache", "Diarrhea", "Vomiting", "Chills", "Sweating", 
            "Chest pain", "Runny nose", "Congestion", "Loss of taste", 
            "Loss of smell", "Muscle pain", "Joint pain", "Rash", "Itching", 
            "Insomnia", "Anxiety", "Palpitations", "Wheezing", "Sneezing"
        ];
        this.symptomEmbeddings = null;

        // Expanded Expert System Fallback Data
        this.symptomSynonyms = {
            "Headache": ["head hurts", "pounding head", "migraine", "headache"],
            "Fever": ["hot", "temperature", "fever", "chills", "sweating"],
            "Cough": ["coughing", "hacking", "cough"],
            "Fatigue": ["tired", "exhausted", "weak", "fatigue", "no energy"],
            "Nausea": ["throw up", "vomit", "nauseous", "sick to stomach", "stomach ache", "diarrhea"],
            "Sore throat": ["throat hurts", "swallowing hurts", "sore throat"],
            "Runny nose": ["runny nose", "sniffles", "sneezing", "congestion"]
        };

        this.conditionGraph = {
            "Viral Fever": {
                symptoms: { "Fever": 0.5, "Fatigue": 0.2, "Body ache": 0.2, "Chills": 0.1 },
                advice: "Rest, stay hydrated. Consume light food like Khichdi. Drink Tulsi tea.",
                baseProb: 0.1
            },
            "Common Cold": {
                symptoms: { "Cough": 0.3, "Sore throat": 0.3, "Runny nose": 0.2, "Congestion": 0.1, "Sneezing": 0.1 },
                advice: "Inhale steam. Drink warm water with honey and ginger.",
                baseProb: 0.15
            },
            "Dehydration/Heat Exhaustion": {
                symptoms: { "Dizziness": 0.4, "Fatigue": 0.3, "Headache": 0.2, "Sweating": 0.1 },
                advice: "Drink ORS (Oral Rehydration Solution) immediately. Rest in a cool place.",
                baseProb: 0.05
            },
            "Gastroenteritis (Stomach Bug)": {
                symptoms: { "Nausea": 0.3, "Vomiting": 0.3, "Diarrhea": 0.3, "Stomach ache": 0.1 },
                advice: "Drink plenty of fluids, ORS, and eat bland foods like rice and yogurt.",
                baseProb: 0.05
            },
            "Allergies": {
                symptoms: { "Sneezing": 0.3, "Runny nose": 0.3, "Itching": 0.2, "Rash": 0.2 },
                advice: "Avoid allergens. Consider an antihistamine if severe.",
                baseProb: 0.1
            },
            "Migraine": {
                symptoms: { "Headache": 0.6, "Nausea": 0.2, "Dizziness": 0.2 },
                advice: "Rest in a dark, quiet room. Stay hydrated.",
                baseProb: 0.05
            },
            "Stress/Anxiety": {
                symptoms: { "Anxiety": 0.4, "Palpitations": 0.3, "Insomnia": 0.2, "Fatigue": 0.1 },
                advice: "Practice deep breathing or meditation. Ensure adequate sleep.",
                baseProb: 0.1
            }
        };
    }

    async init(statusCallback) {
        try {
            statusCallback('Initializing AI Brain (Downloading model)...', 'warning');

            this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                quantized: true, // Use quantized model for browser performance
            });

            // Pre-compute embeddings for known symptoms
            this.symptomEmbeddings = await Promise.all(
                this.symptomDict.map(sym => this.extractor(sym, { pooling: 'mean', normalize: true }))
            );

            this.mode = 'ai';
            statusCallback('AI Ready', 'safe');
            console.log("AI Engine initialized successfully.");
        } catch (error) {
            console.error("AI Initialization failed, falling back to Expert System:", error);
            this.mode = 'expert';
            statusCallback('Offline Mode (Expert System)', 'primary');
        }
    }

    async analyzeSymptoms(text) {
        // 1. Try Online LLM (Gemini) first for maximum accuracy and open-ended detection
        if (this.gemini && navigator.onLine) {
            try {
                const response = await this.gemini.models.generateContent({
                    model: "gemini-3-flash-preview",
                    contents: `Analyze these symptoms: "${text}". Provide a list of possible medical conditions, the probability (0.0 to 1.0), advice for home care (especially relevant to Indian contexts like ORS, Tulsi, etc. if applicable), and the specific symptoms matched.`,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    condition: { type: Type.STRING },
                                    probability: { type: Type.NUMBER },
                                    advice: { type: Type.STRING },
                                    matchedSymptoms: { type: Type.ARRAY, items: { type: Type.STRING } }
                                },
                                required: ["condition", "probability", "advice", "matchedSymptoms"]
                            }
                        }
                    }
                });
                
                const results = JSON.parse(response.text.trim());
                if (results && results.length > 0) {
                    return results.sort((a, b) => b.probability - a.probability);
                }
            } catch (error) {
                console.error("Gemini API failed, falling back to local AI:", error);
            }
        }

        // 2. Fallback to Local AI (Transformers.js) or Expert System
        let detectedSymptoms = [];

        if (this.mode === 'ai' && this.extractor) {
            // AI Path: Split input into phrases to detect multiple distinct symptoms accurately
            const phrases = text.split(/,|\.| and | or | but /i).map(s => s.trim()).filter(s => s.length > 0);
            
            for (const phrase of phrases) {
                const inputEmbedding = await this.extractor(phrase, { pooling: 'mean', normalize: true });
                for (let i = 0; i < this.symptomDict.length; i++) {
                    const similarity = cos_sim(inputEmbedding.data, this.symptomEmbeddings[i].data);
                    if (similarity > 0.40) { // Lowered threshold to catch more variations
                        detectedSymptoms.push(this.symptomDict[i]);
                    }
                }
            }
        } else {
            // Expert System Path
            const lowerText = text.toLowerCase();
            for (const [symptom, synonyms] of Object.entries(this.symptomSynonyms)) {
                for (const syn of synonyms) {
                    if (lowerText.includes(syn)) {
                        detectedSymptoms.push(symptom);
                        break;
                    }
                }
            }
        }

        // Deduplicate
        detectedSymptoms = [...new Set(detectedSymptoms)];

        if (detectedSymptoms.length === 0) {
            // Attempt to find the absolute closest match even if below threshold
            if (this.mode === 'ai' && this.extractor) {
                let bestMatch = null;
                let highestSim = -1;
                const inputEmbedding = await this.extractor(text, { pooling: 'mean', normalize: true });
                for (let i = 0; i < this.symptomDict.length; i++) {
                    const similarity = cos_sim(inputEmbedding.data, this.symptomEmbeddings[i].data);
                    if (similarity > highestSim) {
                        highestSim = similarity;
                        bestMatch = this.symptomDict[i];
                    }
                }
                if (bestMatch && highestSim > 0.2) {
                    detectedSymptoms.push(bestMatch);
                }
            }
        }

        if (detectedSymptoms.length === 0) {
            return [{ 
                condition: "Unspecified Discomfort", 
                probability: 0.3, 
                advice: "We couldn't map your exact symptoms to our local database. Please rest, stay hydrated, and consult a doctor if you feel unwell.", 
                matchedSymptoms: ["Unrecognized symptoms"] 
            }];
        }

        // Calculate probabilities based on conditionGraph
        let results = [];
        for (const [condition, data] of Object.entries(this.conditionGraph)) {
            let score = 0;
            for (const sym of detectedSymptoms) {
                if (data.symptoms[sym]) {
                    score += data.symptoms[sym];
                }
            }
            if (score > 0) {
                // Bayesian-like adjustment
                let prob = Math.min(score + data.baseProb, 0.95);
                results.push({
                    condition: condition,
                    probability: prob,
                    advice: data.advice,
                    matchedSymptoms: detectedSymptoms
                });
            }
        }

        results.sort((a, b) => b.probability - a.probability);
        
        if (results.length === 0) {
            return [{ 
                condition: "Symptomatic Discomfort", 
                probability: 0.4, 
                advice: "Monitor your symptoms closely. Rest and drink plenty of fluids. Consult a healthcare provider if symptoms worsen.", 
                matchedSymptoms: detectedSymptoms 
            }];
        }
        
        return results;
    }

    calculateBaseline(history) {
        if (!history || history.length === 0) return { fatigue: 0, sleep: 0, exertion: 0 };
        const recent = history.slice(-7); // Last 7 days
        const sum = recent.reduce((acc, log) => {
            acc.fatigue += log.fatigue;
            acc.sleep += log.sleep;
            acc.exertion += log.exertion;
            return acc;
        }, { fatigue: 0, sleep: 0, exertion: 0 });

        return {
            fatigue: sum.fatigue / recent.length,
            sleep: sum.sleep / recent.length,
            exertion: sum.exertion / recent.length
        };
    }

    calculateEnvironmentalRisk(weatherData, userProfile) {
        let risks = [];
        let riskLevel = 'Low';

        if (!weatherData) return { level: 'Unknown', warnings: [] };

        const temp = weatherData.temperature;
        const aqi = weatherData.aqi;

        // Temperature Risk
        if (temp > 38) {
            risks.push({ message: "Extreme Heat: High risk of heatstroke. Stay indoors and drink plenty of water/ORS.", severity: "High" });
            riskLevel = 'High';
        } else if (temp > 32) {
            risks.push({ message: "High Heat: Stay hydrated and avoid direct sun.", severity: "Moderate" });
            if (riskLevel === 'Low') riskLevel = 'Moderate';
        }

        // AQI Risk
        if (aqi > 150) {
            let warning = { message: "Poor Air Quality: Limit outdoor exertion.", severity: "Moderate" };
            if (userProfile.conditions && userProfile.conditions.toLowerCase().includes('asthma')) {
                warning = { message: "CRITICAL Air Quality for Asthma: Stay indoors, keep inhaler handy.", severity: "High" };
                riskLevel = 'High';
            } else if (aqi > 200) {
                warning = { message: "Very Poor Air Quality: Health alert. Everyone may experience health effects.", severity: "High" };
                riskLevel = 'High';
            }
            risks.push(warning);
            if (riskLevel !== 'High') riskLevel = 'Moderate';
        }

        return { level: riskLevel, warnings: risks };
    }
}
