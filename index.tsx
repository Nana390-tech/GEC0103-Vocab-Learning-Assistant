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
// - Smart duplicate handling to prevent re-adding existing words.

import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from '@google/genai';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

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

const ThemeSelector: React.FC<{ currentTheme: Theme; onThemeChange: (theme: Theme) => void; }> = ({ currentTheme, onThemeChange }) => (
    <div className="theme-selector" title="Change Theme">
        {themes.map(themeOption => (
            <div
                key={themeOption.id}
                className={`theme-option ${currentTheme === themeOption.id ? 'active' : ''}`}
                style={{ background: themeOption.colors.primary, border: `2px solid ${themeOption.colors.secondary}` }}
                onClick={() => onThemeChange(themeOption.id)}
            />
        ))}
    </div>
);

const FeedbackAnimation: React.FC<{ isCorrect: boolean; onReread: () => void; }> = ({ isCorrect, onReread }) => {
    return (
        <motion.div
            className={`feedback-animation-container ${isCorrect ? 'correct' : 'incorrect'}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
        >
            {isCorrect ? (
                <>
                    <div className="stars-container">
                        {[...Array(3)].map((_, i) => (
                            <StarIcon key={i} style={{
                                animation: `pop-in 0.5s ${i * 0.1}s both ease-out`
                            }} />
                        ))}
                    </div>
                    <p>Excellent! You've mastered this. ✨</p>
                </>
            ) : (
                <>
                    <p>Not quite. Give it another try!</p>
                    <button onClick={onReread} className="reread-link">
                        Review the definition again?
                    </button>
                </>
            )}
        </motion.div>
    );
};

const GapFillQuiz: React.FC<{ meaning: Meaning; onComplete: (correct: boolean) => void; }> = ({ meaning, onComplete }) => {
    const [answer, setAnswer] = useState('');
    const [feedback, setFeedback] = useState<{ isCorrect: boolean } | null>(null);
    const wordToGuess = meaning.gap_fill_full_sentence.replace(meaning.gap_fill_prompt, '').replace(/\.$/, '').trim();

    const handleSubmit = () => {
        if (!answer.trim()) return;
        const isCorrect = answer.trim().toLowerCase() === wordToGuess.toLowerCase();
        setFeedback({ isCorrect });
        onComplete(isCorrect);
    };

    return (
        <div className="quiz-content">
            <p><strong>Fill in the blank:</strong> "{meaning.gap_fill_prompt}"</p>
            <div className="gap-fill-controls">
                <input
                    type="text"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    placeholder="Type the word"
                    disabled={!!feedback}
                />
                <button onClick={handleSubmit} disabled={!!feedback}>Check</button>
            </div>
            {feedback && (
                <div className={`quiz-feedback ${feedback.isCorrect ? 'correct' : 'incorrect'}`}>
                    <strong>{feedback.isCorrect ? 'Correct!' : 'Not quite.'}</strong>
                    <p>The full sentence is: "{meaning.gap_fill_full_sentence}"</p>
                    <p style={{ fontFamily: "'Noto Sans Arabic', sans-serif", textAlign: 'right' }}>{meaning.gap_fill_full_sentence_arabic}</p>
                </div>
            )}
        </div>
    );
};

const MultipleChoiceQuiz: React.FC<{ meaning: Meaning; onComplete: (correct: boolean) => void; }> = ({ meaning, onComplete }) => {
    const [answer, setAnswer] = useState<{ selected: string, isCorrect: boolean } | null>(null);
    const options = useMemo(() => [...meaning.multiple_choice.options].sort(() => Math.random() - 0.5), [meaning.multiple_choice.options]);

    const handleAnswer = (option: string) => {
        const isCorrect = option === meaning.multiple_choice.correct_answer;
        setAnswer({ selected: option, isCorrect });
        onComplete(isCorrect);
    };

    return (
        <div className="quiz-content">
            <p><strong>Choose the correct word:</strong> "{meaning.multiple_choice_prompt}"</p>
            <div className="mc-options">
                {options.map(option => (
                    <button
                        key={option}
                        className={`mc-option ${answer && (option === meaning.multiple_choice.correct_answer ? 'correct' : (option === answer.selected ? 'incorrect' : ''))}`}
                        onClick={() => handleAnswer(option)}
                        disabled={!!answer}
                    >
                        {option}
                    </button>
                ))}
            </div>
            {answer && (
                <div className={`quiz-feedback ${answer.isCorrect ? 'correct' : 'incorrect'}`}>
                    <strong>{answer.isCorrect ? 'Correct!' : 'Incorrect.'}</strong> The correct answer is "{meaning.multiple_choice.correct_answer}".
                    <p>Full sentence: "{meaning.multiple_choice_full_sentence}"</p>
                    <p style={{ fontFamily: "'Noto Sans Arabic', sans-serif", textAlign: 'right' }}>{meaning.multiple_choice_full_sentence_arabic}</p>
                </div>
            )}
        </div>
    );
};

const FlashcardQuiz: React.FC<{ meaning: Meaning; onComplete: (correct: boolean) => void; }> = ({ meaning, onComplete }) => {
    const [isFlipped, setIsFlipped] = useState(false);
    const [isAssessed, setIsAssessed] = useState(false);

    const handleAssess = (isCorrect: boolean) => {
        setIsAssessed(true);
        onComplete(isCorrect);
    };

    return (
        <div className="quiz-content">
            <p>Read the definition below. Can you remember the English word? Click to flip.</p>
            <div className="flashcard-container" onClick={() => !isAssessed && setIsFlipped(!isFlipped)}>
                <div className={`flashcard ${isFlipped ? 'is-flipped' : ''}`}>
                    <div className="flashcard-face flashcard-front">
                        <p className="one-word-ar">{meaning.one_word_arabic}</p>
                        <p className="explanation-ar">{meaning.explanation_arabic}</p>
                    </div>
                    <div className="flashcard-face flashcard-back">
                        {meaning.multiple_choice.correct_answer}
                    </div>
                </div>
            </div>
            {isFlipped && !isAssessed && (
                <motion.div
                    className="flashcard-assessment"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <p>Did you remember it correctly?</p>
                    <button className="assess-correct" onClick={() => handleAssess(true)}>Yes</button>
                    <button className="assess-incorrect" onClick={() => handleAssess(false)}>No</button>
                </motion.div>
            )}
        </div>
    );
};

const QuizContainer: React.FC<{ meaning: Meaning; onComplete: (correct: boolean) => void; }> = React.memo(({ meaning, onComplete }) => {
    const [quizType, setQuizType] = useState<'gap-fill' | 'multiple-choice' | 'flashcard'>('gap-fill');
    const [isComplete, setIsComplete] = useState(false);
    const [wasCorrect, setWasCorrect] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Reset state when the word/meaning changes
    useEffect(() => {
        setIsComplete(false);
        setWasCorrect(false);
        setQuizType('gap-fill');
    }, [meaning]);

    const handleQuizComplete = (correct: boolean) => {
        setIsComplete(true);
        setWasCorrect(correct);
        onComplete(correct); // Pass result to parent
    };

    const scrollToTop = () => {
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
        <div className="section-box quiz-box" ref={containerRef}>
            <div className="section-header">
                <QuizIcon />
                <h3>Practice This Meaning</h3>
            </div>
            {isComplete ? (
                <FeedbackAnimation isCorrect={wasCorrect} onReread={scrollToTop} />
            ) : (
                <>
                    <div className="quiz-type-selector">
                        <button className={quizType === 'gap-fill' ? 'active' : ''} onClick={() => setQuizType('gap-fill')}>Gap-Fill</button>
                        <button className={quizType === 'multiple-choice' ? 'active' : ''} onClick={() => setQuizType('multiple-choice')}>Multiple Choice</button>
                        <button className={quizType === 'flashcard' ? 'active' : ''} onClick={() => setQuizType('flashcard')}>Flashcard</button>
                    </div>
                    {quizType === 'gap-fill' && <GapFillQuiz meaning={meaning} onComplete={handleQuizComplete} />}
                    {quizType === 'multiple-choice' && <MultipleChoiceQuiz meaning={meaning} onComplete={handleQuizComplete} />}
                    {quizType === 'flashcard' && <FlashcardQuiz meaning={meaning} onComplete={handleQuizComplete} />}
                </>
            )}
        </div>
    );
});

const MeaningCard: React.FC<{ meaning: Meaning; index: number; handleQuizComplete: (isCorrect: boolean) => void; }> = React.memo(({ meaning, index, handleQuizComplete }) => (
    <motion.div
        className="meaning-container"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: index * 0.1 }}
    >
        <div className="meaning-header">
            <div className="meaning-number">{index + 1}</div>
        </div>
        <div className="pos-tags">
            <span className="pos-tag-en">{meaning.part_of_speech_english}</span>
            <span className="pos-tag-ar">{meaning.part_of_speech_arabic}</span>
        </div>
        <p className="one-word-ar">{meaning.one_word_arabic}</p>
        <p className="explanation-ar">{meaning.explanation_arabic}</p>

        <div className="section-box sentence-box">
            <div className="section-header">
                <SentenceIcon />
                <h4>Example Sentence</h4>
            </div>
            <p className="sentence-en">{meaning.example_sentence_english}</p>
            <p className="sentence-ar">{meaning.example_sentence_arabic}</p>
        </div>

        <QuizContainer meaning={meaning} onComplete={handleQuizComplete} />
    </motion.div>
));

const VocabCard: React.FC<{ vocab: VocabData; handleQuizComplete: (meaningIndex: number, isCorrect: boolean) => void; }> = React.memo(({ vocab, handleQuizComplete }) => (
    <motion.div
        className="vocab-card"
        data-word-id={vocab.id}
        layout
        initial={{ opacity: 0, y: 50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
    >
        <div className="vocab-header">
            <h2>{vocab.word}</h2>
        </div>
        {vocab.meanings.map((meaning, index) => (
            <MeaningCard
                key={`${vocab.id}-${index}`}
                meaning={meaning}
                index={index}
                handleQuizComplete={(isCorrect) => handleQuizComplete(index, isCorrect)}
            />
        ))}
    </motion.div>
));

const WordListModal: React.FC<{ vocabList: VocabData[]; onClose: () => void; }> = ({ vocabList, onClose }) => {
    const handlePrint = () => window.print();

    const handleExport = () => {
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "Word,Part of Speech,Arabic Translation,Arabic Explanation,Example (English),Example (Arabic)\r\n";

        vocabList.forEach(item => {
            item.meanings.forEach(m => {
                const row = [
                    `"${item.word}"`,
                    `"${m.part_of_speech_english}"`,
                    `"${m.one_word_arabic}"`,
                    `"${m.explanation_arabic.replace(/"/g, '""')}"`,
                    `"${m.example_sentence_english.replace(/"/g, '""')}"`,
                    `"${m.example_sentence_arabic.replace(/"/g, '""')}"`
                ].join(",");
                csvContent += row + "\r\n";
            });
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "vocab_list.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <motion.div className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <motion.div className="modal-content"
                initial={{ y: -50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -50, opacity: 0 }}
                transition={{ duration: 0.3 }}
            >
                <div className="modal-header">
                    <h2>My Word List ({vocabList.length})</h2>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                <div className="modal-body">
                    {vocabList.length > 0 ? (
                        <table className="word-table">
                            <thead>
                                <tr>
                                    <th>English Word</th>
                                    <th>Meanings (Arabic)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {vocabList.map(item => (
                                    <tr key={item.id}>
                                        <td><strong>{item.word}</strong></td>
                                        <td>
                                            {item.meanings.map((m, i) => (
                                                <div key={i} style={{ marginBottom: '0.5rem' }}>
                                                    <strong>{m.one_word_arabic}</strong> ({m.part_of_speech_arabic}): {m.explanation_arabic}
                                                </div>
                                            ))}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <p>Your word list is empty. Start learning new words!</p>
                    )}
                </div>
                <div className="modal-footer">
                    <button className="secondary-btn" onClick={handlePrint}>Print</button>
                    <button className="export-btn" onClick={handleExport}>Export as CSV</button>
                    <button onClick={onClose}>Close</button>
                </div>
            </motion.div>
        </motion.div>
    );
};

const ReviewPromptModal: React.FC<{ onClose: () => void; onStartReview: () => void; onPrint: () => void; wordsForReviewCount: number; }> = ({ onClose, onStartReview, onPrint, wordsForReviewCount }) => {
    return (
        <motion.div className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <motion.div className="modal-content"
                initial={{ y: -50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -50, opacity: 0 }}
                transition={{ duration: 0.3 }}
            >
                <div className="modal-header">
                    <h2>Review Time!</h2>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                <div className="modal-body prompt-body">
                    <p className="prompt-message">You have {wordsForReviewCount} word(s) ready for review.</p>
                    <p className="prompt-submessage">Strengthen your memory with a quick practice session.</p>
                    <div className="prompt-actions">
                        <button className="prompt-action-primary" onClick={onStartReview}>Start Review Session</button>
                        <button className="prompt-action-secondary" onClick={onPrint}>View Full Word List</button>
                    </div>
                    <p className="prompt-reminder">Regular reviews help you learn words for the long term.</p>
                </div>
            </motion.div>
        </motion.div>
    );
};

const ReviewSession: React.FC<{ items: ReviewItem[]; onClose: () => void; onQuizComplete: (wordId: string, meaningIndex: number, isCorrect: boolean) => void; }> = ({ items, onClose, onQuizComplete }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [correctCount, setCorrectCount] = useState(0);
    const [isSessionComplete, setIsSessionComplete] = useState(false);
    const currentItem = items[currentIndex];

    const handleNext = (isCorrect: boolean) => {
        onQuizComplete(currentItem.wordId, currentItem.meaningIndex, isCorrect);
        if (isCorrect) {
            setCorrectCount(prev => prev + 1);
        }

        setTimeout(() => {
            if (currentIndex < items.length - 1) {
                setCurrentIndex(prev => prev + 1);
            } else {
                setIsSessionComplete(true);
            }
        }, 1500); // Wait for feedback animation/message
    };

    if (!currentItem && !isSessionComplete) {
        return null; // Should not happen, but a good safeguard
    }

    return (
        <motion.div className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <motion.div className="modal-content review-session"
                initial={{ y: -50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -50, opacity: 0 }}
                transition={{ duration: 0.3 }}
            >
                {!isSessionComplete ? (
                    <>
                        <div className="modal-header">
                            <h2>Review Session</h2>
                            <button onClick={onClose} className="close-btn">&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="review-progress">
                                <div className="progress-bar" style={{ width: `${((currentIndex + 1) / items.length) * 100}%` }}></div>
                            </div>
                            <p className="progress-text">Word {currentIndex + 1} of {items.length}</p>
                            <div className="review-quiz-area">
                                <h3>Practice the following concept:</h3>
                                <QuizContainer meaning={currentItem.meaning} onComplete={handleNext} />
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="review-summary">
                        <h2>Session Complete!</h2>
                        <p>You reviewed {items.length} words and got {correctCount} correct.</p>
                        <p>Keep up the great work!</p>
                        <button onClick={onClose}>Finish</button>
                    </div>
                )}
            </motion.div>
        </motion.div>
    );
};

const ProgressDashboard: React.FC<{
    totalWords: number;
    wordsForReview: number;
    masteredWords: number;
    inProgressWords: number;
    currentTheme: Theme;
}> = ({ totalWords, wordsForReview, masteredWords, inProgressWords, currentTheme }) => {

    const data = [
        { name: 'Mastered', value: masteredWords },
        { name: 'In Progress', value: inProgressWords },
    ];
    
    const themeColors = themes.find(t => t.id === currentTheme)?.colors;
    // A fallback is good practice in case the theme isn't found.
    const COLORS = [themeColors?.secondary || '#90BE6D', themeColors?.primary || '#2D7DD2'];

    if (totalWords === 0) return null;

    return (
        <motion.div 
            className="progress-dashboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
        >
            <h3>My Learning Progress</h3>
            <div className="stats-container">
                <div className="stat-item">
                    <div className="stat-value">{totalWords}</div>
                    <div className="stat-label">Total Words Learned</div>
                </div>
                 <div className="stat-item">
                    <div className="stat-value">{wordsForReview}</div>
                    <div className="stat-label">Words for Review</div>
                </div>
            </div>
            <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={40}
                            outerRadius={70}
                            fill="#8884d8"
                            paddingAngle={5}
                            dataKey="value"
                            labelLine={false}
                            label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
                                if (percent === 0) return '';
                                const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                                const x = cx + radius * Math.cos(-midAngle * Math.PI / 180);
                                const y = cy + radius * Math.sin(-midAngle * Math.PI / 180);
                                return (
                                    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize="14px" fontWeight="bold">
                                        {`${(percent * 100).toFixed(0)}%`}
                                    </text>
                                );
                            }}
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip />
                        <Legend iconType="circle" />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </motion.div>
    );
};

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
  
  const handleApiError = (e: any) => {
    console.error("API Error:", e);
    const message = e?.message || '';

    if (message.includes("API key") || message.includes("API Key") || message.includes("was not found")) {
        setError("The learning service is currently unavailable. Please try again later.");
    } else {
        const friendlyMessage = `Oops! An error occurred: ${message || 'Please try again later.'}`;
        setError(friendlyMessage);
    }
  };

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

  const { masteredWords, inProgressWords } = useMemo(() => {
    if (vocabList.length === 0) {
        return { masteredWords: 0, inProgressWords: 0 };
    }
    
    // A word is "mastered" if all its meanings have an SRS level of 6 or higher.
    const MASTERY_THRESHOLD = 6;
    
    let mastered = 0;
    
    vocabList.forEach(word => {
        const isMastered = word.meanings.every(meaning => meaning.srs_level >= MASTERY_THRESHOLD);
        if (isMastered) {
            mastered++;
        }
    });

    return {
        masteredWords: mastered,
        inProgressWords: vocabList.length - mastered,
    };
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
        
        const systemInstruction = `You are an expert linguist and teacher who helps Arabic speakers learn English. For a given English word, provide a JSON object with its most common meanings, tailored for an A2-level learner. The output must strictly adhere to the provided JSON schema. Do not output anything other than the JSON object.`;

        const vocabPromise = ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `Generate vocabulary data for the English word: "${wordToLearn}"`,
          config: {
            systemInstruction,
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
        handleApiError(e);
        throw e; // Re-throw so the calling function can handle loading state.
      }
  };


  const handleLearnWord = async () => {
    const wordToLearn = word.trim().toLowerCase();
    if (!wordToLearn) return;

    // --- Smart Duplicate Handling ---
    const existingEntry = vocabList.find(item => item.word.toLowerCase() === wordToLearn);
    if (existingEntry) {
        const element = document.querySelector(`[data-word-id="${existingEntry.id}"]`) as HTMLElement;
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.classList.add('highlight-card');
            setTimeout(() => {
                element.classList.remove('highlight-card');
            }, 1500);
        }
        setWord('');
        return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await fetchVocabData(word.trim());
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
        
        {error && <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="error-message"
        >{error}</motion.div>}

        <>
            <div className="input-area">
            <input
                ref={inputRef}
                type="text"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLearnWord()}
                placeholder="e.g., happy, run, book"
                aria-label="Enter an English word"
                disabled={isLoading}
            />
            <button onClick={handleLearnWord} disabled={isLoading || !word.trim()}>
                {isLoading ? <div className="spinner"></div> : 'Learn Word'}
            </button>
            </div>

            <div className="controls-area">
                <button className="clear-btn" onClick={handleClearList} disabled={vocabList.length === 0}>Clear List</button>
                <button className="secondary-btn" onClick={() => setIsModalOpen(true)} disabled={vocabList.length === 0}>My Words</button>
                <button
                    className="finish-btn"
                    onClick={() => {
                        if (wordsForReviewCount > 0) {
                            setShowReviewPrompt(true);
                        } else {
                            alert("You have no words due for review right now. Keep learning!");
                        }
                    }}
                    disabled={vocabList.length === 0}
                >
                    Review ({wordsForReviewCount})
                </button>
            </div>

            {vocabList.length > 0 && (
                <ProgressDashboard
                    totalWords={vocabList.length}
                    wordsForReview={wordsForReviewCount}
                    masteredWords={masteredWords}
                    inProgressWords={inProgressWords}
                    currentTheme={theme}
                />
            )}

            <div className="vocab-list">
                <AnimatePresence>
                    {vocabList.map((vocab) => (
                    <VocabCard
                        key={vocab.id}
                        vocab={vocab}
                        handleQuizComplete={(meaningIndex, isCorrect) => handleQuizComplete(vocab.id, meaningIndex, isCorrect)}
                    />
                    ))}
                </AnimatePresence>
            </div>
        </>

        <footer className="app-footer">
          <p>Designed by Nazila Motahari | Powered by Gemini. Happy Learning!</p>
        </footer>
      </div>
    </>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><App /></React.StrictMode>);