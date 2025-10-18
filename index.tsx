// Vocab Practice App
// Features:
// - Learn new English words with Arabic translations and explanations.
// - Handles multiple meanings and parts of speech for a single word.
// - Interactive quizzes (Gap-Fill, Multiple Choice, Flashcard) for each meaning with enhanced feedback.
// - AI-POWERED SPACED REPETITION: Intelligently schedules and reviews words based on user performance.
// - Saves learned words and SRS data to localStorage for persistence.
// - THEME SELECTOR: User can choose from multiple color schemes.
// - Printable word list modal with CSV EXPORT.
// - Robust error handling for API calls.

import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from '@google/genai';
import { motion, AnimatePresence } from 'framer-motion';

// --- TYPE DEFINITIONS ---

interface MultipleChoice {
  options: string[];
  correct_answer: string;
}

interface Meaning {
  part_of_speech_english: string;
  part_of_speech_arabic: string;
  one_word_arabic: string;
  explanation_arabic: string;
  example_sentence_english: string;
  example_sentence_arabic: string;
  gap_fill_prompt: string;
  gap_fill_full_sentence: string;
  gap_fill_full_sentence_arabic: string;
  multiple_choice_prompt: string;
  multiple_choice_full_sentence: string;
  multiple_choice_full_sentence_arabic: string;
  multiple_choice: MultipleChoice;
  // Spaced Repetition System (SRS) properties
  srs_level: number;
  next_review_date: number; // Stored as a UTC timestamp (Date.now())
}

interface VocabData {
  id: string; // Unique ID for animations
  word: string;
  meanings: Meaning[];
}

interface ReviewItem {
    word: string;
    meaning: Meaning;
    meaningIndex: number;
    wordId: string;
}

type Theme = 'violet-yellow' | 'blue-green' | 'monochromatic';

interface ThemeOption {
    id: Theme;
    name: string;
    colors: { primary: string; secondary: string };
}

// --- CONSTANTS ---

const themes: ThemeOption[] = [
    { id: 'violet-yellow', name: 'Vibrant Violet', colors: { primary: '#8338EC', secondary: '#FFBE0B' } },
    { id: 'blue-green', name: 'Calm Blue', colors: { primary: '#2D7DD2', secondary: '#90BE6D' } },
    { id: 'monochromatic', name: 'Classic Dark', colors: { primary: '#343A40', secondary: '#ADB5BD' } },
];

// Spaced Repetition intervals in hours.
const srsIntervalsHours: number[] = [
    4,    // Level 1: 4 hours
    8,    // Level 2: 8 hours
    24,   // Level 3: 1 day
    72,   // Level 4: 3 days
    168,  // Level 5: 1 week
    336,  // Level 6: 2 weeks
    720,  // Level 7: 1 month
    2160, // Level 8: 3 months
];


// --- SVG ICONS ---

const SentenceIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 6.1H3" />
        <path d="M21 12.1H3" />
        <path d="M15.1 18.1H3" />
    </svg>
);

const QuizIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 10.5c.3-.3.8-.3 1.1 0l1.4 1.4c.3.3.3.8 0 1.1l-1.4 1.4c-.3.3-.8.3-1.1 0l-1.4-1.4c-.3-.3-.3-.8 0-1.1l1.4-1.4z" />
        <path d="m11.5 13.5-1 1" />
        <path d="M3 21l3-3" />
        <path d="M21 3l-3 3" />
        <path d="M3 3l18 18" />
    </svg>
);

const StarIcon: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
    <motion.svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={style}
    >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </motion.svg>
);

// --- UTILITY FUNCTIONS ---

/**
 * Validates and cleans the data from the AI response to prevent crashes.
 * @param data The parsed JSON data from the Gemini API.
 * @returns The validated and cleaned data.
 */
const validateApiResponse = (data: any): { meanings: any[] } => {
    if (!data || !Array.isArray(data.meanings)) {
        throw new Error("AI response is missing 'meanings' array.");
    }

    data.meanings.forEach((meaning: any) => {
        if (meaning.multiple_choice && Array.isArray(meaning.multiple_choice.options)) {
            const { options, correct_answer } = meaning.multiple_choice;
            // Ensure the correct answer is always one of the options.
            if (!options.includes(correct_answer)) {
                console.warn("Fixing API response: Correct answer was not in options. Replacing an incorrect option.");
                // Replace the last option with the correct answer.
                options[options.length - 1] = correct_answer;
            }
        }
    });

    return data;
};


// --- REACT COMPONENTS ---
const App: React.FC = () => {
  const [vocabList, setVocabList] = useState<VocabData[]>([]);
  const [word, setWord] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showReviewPrompt, setShowReviewPrompt] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [theme, setTheme] = useState<Theme>('violet-yellow');
  const inputRef = useRef<HTMLInputElement>(null);


  // Load vocab list and theme from localStorage on initial render
  useEffect(() => {
    try {
      const savedList = localStorage.getItem('vocabList');
      if (savedList) {
          const parsedData = JSON.parse(savedList);
          if (!Array.isArray(parsedData)) {
              console.error("Loaded vocabList from localStorage is not an array.");
              return;
          }
          const parsedList: any[] = parsedData;
          
          // Robust data migration and validation to prevent crashes from malformed localStorage data.
          const migratedList = parsedList
            .filter(item => typeof item === 'object' && item !== null && Array.isArray(item.meanings) && typeof item.word === 'string')
            .map(item => {
              const validMeanings = item.meanings.map((m: any) => {
                  // Ensure 'm' is a proper object and not an array or null.
                  if (typeof m !== 'object' || m === null || Array.isArray(m)) return null;

                  // Check for nested properties that are critical for rendering to prevent crashes.
                  if (!m.multiple_choice || typeof m.multiple_choice !== 'object' || !Array.isArray(m.multiple_choice.options)) {
                      console.warn("Filtering out malformed meaning from localStorage due to invalid 'multiple_choice' structure:", m);
                      return null;
                  }
                  
                  // Ensure other critical fields are present.
                  if (typeof m.gap_fill_prompt !== 'string' || typeof m.one_word_arabic !== 'string') {
                      console.warn("Filtering out malformed meaning from localStorage due to missing critical properties:", m);
                      return null;
                  }

                  const hasSrsData = 'srs_level' in m && 'next_review_date' in m;
                  if (hasSrsData) return m;

                  // If old data, initialize SRS properties
                  return { ...m, srs_level: 0, next_review_date: Date.now() };
              }).filter(Boolean); // Filter out any nulls from invalid meanings

              return { ...item, meanings: validMeanings };
            })
            .filter(item => item.meanings.length > 0); // Remove words that have no valid meanings left

          setVocabList(migratedList);
      }
      
      const savedTheme = localStorage.getItem('vocabTheme') as Theme;
      if (savedTheme && themes.some(t => t.id === savedTheme)) {
        setTheme(savedTheme);
      }
    } catch (e) {
      console.error("Failed to load from localStorage", e);
      // If parsing fails, clear the corrupted data to prevent future errors.
      localStorage.removeItem('vocabList');
    }
  }, []);

  // Save vocab list to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('vocabList', JSON.stringify(vocabList));
    } catch (e) {
      console.error("Failed to save vocab list to localStorage", e);
    }
  }, [vocabList]);

  // Save theme to localStorage and apply to body whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('vocabTheme', theme);
      document.body.className = `theme-${theme}`;
    } catch (e) {
      console.error("Failed to save theme to localStorage", e);
    }
  }, [theme]);
  

  const handleQuizComplete = (wordId: string, meaningIndex: number, isCorrect: boolean) => {
      setVocabList(currentList => {
          return currentList.map(item => {
              if (item.id === wordId) {
                  const newMeanings = [...item.meanings];
                  const meaning = { ...newMeanings[meaningIndex] }; // Create a copy
                  
                  if (isCorrect) {
                      // Increase SRS level, maxing out at the highest defined interval
                      meaning.srs_level = Math.min(meaning.srs_level + 1, srsIntervalsHours.length);
                      const intervalHours = srsIntervalsHours[meaning.srs_level - 1];
                      meaning.next_review_date = Date.now() + intervalHours * 60 * 60 * 1000;
                  } else {
                      // Decrease SRS level, but not below 0
                      meaning.srs_level = Math.max(0, meaning.srs_level - 1);
                      // Schedule for review soon
                      meaning.next_review_date = Date.now() + 5 * 60 * 1000; // 5 minutes from now
                  }
                  newMeanings[meaningIndex] = meaning;
                  return { ...item, meanings: newMeanings };
              }
              return item;
          });
      });
  };

  const handleClearList = () => {
    if (window.confirm("Are you sure you want to clear your entire learned words list? This will also reset your review progress.")) {
      setVocabList([]);
    }
  };
  
  const startReviewSession = () => {
    const now = Date.now();
    const allDueMeanings: ReviewItem[] = [];
    vocabList.forEach(item => {
      item.meanings.forEach((meaning, index) => {
        if (meaning.next_review_date <= now) {
          allDueMeanings.push({
            word: item.word,
            meaning: meaning,
            meaningIndex: index,
            wordId: item.id
          });
        }
      });
    });

    // Prioritize words with lower SRS level (more difficult words)
    allDueMeanings.sort((a, b) => a.meaning.srs_level - b.meaning.srs_level);

    // Take up to 10 items for the review session
    const itemsForReview = allDueMeanings.slice(0, 10);
    // Shuffle the final list for variety
    itemsForReview.sort(() => Math.random() - 0.5);

    setReviewItems(itemsForReview);
    setIsReviewing(true);
  };
  
  const wordsForReviewCount = useMemo(() => {
    const now = Date.now();
    return vocabList.reduce((count, item) => 
      count + item.meanings.filter(m => m.next_review_date <= now).length, 0);
  }, [vocabList]);

  const fetchVocabData = async (wordToLearn: string) => {
      const schema = {
        type: Type.OBJECT,
        properties: {
          meanings: {
            type: Type.ARRAY,
            description: "A list of the most common meanings for the word. Only include meanings appropriate for an A2-level English learner.",
            items: {
              type: Type.OBJECT,
              properties: {
                part_of_speech_english: { type: Type.STRING, description: "Part of speech in English (e.g., Noun, Verb, Adjective)." },
                part_of_speech_arabic: { type: Type.STRING, description: "Part of speech translated into Arabic." },
                one_word_arabic: { type: Type.STRING, description: "A single Arabic word that is a direct translation or close synonym of the English word." },
                explanation_arabic: { type: Type.STRING, description: "A simple, one-sentence explanation of the word's meaning in Arabic, explaining the one-word definition in more detail." },
                example_sentence_english: { type: Type.STRING, description: "A simple example sentence in English, suitable for an A2 learner." },
                example_sentence_arabic: { type: Type.STRING, description: "The Arabic translation of the example sentence." },
                gap_fill_prompt: { type: Type.STRING, description: "A unique sentence for a gap-fill quiz. Use '___' for the blank where the word should go." },
                gap_fill_full_sentence: { type: Type.STRING, description: "The complete, correct version of the gap-fill sentence." },
                gap_fill_full_sentence_arabic: { type: Type.STRING, description: "The Arabic translation of the full gap-fill sentence." },
                multiple_choice_prompt: { type: Type.STRING, description: "A second, DIFFERENT sentence for a multiple-choice quiz. Use '___' for the blank." },
                multiple_choice_full_sentence: { type: Type.STRING, description: "The complete, correct version of the multiple-choice sentence." },
                multiple_choice_full_sentence_arabic: { type: Type.STRING, description: "The Arabic translation of the full multiple-choice sentence." },
                multiple_choice: {
                  type: Type.OBJECT,
                  description: "A multiple-choice question to test understanding.",
                  properties: {
                    options: {
                      type: Type.ARRAY,
                      description: "An array of 4 strings: three incorrect options and the correct answer.",
                      items: { type: Type.STRING }
                    },
                    correct_answer: {
                      type: Type.STRING,
                      description: "The correct answer from the options list."
                    }
                  },
                  required: ["options", "correct_answer"]
                }
              },
              required: [
                "part_of_speech_english", "part_of_speech_arabic", "one_word_arabic", "explanation_arabic", 
                "example_sentence_english", "example_sentence_arabic", "gap_fill_prompt", "gap_fill_full_sentence", 
                "gap_fill_full_sentence_arabic", "multiple_choice_prompt", "multiple_choice_full_sentence", 
                "multiple_choice_full_sentence_arabic", "multiple_choice"
              ]
            }
          }
        },
        required: ["meanings"]
      };

      try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const vocabPromise = ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `For the English word "${wordToLearn}", provide its most common meanings for an A2-level English language learner. For each meaning, provide a single Arabic word synonym, a more detailed Arabic explanation, and unique sentences for the example, the gap-fill quiz, and the multiple-choice quiz. If the word has multiple distinct meanings (e.g., as a noun and a verb), provide each one.`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        });
        
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("The request took too long to respond. Please try again.")), 30000)
        );
        
        const vocabResponse = await Promise.race([vocabPromise, timeoutPromise]);
        const responseText = vocabResponse.text;
        
        let parsedData;
        try {
            parsedData = JSON.parse(responseText);
        } catch (parseError) {
            throw new Error("The AI returned an unexpected response. Please try a different word.");
        }

        const vocabData = validateApiResponse(parsedData);

        if (!vocabData.meanings || vocabData.meanings.length === 0) {
          throw new Error(`Sorry, I couldn't find a definition for "${wordToLearn}". Please check the spelling or try another word.`);
        }

        const newVocab: VocabData = {
          id: Date.now().toString(),
          word: wordToLearn,
          meanings: vocabData.meanings.map((m: Omit<Meaning, 'srs_level' | 'next_review_date'>) => ({
              ...m,
              srs_level: 0,
              next_review_date: Date.now(),
          })),
        };

        setVocabList(prev => [newVocab, ...prev]);
        setWord('');
        inputRef.current?.focus();
      } catch (e: any) {
        console.error("API Error:", e);
        // Re-map common API key errors to a user-friendly message.
        if (e && e.message && (e.message.includes("API Key must be set") || e.message.includes("API key not valid")  || e.message.includes("Requested entity was not found"))) {
            setError("API Error: The API key is missing or invalid. Please ensure it is configured correctly.");
        } else {
            let friendlyMessage = "Oops! Something went wrong. Please try again later.";
            if (e && e.message) {
                friendlyMessage = `API Error: ${e.message}`;
            }
            setError(friendlyMessage);
        }
        throw e; // Re-throw so the calling function can handle loading state.
      }
  };


  const handleLearnWord = async () => {
    const wordToLearn = word.trim();
    if (!wordToLearn) return;

    setIsLoading(true);
    setError(null);

    try {
      await fetchVocabData(wordToLearn);
    } catch (e) {
      // The fetchVocabData function is responsible for setting the error message on the UI.
      // We catch the error here to prevent it from crashing the app and to ensure the loading state is turned off.
      console.error("An error occurred during the learn word process.", e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {showReviewPrompt && (
            <ReviewPromptModal
                key="review-prompt-modal"
                onClose={() => setShowReviewPrompt(false)}
                onStartReview={() => {
                    setShowReviewPrompt(false);
                    startReviewSession();
                }}
                onPrint={() => {
                    setIsModalOpen(true);
                }}
                wordsForReviewCount={wordsForReviewCount}
            />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isModalOpen && <WordListModal key="word-list-modal" vocabList={vocabList} onClose={() => setIsModalOpen(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {isReviewing && <ReviewSession key="review-session-modal" items={reviewItems} onClose={() => setIsReviewing(false)} onQuizComplete={handleQuizComplete} />}
      </AnimatePresence>
      
      <div className="app-container">
        <header className="app-header">
          <h1>Vocab Learning Assistant</h1>
          <p>Enter an English word to learn its meaning in Arabic, usage, and example.</p>
          <ThemeSelector currentTheme={theme} onThemeChange={setTheme} />
        </header>
        
        <div className="input-area">
          <input
            ref={inputRef}
            type="text"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="e.g., happy, run, book"
            aria-label="Enter a word"
            disabled={isLoading}
          />
          <button onClick={handleLearnWord} disabled={isLoading || !word.trim()}>
            {isLoading ? <div className="spinner"></div> : 'Learn Word'}
          </button>
        </div>
        
        {error && <div className="error-message">{error}</div>}

        <div className="controls-area">
          <button className="finish-btn" onClick={() => setShowReviewPrompt(true)} disabled={isLoading || vocabList.length === 0}>
            Finish Session
          </button>
          <button className="secondary-btn" onClick={() => setIsModalOpen(true)} disabled={isLoading || vocabList.length === 0}>
            View Word List ({vocabList.length})
          </button>
          <button className="clear-btn" onClick={handleClearList} disabled={isLoading || vocabList.length === 0}>
            Clear List
          </button>
        </div>
        
        <main className="vocab-list">
          <AnimatePresence>
            {vocabList.map(item => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              >
                <VocabCard vocabData={item} onQuizComplete={handleQuizComplete}/>
              </motion.div>
            ))}
          </AnimatePresence>
        </main>

        <footer className="app-footer">
            Designed by: Nazila Motahari
        </footer>
      </div>
    </>
  );
};

const ThemeSelector: React.FC<{ currentTheme: Theme; onThemeChange: (theme: Theme) => void; }> = ({ currentTheme, onThemeChange }) => {
    return (
        <div className="theme-selector">
            {themes.map(theme => (
                <button
                    key={theme.id}
                    className={`theme-option ${currentTheme === theme.id ? 'active' : ''}`}
                    title={theme.name}
                    onClick={() => onThemeChange(theme.id)}
                    style={{ background: `linear-gradient(45deg, ${theme.colors.primary}, ${theme.colors.secondary})` }}
                >
                </button>
            ))}
        </div>
    );
};


const VocabCard: React.FC<{ vocabData: VocabData, onQuizComplete: (wordId: string, meaningIndex: number, isCorrect: boolean) => void }> = ({ vocabData, onQuizComplete }) => {
  return (
    <div className="vocab-card">
      <div className="vocab-header">
        <h2>{vocabData.word}</h2>
      </div>
      
      {vocabData.meanings.map((meaning, index) => (
        <MeaningCard 
            key={index} 
            meaning={meaning} 
            word={vocabData.word} 
            index={index + 1} 
            totalMeanings={vocabData.meanings.length}
            onQuizComplete={(isCorrect) => onQuizComplete(vocabData.id, index, isCorrect)}
        />
      ))}
    </div>
  );
};

const QuizFeedbackAnimation: React.FC<{
    isCorrect: boolean;
    correctMessage: string;
    incorrectMessage: string;
    onReRead?: () => void;
}> = ({ isCorrect, correctMessage, incorrectMessage, onReRead }) => {
    return (
        <div className={`feedback-animation-container ${isCorrect ? 'correct' : 'incorrect'}`}>
            {isCorrect && (
                <div className="stars-container">
                    {[...Array(5)].map((_, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 20, scale: 0.5 }}
                            animate={{ 
                                opacity: [0, 1, 0], 
                                y: [20, -10, -20], 
                                scale: [0.5, 1, 0.8],
                                rotate: Math.random() * 180 - 90
                            }}
                            transition={{ 
                                duration: 0.8, 
                                ease: "easeOut",
                                delay: i * 0.1
                            }}
                        >
                            <StarIcon />
                        </motion.div>
                    ))}
                </div>
            )}
            <p>{isCorrect ? correctMessage : incorrectMessage}</p>
            {!isCorrect && onReRead && (
                <button onClick={onReRead} className="reread-link">
                    Re-read Definition
                </button>
            )}
        </div>
    );
};


const MeaningCard: React.FC<{ 
    meaning: Meaning, 
    word: string, 
    index: number, 
    totalMeanings: number,
    onQuizComplete: (isCorrect: boolean) => void
}> = ({ meaning, word, index, totalMeanings, onQuizComplete }) => {
    const [quizType, setQuizType] = useState<'gap' | 'mc' | 'flash'>('gap');
    const [gapFillAnswer, setGapFillAnswer] = useState('');
    const [isGapFillCorrect, setIsGapFillCorrect] = useState<boolean | null>(null);
    const [mcAnswer, setMcAnswer] = useState<string | null>(null);
    const [isFlashcardFlipped, setIsFlashcardFlipped] = useState(false);
    const [flashcardResult, setFlashcardResult] = useState<'correct' | 'incorrect' | null>(null);

    const meaningRef = useRef<HTMLDivElement>(null);

    const handleReRead = () => {
        meaningRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const checkGapFill = () => {
        const isCorrect = gapFillAnswer.trim().toLowerCase() === word.toLowerCase();
        setIsGapFillCorrect(isCorrect);
        onQuizComplete(isCorrect);
    };
    
    const handleMcClick = (option: string) => {
        const isCorrect = option === meaning.multiple_choice.correct_answer;
        setMcAnswer(option);
        onQuizComplete(isCorrect);
    };

    const handleFlashcardAssessment = (result: 'correct' | 'incorrect') => {
        setFlashcardResult(result);
        onQuizComplete(result === 'correct');
    };

    const resetQuizStates = (type: 'gap' | 'mc' | 'flash') => {
        setQuizType(type);
        setGapFillAnswer('');
        setIsGapFillCorrect(null);
        setMcAnswer(null);
        setIsFlashcardFlipped(false);
        setFlashcardResult(null);
    };

    return (
        <div className="meaning-container" ref={meaningRef}>
            {totalMeanings > 1 && (
              <div className="meaning-header">
                <span className="meaning-number">{index}</span>
              </div>
            )}
            <div className="pos-tags">
                <span className="pos-tag-en">{meaning.part_of_speech_english}</span>
                <span className="pos-tag-ar">{meaning.part_of_speech_arabic}</span>
            </div>
            <p className="one-word-ar" dir="rtl">{meaning.one_word_arabic}</p>
            <p className="explanation-ar" dir="rtl">{meaning.explanation_arabic}</p>

            <div className="section-box sentence-box">
                <h3 className="section-header">
                  <SentenceIcon /> Example Sentence
                </h3>
                <p className="sentence-en">"{meaning.example_sentence_english}"</p>
                <p className="sentence-ar" dir="rtl">{meaning.example_sentence_arabic}</p>
            </div>

            <div className="section-box quiz-box">
                 <h3 className="section-header">
                  <QuizIcon /> Spot Check Quiz
                </h3>
                <div className="quiz-type-selector">
                    <button onClick={() => resetQuizStates('gap')} className={quizType === 'gap' ? 'active' : ''}>Gap-Fill</button>
                    <button onClick={() => resetQuizStates('mc')} className={quizType === 'mc' ? 'active' : ''}>Multiple Choice</button>
                    <button onClick={() => resetQuizStates('flash')} className={quizType === 'flash' ? 'active' : ''}>Flashcard</button>
                </div>
                
                {quizType === 'gap' && (
                    <div className="quiz-content">
                        <p>{meaning.gap_fill_prompt.replace('___', ' ______ ')}</p>
                        <div className="gap-fill-controls">
                            <input 
                                type="text"
                                value={gapFillAnswer}
                                onChange={(e) => setGapFillAnswer(e.target.value)}
                                placeholder="Your answer"
                                aria-label="Gap-fill answer"
                                disabled={isGapFillCorrect !== null}
                            />
                            <button onClick={checkGapFill} disabled={isGapFillCorrect !== null}>Check</button>
                        </div>
                        {isGapFillCorrect !== null && (
                            <>
                                <QuizFeedbackAnimation 
                                    isCorrect={isGapFillCorrect}
                                    correctMessage="Correct! Well done!"
                                    incorrectMessage={`Not quite. The answer is "${word}".`}
                                    onReRead={handleReRead}
                                />
                                <div className={`quiz-feedback ${isGapFillCorrect ? 'correct' : 'incorrect'}`}>
                                    <p className="sentence-en"><b>Full sentence:</b> "{meaning.gap_fill_full_sentence}"</p>
                                    <p className="sentence-ar" dir="rtl">{meaning.gap_fill_full_sentence_arabic}</p>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {quizType === 'mc' && (
                    <div className="quiz-content">
                        <p>Which word best completes the sentence?</p>
                        <p>"{meaning.multiple_choice_prompt.replace('___', ' ______ ')}"</p>
                        <div className="mc-options">
                            {meaning.multiple_choice.options.map((option, i) => (
                                <button
                                    key={i}
                                    onClick={() => handleMcClick(option)}
                                    className={`
                                        mc-option
                                        ${mcAnswer && option === meaning.multiple_choice.correct_answer ? 'correct' : ''}
                                        ${mcAnswer && option !== meaning.multiple_choice.correct_answer && option === mcAnswer ? 'incorrect' : ''}
                                    `}
                                    disabled={mcAnswer !== null}
                                >
                                    {option}
                                </button>
                            ))}
                        </div>
                        {mcAnswer !== null && (
                            <>
                                <QuizFeedbackAnimation 
                                    isCorrect={mcAnswer === meaning.multiple_choice.correct_answer}
                                    correctMessage="Correct! Great job!"
                                    incorrectMessage={`That's not it. The answer is "${meaning.multiple_choice.correct_answer}".`}
                                    onReRead={handleReRead}
                                />
                                <div className={`quiz-feedback ${mcAnswer === meaning.multiple_choice.correct_answer ? 'correct' : 'incorrect'}`}>
                                    <p className="sentence-en"><b>Full sentence:</b> "{meaning.multiple_choice_full_sentence}"</p>
                                    <p className="sentence-ar" dir="rtl">{meaning.multiple_choice_full_sentence_arabic}</p>
                                </div>
                            </>
                        )}
                    </div>
                )}
                
                {quizType === 'flash' && (
                    <div className="quiz-content">
                        <p>Click the card to reveal the meaning, then test yourself.</p>
                        <div className="flashcard-container" onClick={() => setIsFlashcardFlipped(!isFlashcardFlipped)}>
                            <div className={`flashcard ${isFlashcardFlipped ? 'is-flipped' : ''}`}>
                                <div className="flashcard-face flashcard-front">
                                    {word}
                                </div>
                                <div className="flashcard-face flashcard-back">
                                    <p className="one-word-ar" dir="rtl">{meaning.one_word_arabic}</p>
                                    <p className="explanation-ar" dir="rtl">{meaning.explanation_arabic}</p>
                                    <span className="pos-tag-ar">{meaning.part_of_speech_arabic}</span>
                                </div>
                            </div>
                        </div>
                        <AnimatePresence>
                            {isFlashcardFlipped && flashcardResult === null && (
                                <motion.div 
                                    className="flashcard-assessment"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 10 }}
                                >
                                    <button className="assess-correct" onClick={() => handleFlashcardAssessment('correct')}>I knew it!</button>
                                    <button className="assess-incorrect" onClick={() => handleFlashcardAssessment('incorrect')}>Need practice</button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                        {flashcardResult !== null && (
                             <QuizFeedbackAnimation 
                                isCorrect={flashcardResult === 'correct'}
                                correctMessage="Awesome! Keep it up!"
                                incorrectMessage="No worries! Practice makes perfect."
                                onReRead={handleReRead}
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const WordListModal: React.FC<{ vocabList: VocabData[], onClose: () => void }> = ({ vocabList, onClose }) => {
    const modalRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        modalRef.current?.focus();
    }, []);

    const handlePrint = () => {
        window.print();
    };
    
    const handleExport = () => {
        const sanitizeField = (field: string): string => {
            if (typeof field !== 'string') return '""';
            // Wrap in quotes, escape existing quotes, and remove newlines.
            const sanitized = field.replace(/"/g, '""').replace(/(\r\n|\n|\r)/gm, " ");
            return `"${sanitized}"`;
        };

        const headers = ['English Word', 'Part of Speech (EN)', 'Arabic Meaning', 'Arabic Explanation'];
        const csvRows = [headers.join(',')];

        vocabList.forEach(item => {
            if (!item || !item.meanings) return;
            item.meanings.forEach(meaning => {
                if (!meaning) return;
                const row = [
                    sanitizeField(item.word),
                    sanitizeField(meaning.part_of_speech_english),
                    sanitizeField(meaning.one_word_arabic),
                    sanitizeField(meaning.explanation_arabic)
                ];
                csvRows.push(row.join(','));
            });
        });

        const csvContent = csvRows.join('\n');
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'vocab_list.csv');
        document.body.appendChild(link);
        link.click();
        
        // Use a small timeout to ensure the download has time to start, especially in Firefox.
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 100);
    };

    return (
        <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <motion.div 
                ref={modalRef}
                tabIndex={-1}
                className="modal-content"
                initial={{ y: -50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -50, opacity: 0 }}
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h2>My Word List</h2>
                    <button className="close-btn" onClick={onClose} aria-label="Close word list">&times;</button>
                </div>
                <div className="modal-body">
                    <table className="word-table">
                        <thead>
                            <tr>
                                <th>English Word</th>
                                <th>Meaning in Arabic</th>
                            </tr>
                        </thead>
                        <tbody>
                            {vocabList.map(item => (
                               <React.Fragment key={item.id}>
                                {item.meanings.map((meaning, index) => (
                                    <tr key={`${item.id}-${index}`}>
                                        {index === 0 ? <td rowSpan={item.meanings.length}>{item.word}</td> : null}
                                        <td dir="rtl"><strong>{meaning.one_word_arabic}</strong> ({meaning.part_of_speech_arabic})<br/>{meaning.explanation_arabic}</td>
                                    </tr>
                                ))}
                               </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="modal-footer">
                    <button onClick={handleExport} className="export-btn">Export as CSV</button>
                    <button onClick={handlePrint}>Print List</button>
                    <button className="secondary-btn" onClick={onClose}>Close</button>
                </div>
            </motion.div>
        </motion.div>
    );
};


const ReviewPromptModal: React.FC<{
    onClose: () => void;
    onStartReview: () => void;
    onPrint: () => void;
    wordsForReviewCount: number;
}> = ({ onClose, onStartReview, onPrint, wordsForReviewCount }) => {
    const modalRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        modalRef.current?.focus();
    }, []);

    return (
        <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <motion.div 
                ref={modalRef}
                tabIndex={-1}
                className="modal-content"
                initial={{ y: -50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -50, opacity: 0 }}
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h2>Session Finished!</h2>
                    <button className="close-btn" onClick={onClose} aria-label="Close review prompt">&times;</button>
                </div>
                <div className="modal-body prompt-body">
                    <p className="prompt-message">Great work on your learning session!</p>
                    
                    {wordsForReviewCount > 0 ? (
                        <p className="prompt-submessage">You have <strong>{wordsForReviewCount}</strong> word{wordsForReviewCount > 1 ? 's' : ''} ready for review. This is a great time to practice!</p>
                    ) : (
                         <p className="prompt-submessage">You have no words due for review right now. Excellent job!</p>
                    )}
                    
                    <div className="prompt-actions">
                         {wordsForReviewCount > 0 && (
                            <button className="prompt-action-primary" onClick={onStartReview}>Start Review Session</button>
                         )}
                        <button className="prompt-action-secondary" onClick={onPrint}>Print Word List</button>
                    </div>

                    <p className="prompt-reminder">Spaced repetition helps you remember words long-term. Keep coming back to review!</p>
                </div>
                 <div className="modal-footer">
                    <button className="secondary-btn" onClick={onClose}>Done for Now</button>
                </div>
            </motion.div>
        </motion.div>
    );
};

// --- NEW REVIEW SESSION COMPONENT ---
const ReviewSession: React.FC<{ 
    items: ReviewItem[], 
    onClose: () => void,
    onQuizComplete: (wordId: string, meaningIndex: number, isCorrect: boolean) => void 
}> = ({ items, onClose, onQuizComplete }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [quizType, setQuizType] = useState<'gap' | 'mc' | 'flash'>('gap');
    const [isComplete, setIsComplete] = useState(false);
    
    // States for the quiz itself
    const [gapFillAnswer, setGapFillAnswer] = useState('');
    const [isGapFillCorrect, setIsGapFillCorrect] = useState<boolean | null>(null);
    const [mcAnswer, setMcAnswer] = useState<string | null>(null);
    const [isFlashcardFlipped, setIsFlashcardFlipped] = useState(false);
    const [flashcardResult, setFlashcardResult] = useState<'correct' | 'incorrect' | null>(null);

    const modalRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        modalRef.current?.focus();
    }, []);
    
    const currentItem = items[currentIndex];
    
    useEffect(() => {
        // When the item changes, select a random quiz type
        const types: ('gap' | 'mc' | 'flash')[] = ['gap', 'mc', 'flash'];
        setQuizType(types[Math.floor(Math.random() * types.length)]);
        // Reset all quiz states
        setGapFillAnswer('');
        setIsGapFillCorrect(null);
        setMcAnswer(null);
        setIsFlashcardFlipped(false);
        setFlashcardResult(null);
    }, [currentIndex, items]);

    const handleNext = () => {
        if (currentIndex < items.length - 1) {
            setCurrentIndex(currentIndex + 1);
        } else {
            setIsComplete(true);
        }
    };
    
    const isAnswered = isGapFillCorrect !== null || mcAnswer !== null || flashcardResult !== null;

    if (items.length === 0) {
        return ( 
             <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} role="dialog" aria-modal="true">
                <motion.div ref={modalRef} tabIndex={-1} className="modal-content review-session" initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }} onClick={e => e.stopPropagation()}>
                    <div className="modal-header"><h2>Review Session</h2><button className="close-btn" onClick={onClose} aria-label="Close review session">&times;</button></div>
                    <div className="review-summary">
                        <p>No words are due for review right now. Keep up the great work!</p>
                        <button onClick={onClose}>Close</button>
                    </div>
                </motion.div>
             </motion.div>
        );
    }

    return (
        <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true">
            <motion.div ref={modalRef} tabIndex={-1} className="modal-content review-session" initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }}>
                {!isComplete ? (
                    <>
                        <div className="modal-header">
                            <h2>Review Session</h2>
                            <button className="close-btn" onClick={onClose} aria-label="Close review session">&times;</button>
                        </div>
                        <div className="review-progress">
                            <div className="progress-bar" style={{ width: `${((currentIndex + 1) / items.length) * 100}%` }}></div>
                        </div>
                        <p className="progress-text">Word {currentIndex + 1} of {items.length}</p>

                        <div className="review-quiz-area">
                            {isAnswered ? (
                                <h3>The word was: <strong>{currentItem.word}</strong></h3>
                            ) : (
                                <h3>Recall the word...</h3>
                            )}
                            {/* Re-using the quiz components' logic inside the review modal */}
                            <div className="quiz-content">
                                {quizType === 'gap' && (
                                    <>
                                      <p>{currentItem.meaning.gap_fill_prompt.replace('___', ' ______ ')}</p>
                                      <div className="gap-fill-controls">
                                          <input type="text" value={gapFillAnswer} onChange={(e) => setGapFillAnswer(e.target.value)} placeholder="Your answer" disabled={isAnswered} />
                                          <button onClick={() => {
                                              const isCorrect = gapFillAnswer.trim().toLowerCase() === currentItem.word.toLowerCase();
                                              setIsGapFillCorrect(isCorrect);
                                              onQuizComplete(currentItem.wordId, currentItem.meaningIndex, isCorrect);
                                          }} disabled={isAnswered}>Check</button>
                                      </div>
                                      {isGapFillCorrect !== null && <QuizFeedbackAnimation isCorrect={isGapFillCorrect} correctMessage="Correct!" incorrectMessage={`Answer: "${currentItem.word}"`} />}
                                    </>
                                )}
                                {quizType === 'mc' && (
                                    <>
                                        <p>"{currentItem.meaning.multiple_choice_prompt.replace('___', ' ______ ')}"</p>
                                        <div className="mc-options">
                                            {currentItem.meaning.multiple_choice.options.map((option, i) => (
                                                <button key={i} onClick={() => {
                                                    const isCorrect = option === currentItem.meaning.multiple_choice.correct_answer;
                                                    setMcAnswer(option);
                                                    onQuizComplete(currentItem.wordId, currentItem.meaningIndex, isCorrect);
                                                }} disabled={isAnswered} className={`mc-option ${isAnswered && option === currentItem.meaning.multiple_choice.correct_answer ? 'correct' : ''} ${isAnswered && option !== currentItem.meaning.multiple_choice.correct_answer && option === mcAnswer ? 'incorrect' : ''}`}>
                                                    {option}
                                                </button>
                                            ))}
                                        </div>
                                        {mcAnswer !== null && <QuizFeedbackAnimation isCorrect={mcAnswer === currentItem.meaning.multiple_choice.correct_answer} correctMessage="Correct!" incorrectMessage={`Answer: "${currentItem.meaning.multiple_choice.correct_answer}"`}/>}
                                    </>
                                )}
                                {quizType === 'flash' && (
                                    <>
                                     <div className="flashcard-container" onClick={() => setIsFlashcardFlipped(!isFlashcardFlipped)}>
                                        <div className={`flashcard ${isFlashcardFlipped ? 'is-flipped' : ''}`}>
                                            <div className="flashcard-face flashcard-front" dir="rtl">{currentItem.meaning.one_word_arabic}</div>
                                            <div className="flashcard-face flashcard-back">{currentItem.word}</div>
                                        </div>
                                     </div>
                                      <AnimatePresence>
                                        {isFlashcardFlipped && flashcardResult === null && (
                                            <motion.div className="flashcard-assessment" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                                <button className="assess-correct" onClick={() => { setFlashcardResult('correct'); onQuizComplete(currentItem.wordId, currentItem.meaningIndex, true); }}>I knew it!</button>
                                                <button className="assess-incorrect" onClick={() => { setFlashcardResult('incorrect'); onQuizComplete(currentItem.wordId, currentItem.meaningIndex, false); }}>Need practice</button>
                                            </motion.div>
                                        )}
                                      </AnimatePresence>
                                     {flashcardResult !== null && <QuizFeedbackAnimation isCorrect={flashcardResult === 'correct'} correctMessage="Great!" incorrectMessage="Keep practicing!"/>}
                                    </>
                                )}
                            </div>
                        </div>
                        
                        {isAnswered && (
                            <div className="modal-footer">
                                <button onClick={handleNext}>
                                    {currentIndex < items.length - 1 ? 'Next Word' : 'Finish Review'}
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="review-summary">
                        <h2>Review Complete!</h2>
                        <p>Great job reviewing {items.length} word{items.length > 1 ? 's' : ''}. Keep up the great work!</p>
                        <button onClick={onClose}>Close</button>
                    </div>
                )}
            </motion.div>
        </motion.div>
    );
};


const container = document.getElementById('root');
if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error('Root container not found. Please ensure you have an element with id "root" in your HTML.');
}
