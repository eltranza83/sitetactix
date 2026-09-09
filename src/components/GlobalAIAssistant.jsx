import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Mic,
  Send,
  X,
  Square,
  MoreVertical,
  Loader2
} from 'lucide-react';
import {
  askGeminiBrain,
  loadProjectDriveTree,
  saveProjectDriveTree,
  loadProjectDashboard
} from '../services/builderBrainService';
import {
  fetchProjectFinishes,
  saveFinishSpec
} from '../services/finishService';
import { runAllAiToolDiagnostics } from '../services/aiTools';
import {
  fetchProjectDriveTree,
  createFolder,
  trashDriveFileOrFolder,
  fetchDriveFileBase64
} from '../services/googleDrive';

import DocumentViewerModal from './DocumentViewerModal';
import DocumentCard from './DocumentCard';
import {
  VoiceStateMachine,
  VOICE_STATES,
  VOICE_MODES,
  isExitIntent,
  stripWakeWord
} from '../services/voiceStateMachine';
import {
  resolveVoice,
  isFemaleVoice
} from '../services/voiceResolver';



const findReferencedDriveFile = (query, driveTree, messages = []) => {
  if (!driveTree || !query) return null;
  const q = query.toLowerCase().trim();
  const allFiles = [];
  if (driveTree.directFiles) {
    driveTree.directFiles.forEach((f) => allFiles.push({ ...f, folderName: 'root' }));
  }
  if (driveTree.subfolders) {
    driveTree.subfolders.forEach((sub) => {
      if (sub.files) {
        sub.files.forEach((f) => allFiles.push({ ...f, folderName: sub.folderName }));
      }
    });
  }

  // 0. Check numbered index requests (e.g. "number 2", "file 1", "show #3", "bring up 2")
  const numMatch = q.match(/(?:number|file|item|#)\s*(\d+)/i) || q.match(/^(?:bring up|show|open|view|pull up|fetch)\s+(\d+)$/i);
  if (numMatch && Array.isArray(messages)) {
    const targetIndex = parseInt(numMatch[1], 10);
    // Find the most recent AI message with a numbered list
    const lastListMsg = [...messages].reverse().find((m) => m.sender === 'ai' && /\d+\.\s+/m.test(m.text));
    if (lastListMsg && targetIndex > 0) {
      const listLines = lastListMsg.text.split('\n').filter((l) => /^\s*\d+\.\s+/.test(l));
      if (listLines[targetIndex - 1]) {
        const itemLine = listLines[targetIndex - 1].replace(/^\s*\d+\.\s+[`'"]?/, '').replace(/[`'"]?$/, '').trim();
        const matched = allFiles.find((f) => itemLine.toLowerCase().includes(f.name.toLowerCase()) || f.name.toLowerCase().includes(itemLine.toLowerCase()));
        if (matched) return matched;
      }
    }
  }

  // 1. Check direct file name matching
  for (const f of allFiles) {
    const fNameLow = f.name.toLowerCase();
    const fClean = fNameLow.replace(/\.[a-z0-9]+$/i, '').replace(/[_\-\s]+/g, ' ');
    if (q.includes(fNameLow) || (fClean.length > 5 && q.includes(fClean))) {
      return f;
    }
  }

  // 2. Check subfolder name matching (e.g. "closing settlement", "processed invoices", "x-ray photos")
  if (driveTree.subfolders) {
    for (const sub of driveTree.subfolders) {
      const subLow = sub.folderName.toLowerCase();
      if (q.includes(subLow) || (subLow.includes('closing') && q.includes('closing'))) {
        if (sub.files && sub.files.length > 0) {
          const pdf = sub.files.find((f) => f.name.toLowerCase().endsWith('.pdf') || f.mimeType === 'application/pdf');
          return pdf ? { ...pdf, folderName: sub.folderName } : { ...sub.files[0], folderName: sub.folderName };
        }
      }
    }
  }

  // 3. Keyword matching (e.g. "closing cost", "settlement statement", "allocation")
  if (q.includes('closing') || q.includes('settlement') || q.includes('allocation')) {
    const closingPdf = allFiles.find((f) => f.name.toLowerCase().includes('closing') || f.name.toLowerCase().includes('allocation') || f.folderName.toLowerCase().includes('closing'));
    if (closingPdf) return closingPdf;
  }

  // 4. Contextual Pronoun Resolution ("open it", "pull it up", "show it", "go ahead and open it", "yes open it")
  const isPronounOrConfirm =
    /\b(open it|show it|pull it up|view it|see it|open that|show that|bring it up|open the file|show the file|open document|show document)\b/i.test(q) ||
    /^(yes|yeah|sure|yep|ok|okay|please|go ahead|proceed)\b/i.test(q);

  if (isPronounOrConfirm && Array.isArray(messages) && messages.length > 0) {
    const reversed = [...messages].reverse();
    for (const msg of reversed) {
      const txt = (msg.text || '').toLowerCase();
      if (!txt) continue;

      // Find all files in driveTree mentioned in this previous message
      const mentioned = allFiles.filter((f) => {
        const fn = f.name.toLowerCase();
        const base = fn.replace(/\.[a-z0-9]+$/i, '');
        return txt.includes(fn) || (base.length > 5 && txt.includes(base));
      });

      if (mentioned.length === 1) {
        // Unambiguously single matching file in previous context
        return mentioned[0];
      }
      if (mentioned.length > 1) {
        // Multiple matches in context
        return { isAmbiguous: true, matches: mentioned };
      }

      // If previous AI message attached viewFiles
      if (msg.viewFiles && msg.viewFiles.length === 1) {
        const vf = allFiles.find((f) => f.id === msg.viewFiles[0].fileId);
        if (vf) return vf;
      }
    }
  }

  return null;
};

export function formatMessageDisplay(text) {
  if (!text || typeof text !== 'string') return '';
  let clean = text;

  // 1. Strip redundant duplicate parenthesized dates (e.g. "July 22, 2026 (2026-07-22)" -> "July 22, 2026")
  clean = clean.replace(/\s*\(\d{4}-\d{2}-\d{2}\)/g, '');

  // 2. Convert raw ISO dates (YYYY-MM-DD) to friendly dates (e.g. August 1, 2026)
  clean = clean.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_match, y, m, d) => {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const mIdx = parseInt(m, 10) - 1;
    const dayNum = parseInt(d, 10);
    if (months[mIdx]) {
      return `${months[mIdx]} ${dayNum}, ${y}`;
    }
    return `${y}-${m}-${d}`;
  });

  // 3. Convert markdown bullet lists to clean bullet points
  clean = clean.replace(/^\s*[*•-]\s+/gm, '• ');

  // 4. Strip all markdown bold/italic asterisks completely (e.g. **Text** -> Text, *Text* -> Text)
  clean = clean.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  clean = clean.replace(/\*/g, '');

  return clean;
}




export default function GlobalAIAssistant({ activeProject, selectedFolder, googleToken, onNavigateTab }) {
  const projectId = activeProject?.id || selectedFolder?.name || 'default_site';
  const projectName = activeProject?.name || selectedFolder?.name || 'Active Job Site';

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState(() => {
    const hr = new Date().getHours();
    const timeGreeting = hr < 12 ? 'Good morning Sir' : hr < 17 ? 'Good afternoon Sir' : 'Good evening Sir';
    return [
      {
        sender: 'ai',
        text: `${timeGreeting}. Online and at your service. I have indexed all project financials, Google Drive files, and field protocols for "${projectName}". How may I assist you today?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
  });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [selectedVoiceConfig, setSelectedVoiceConfig] = useState(() => {
    try {
      const raw = localStorage.getItem('jobscan_ai_voice_config');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => {
    const raw = localStorage.getItem('jobscan_ai_voice_config');
    if (raw) {
      try { return JSON.parse(raw).uri || ''; } catch {}
    }
    return localStorage.getItem('jobscan_ai_voice_uri') || '';
  });
  const [aiLanguage, setAiLanguage] = useState(() => localStorage.getItem('jobscan_ai_lang') || 'auto');
  const [devMode, setDevMode] = useState(() => {
    try {
      return localStorage.getItem('jobscan_dev_mode') === 'true';
    } catch {
      return false;
    }
  });
  const [showTestSuite, setShowTestSuite] = useState(false);
  const [testSuiteData, setTestSuiteData] = useState(null);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [activityLogs, setActivityLogs] = useState(() => {
    try {
      const saved = localStorage.getItem('jobscan_ai_activity_logs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [apiKey] = useState(() => localStorage.getItem('jobscan_gemini_api_key') || localStorage.getItem('jobscan_gemini_key') || '');
  const [driveTree, setDriveTree] = useState(() => loadProjectDriveTree(projectId));
  const [activePreviewFile, setActivePreviewFile] = useState(null);
  const [finishCount, setFinishCount] = useState(0);

  useEffect(() => {
    let active = true;
    if (projectId) {
      fetchProjectFinishes(projectId).then((specs) => {
        if (active) setFinishCount(Array.isArray(specs) ? specs.length : 0);
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener('open-ai-assistant', handleOpen);
    return () => window.removeEventListener('open-ai-assistant', handleOpen);
  }, []);

  // Voice State Machine & Continuous Hands-Free State
  const [voiceMode, setVoiceMode] = useState(() => {
    try {
      return localStorage.getItem('jobscan_voice_mode') || VOICE_MODES.CONTINUOUS_HANDS_FREE;
    } catch {
      return VOICE_MODES.CONTINUOUS_HANDS_FREE;
    }
  });

  const [silenceTimeoutSec, setSilenceTimeoutSec] = useState(() => {
    try {
      return parseInt(localStorage.getItem('jobscan_silence_timeout_sec') || '7', 10);
    } catch {
      return 7;
    }
  });
  const [wakeWordEnabled, setWakeWordEnabled] = useState(() => {
    try {
      return localStorage.getItem('jobscan_wake_word_enabled') === 'true';
    } catch {
      return false;
    }
  });
  const [voiceState, setVoiceState] = useState(VOICE_STATES.IDLE);
  const [silenceRemaining, setSilenceRemaining] = useState(7);
  const voiceSmRef = useRef(null);
  const recognitionRef = useRef(null);

  if (!voiceSmRef.current) {
    voiceSmRef.current = new VoiceStateMachine({
      mode: voiceMode,
      silenceTimeoutSec,
      wakeWordEnabled
    });
  }

  const chatEndRef = useRef(null);
  const lastSubmissionRef = useRef({ query: '', timestamp: 0 });


  const handleRunDiagnosticSuite = async () => {
    setIsRunningTests(true);
    try {
      const finishes = await fetchProjectFinishes(projectId);
      const projectContext = {
        items: [],
        dashboardData: loadProjectDashboard(projectId),
        driveTree,
        projectSpecs: finishes,
        siteSetupData: null,
        apiKey,
        googleToken
      };
      const data = await runAllAiToolDiagnostics(projectContext);
      setTestSuiteData(data);
    } catch (err) {
      console.error('Error running test suite:', err);
    } finally {
      setIsRunningTests(false);
    }
  };

  // Sync Google Drive folders & files manifest
  useEffect(() => {
    if (!googleToken || !activeProject?.folderId) return;
    let isSubscribed = true;

    async function syncDriveManifest() {
      try {
        const tree = await fetchProjectDriveTree(googleToken, activeProject.folderId);
        if (tree && isSubscribed) {
          setDriveTree(tree);
          saveProjectDriveTree(projectId, tree);
        }
      } catch (err) {
        console.warn('Drive manifest background fetch note:', err);
      }
    }

    syncDriveManifest();
    return () => {
      isSubscribed = false;
    };
  }, [googleToken, activeProject?.folderId, projectId]);



  // Load natural voices (English + Spanish) with J.A.R.V.I.S. British English priority
  useEffect(() => {
    const loadVoices = () => {
      if ('speechSynthesis' in window) {
        const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en') || v.lang.startsWith('es'));
        setAvailableVoices(voices);
        
        let activeConfig = selectedVoiceConfig;
        if (!activeConfig) {
          try {
            const raw = localStorage.getItem('jobscan_ai_voice_config');
            if (raw) activeConfig = JSON.parse(raw);
          } catch {}
        }

        const resolved = resolveVoice(voices, activeConfig, false);
        if (resolved) {
          setSelectedVoiceURI(resolved.voiceURI || resolved.name);
        }
      }
    };
    loadVoices();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const speakText = (text, userQuery = '', onFinished = null) => {
    if (!speechEnabled || !('speechSynthesis' in window) || !text) {
      if (typeof onFinished === 'function') {
        setTimeout(onFinished, 400);
      }
      return;
    }
    try {
      window.speechSynthesis.cancel();
      let clean = String(text);

      const q = String(userQuery).toLowerCase();
      const isReadAllRequested =
        q.includes('read all') ||
        q.includes('read them all') ||
        q.includes('read the rest') ||
        q.includes('driving') ||
        q.includes('read it to me') ||
        q.includes('read them to me');

      // Smart spoken list handler:
      // If text contains a list of items (e.g. "1. ...", "* ...", "- ...")
      const lines = clean.split('\n');
      const listLineIndices = [];
      lines.forEach((l, idx) => {
        if (/^\s*(?:\d+[.)]|[-•*])\s+/.test(l)) {
          listLineIndices.push(idx);
        }
      });

      if (!isReadAllRequested && listLineIndices.length > 4) {
        // Long list (>4 items): keep intro + first 3 items + spoken summary
        const cutoffIdx = listLineIndices[3];
        const remainingCount = listLineIndices.length - 3;
        const keptLines = lines.slice(0, cutoffIdx);
        keptLines.push(`plus ${remainingCount} more items on your screen. Would you like me to read the rest?`);
        clean = keptLines.join('. ');
      }

      // 1. Strip redundant duplicate parenthesized dates (e.g. "(2026-07-22)")
      clean = clean.replace(/\s*\(\d{4}-\d{2}-\d{2}\)/g, '');

      // 2. Natural Spoken Date Formatter: replace 2026-08-01 with "August 1st, 2026"
      clean = clean.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_match, y, m, d) => {
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const mIdx = parseInt(m, 10) - 1;
        const dayNum = parseInt(d, 10);
        if (months[mIdx]) {
          const suffix = (dayNum === 1 || dayNum === 21 || dayNum === 31) ? 'st' : (dayNum === 2 || dayNum === 22) ? 'nd' : (dayNum === 3 || dayNum === 23) ? 'rd' : 'th';
          return `${months[mIdx]} ${dayNum}${suffix}, ${y}`;
        }
        return `${y} ${m} ${d}`;
      });

      clean = clean
        .replace(/\(Folder ID:[^)]+\)/gi, '')
        .replace(/\(File ID:[^)]+\)/gi, '')
        .replace(/\b(?:Folder|File)\s+ID:\s*[`'"]?[a-zA-Z0-9_-]+[`'"]?/gi, '')
        .replace(/\b[a-zA-Z0-9_-]{24,}\b/g, '')
        .replace(/[*_#🚨⏰👷📍•`]/gu, '')
        .replace(/[[\]()]/g, ' ')
        .replace(/\n+/g, '. ')
        .replace(/\.pdf\b/gi, '')
        .replace(/\.txt\b/gi, '')
        .replace(/\.docx?\b/gi, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();




      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 1.06; // Crisp, natural cadence
      utterance.pitch = 0.94; // Authentic resonant J.A.R.V.I.S. tone

      // Retrieve live voices directly from browser engine (crucial for mobile Android & iOS)
      const liveVoices = (window.speechSynthesis.getVoices && window.speechSynthesis.getVoices().length > 0)
        ? window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en') || v.lang.startsWith('es'))
        : availableVoices;

      let currentConfig = selectedVoiceConfig;
      if (!currentConfig) {
        try {
          const raw = localStorage.getItem('jobscan_ai_voice_config');
          if (raw) currentConfig = JSON.parse(raw);
        } catch {}
      }

      const isSpanish = /[áéíóúüñ¿¡]/i.test(text) || /\b(el|la|los|las|un|una|del|por|para|con|este|esta|lote|plomero|electricista|dinero|gastado|cuanto|quien|recordatorio|buenos|dias|tardes|hola|subcontratista|factura|presupuesto)\b/i.test(text);

      if (isSpanish || aiLanguage === 'es') {
        const spanishVoice = resolveVoice(liveVoices, currentConfig, true);
        if (spanishVoice) {
          utterance.voice = spanishVoice;
          utterance.lang = spanishVoice.lang || 'es-US';
        } else {
          utterance.lang = 'es-US';
        }
      } else {
        const britishVoice = resolveVoice(liveVoices, currentConfig, false);
        if (britishVoice) {
          utterance.voice = britishVoice;
          utterance.lang = britishVoice.lang || 'en-GB';
        } else {
          utterance.lang = 'en-GB';
        }
      }

      let finishedTriggered = false;
      const triggerFinished = () => {
        if (finishedTriggered) return;
        finishedTriggered = true;
        if (typeof onFinished === 'function') {
          onFinished();
        }
      };

      const activeSession = voiceSmRef.current?.currentSessionId;
      utterance.onstart = () => {
        voiceSmRef.current?.startSpeaking(clean, 'tts_started');
      };
      utterance.onend = () => {
        voiceSmRef.current?.finishSpeaking('tts_ended', activeSession);
        triggerFinished();
      };
      utterance.onerror = (err) => {
        voiceSmRef.current?.handleError('tts-error', err?.error || 'speech synthesis error', activeSession);
        triggerFinished();
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
      voiceSmRef.current?.finishSpeaking('tts_catch_error');
      if (typeof onFinished === 'function') {
        onFinished();
      }
    }
  };



  const executeMessage = async (queryText) => {
    if (!queryText || !queryText.trim() || isLoading) return;
    const query = queryText.trim();

    const now = Date.now();
    if (lastSubmissionRef.current.query === query && (now - lastSubmissionRef.current.timestamp) < 2000) {
      console.log('🔇 [Duplicate Submission Guarded]', query);
      return;
    }
    lastSubmissionRef.current = { query, timestamp: now };

    setInput('');

    const userMsg = {
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages((prev) => [...prev, userMsg]);

    // Handle Graceful Exit Intent & Auto-Close
    if (isExitIntent(query)) {
      voiceSmRef.current?.standDown('exit_intent_detected');
      let replyText = 'Understood. Standing down.';
      const qLow = query.toLowerCase();
      if (qLow.includes('night')) {
        replyText = 'Good night Sir. Standing down.';
      } else if (qLow.includes('later') || qLow.includes('catch you') || qLow.includes('see you')) {
        replyText = 'Talk to you later Sir. Standing down.';
      } else if (qLow.includes('goodbye') || qLow.includes('bye')) {
        replyText = 'Goodbye Sir. Standing down.';
      } else if (qLow.includes('that') && (qLow.includes('it') || qLow.includes('all'))) {
        replyText = "Understood. That's all for now. Standing down.";
      }
      const exitMsg = {
        sender: 'ai',
        text: replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, exitMsg]);
      setIsLoading(false);

      let closeFired = false;
      const safeClose = () => {
        if (closeFired) return;
        closeFired = true;
        setIsOpen(false);
      };
      speakText(replyText, query, safeClose);
      setTimeout(safeClose, 2500);
      return;
    }

    setIsLoading(true);

    try {
      let currentLiveTree = driveTree || (typeof loadDriveTree === 'function' ? loadDriveTree(projectId) : null);
      if (googleToken && activeProject?.folderId) {
        fetchProjectDriveTree(googleToken, activeProject.folderId).then((freshTree) => {
          if (freshTree) {
            setDriveTree(freshTree);
            saveProjectDriveTree(projectId, freshTree);
          }
        }).catch((treeErr) => {
          console.warn('Background drive tree refresh warning:', treeErr);
        });
      }

      let fileAttachment = null;
      let targetFile = null;
      const isManualNoReceiptIntent = /\b(no\s+(physical\s+)?(scan|receipt|paper|invoice)|stage\s+(a\s+)?(\$?\d+|payment|expense)|log\s+(a\s+)?(\$?\d+|expense))\b/i.test(query);
      if (!isManualNoReceiptIntent) {
        targetFile = findReferencedDriveFile(query, currentLiveTree, messages);
        if (targetFile && targetFile.id && googleToken) {
          try {
            const fetchWithTimeout = Promise.race([
              fetchDriveFileBase64(googleToken, targetFile.id),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Drive attachment timeout (3s limit)')), 3000))
            ]);
            fileAttachment = await fetchWithTimeout;
          } catch (fileErr) {
            console.warn('Drive file fetch attachment skipped/timed out:', fileErr?.message || fileErr);
          }
        }
      }

      const currentDashboard = loadProjectDashboard(projectId);
      const forceDeepReasoning = false;
      const answerPayload = await askGeminiBrain(query, [], projectName, apiKey, currentDashboard, projectId, messages, currentLiveTree, fileAttachment, forceDeepReasoning, googleToken, { onNavigateTab });
      const answer = typeof answerPayload === 'object' && answerPayload.text !== undefined ? answerPayload.text : String(answerPayload || '');
      const telemetry = typeof answerPayload === 'object' && answerPayload.telemetry ? answerPayload.telemetry : null;


      let cleanAnswer = answer;
      const actionCreateMatch = answer.match(/\[\[ACTION:CREATE_FOLDER:([^\]]+)\]\]/);
      if (actionCreateMatch && actionCreateMatch[1]) {
        let fName = actionCreateMatch[1].replace(/^(and\s+)?(just\s+)?(call\s+it\s+|called\s+|named\s+|llamada\s+)/i, '').replace(/^["']|["']$/g, '').trim();
        if (googleToken && activeProject?.folderId && fName) {
          try {
            await createFolder(googleToken, fName, activeProject.folderId);
            const updatedTree = await fetchProjectDriveTree(googleToken, activeProject.folderId);
            if (updatedTree) {
              setDriveTree(updatedTree);
              saveProjectDriveTree(projectId, updatedTree);
            }
          } catch (driveErr) {
            console.warn('Drive create folder action warning:', driveErr);
          }
        }
        cleanAnswer = cleanAnswer.replace(/\[\[ACTION:CREATE_FOLDER:[^\]]+\]\]/, '').trim();
      }

      const actionDeleteMatch = answer.match(/\[\[ACTION:DELETE_FOLDER:([^\]]+)\]\]/);
      if (actionDeleteMatch && actionDeleteMatch[1]) {
        let fName = actionDeleteMatch[1].replace(/^(and\s+)?(just\s+)?(called\s+|named\s+|llamada\s+)/i, '').replace(/^["']|["']$/g, '').trim().toLowerCase();
        if (googleToken && activeProject?.folderId && driveTree?.subfolders && fName) {
          const matchFolder = driveTree.subfolders.find(
            (f) => f.folderName.toLowerCase().includes(fName) || fName.includes(f.folderName.toLowerCase())
          );
          if (matchFolder && matchFolder.folderId) {
            try {
              await trashDriveFileOrFolder(googleToken, matchFolder.folderId);
              const updatedTree = await fetchProjectDriveTree(googleToken, activeProject.folderId);
              if (updatedTree) {
                setDriveTree(updatedTree);
                saveProjectDriveTree(projectId, updatedTree);
              }
            } catch (driveErr) {
              console.warn('Drive trash folder action warning:', driveErr);
            }
          }
        }
        cleanAnswer = cleanAnswer.replace(/\[\[ACTION:DELETE_FOLDER:[^\]]+\]\]/, '').trim();
      }



      // 4. Add Finish Selection / Paint Spec Action
      const actionAddSpecMatches = [...answer.matchAll(/\[\[ACTION:ADD_SPEC:([^\]]+)\]\]/g)];
      if (actionAddSpecMatches.length > 0) {
        actionAddSpecMatches.forEach(async (m) => {
          try {
            const data = JSON.parse(m[1]);
            await saveFinishSpec(projectId, {
              category: data.category || 'Paint',
              location: data.location || 'Whole House',
              scope: data.scope || (data.location && !data.location.toLowerCase().includes('whole house') ? 'room_override' : 'whole_house'),
              brand: data.brand || data.supplier || '',
              code: data.code || data.title || '',
              name: data.code || data.title || '',
              sheen: data.sheen || data.specs || '',
              attributes: data.attributes || {},
              notes: data.notes || '',
              source: 'voice_ai'
            });
          } catch (err) {
            console.warn('Failed to parse and save ADD_SPEC payload:', err);
          }
        });
        cleanAnswer = cleanAnswer.replace(/\[\[ACTION:ADD_SPEC:[^\]]+\]\]/g, '').trim();
      }

      // 5. Interactive Document & Receipt Viewer Action
      const actionViewFileMatches = [...answer.matchAll(/\[\[ACTION:VIEW_FILE:([^\]]+)\]\]/g)];
      const viewFiles = [];
      if (actionViewFileMatches.length > 0) {
        actionViewFileMatches.forEach((m) => {
          try {
            const data = JSON.parse(m[1]);
            if (data.fileId) {
              viewFiles.push({
                fileId: data.fileId,
                fileName: data.fileName || 'Document.pdf',
                folderName: data.folderName || 'Google Drive'
              });
            }
          } catch (err) {
            console.warn('Failed to parse VIEW_FILE payload:', err);
          }
        });
        cleanAnswer = cleanAnswer.replace(/\[\[ACTION:VIEW_FILE:[^\]]+\]\]/g, '').trim();
      }

      // Check if user explicitly requested opening/viewing a physical file/plan/blueprint in full screen
      const isListOrDataQuery = /\b(list|purchasing|checklist|items?|balance|budget|cost|owed|money|invoice|receipts?|specs?|inspection)\b/i.test(query);
      const isExplicitViewCommand = !isListOrDataQuery && (
        /^(can you\s+)?(open|view|display|pull up)\s+(the\s+)?(file|document|pdf|image|plan|blueprint|permit)\b/i.test(query.trim()) ||
        /\b(pull it up in full screen|open it in full screen|view this file in full screen|open document in full screen)\b/i.test(query.trim())
      );

      const isViewIntent =
        isExplicitViewCommand ||
        (!isListOrDataQuery && (
          /\b(open the file|show the file|open document|show document|open blueprint|show blueprint)\b/i.test(query.trim()) ||
          /^(yes|yeah|sure|yep|ok|okay|please|go ahead|proceed)\b/i.test(query.trim())
        ));

      if (targetFile && targetFile.id && !targetFile.isAmbiguous && viewFiles.length === 0 && isViewIntent) {
        viewFiles.push({
          fileId: targetFile.id,
          fileName: targetFile.name,
          folderName: targetFile.folderName || 'Google Drive'
        });
      }

      // Contextual fallback: If Gemini's text explicitly references opening/viewing an exact Google Drive file
      if (viewFiles.length === 0 && (isViewIntent || (/\b(opened|opening|here is the file|view on your screen)\b/i.test(cleanAnswer) && !isListOrDataQuery))) {
        const allDriveFiles = [];
        if (currentLiveTree?.directFiles) allDriveFiles.push(...currentLiveTree.directFiles);
        if (currentLiveTree?.subfolders) {
          currentLiveTree.subfolders.forEach((s) => {
            if (s.files) s.files.forEach((f) => allDriveFiles.push({ ...f, folderName: s.folderName }));
          });
        }
        const matchingFileInAnswer = allDriveFiles.find((f) =>
          cleanAnswer.includes(f.name) ||
          cleanAnswer.includes(`'${f.name}'`) ||
          cleanAnswer.includes(`"${f.name}"`) ||
          cleanAnswer.includes(`\`${f.name}\``)
        );
        if (matchingFileInAnswer && matchingFileInAnswer.id) {
          viewFiles.push({
            fileId: matchingFileInAnswer.id,
            fileName: matchingFileInAnswer.name,
            folderName: matchingFileInAnswer.folderName || 'Google Drive'
          });
        }
      }

      // Format inline lists with clean linebreaks
      cleanAnswer = cleanAnswer.replace(/:\s*1\.\s+/g, ':\n\n1. ');

      const actionDocTools = (telemetry?.tools || []).filter(t => t.name === 'open_drive_document' || t.name === 'open_drive_folder');
      const attachedDocs = [];
      for (const at of actionDocTools) {
        if (at.result?.fileName || at.result?.file) {
          attachedDocs.push({
            name: at.result.fileName || at.result.file?.name,
            id: at.result.documentId || at.result.file?.id,
            folderName: at.result.folderName,
            webViewLink: at.result.webViewLink || at.result.file?.webViewLink,
            mimeType: at.result.mimeType,
            error: at.result.success === false ? at.result.error : null
          });
        }
      }
      if (attachedDocs.length === 0 && viewFiles.length > 0) {
        for (const vf of viewFiles) {
          attachedDocs.push({
            name: vf.fileName,
            id: vf.fileId,
            folderName: vf.folderName,
            webViewLink: vf.fileId ? `https://drive.google.com/file/d/${vf.fileId}/view` : null
          });
        }
      }

      const aiMsg = {
        sender: 'ai',
        text: cleanAnswer,
        documents: attachedDocs.length > 0 ? attachedDocs : undefined,
        viewFiles: viewFiles.length > 0 ? viewFiles : undefined,
        telemetry,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, aiMsg]);
      speakText(cleanAnswer, query);


      // Determine data provenance source
      const source = telemetry?.source || (telemetry?.toolsExecuted?.length > 0 ? 'Local Tool Data' : (telemetry?.modelUsed?.includes('Local') ? 'Local Project Ledger' : 'Gemini Cloud AI'));

      // Append to AI Activity Log & Browser Console for conclusive proof
      const logEntry = {
        id: 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        query,
        modelUsed: telemetry?.modelUsed || 'gemini-flash-latest',
        source,
        httpStatus: telemetry?.errorCode ? `Notice (${telemetry.errorCode})` : '200 OK',
        intent: telemetry?.intent || 'Standard Lookup',
        durationMs: telemetry?.durationMs || 0,
        toolsExecuted: telemetry?.toolsExecuted || [],
        finalAnswer: cleanAnswer,
        fallbackTriggered: Boolean(telemetry?.fallbackTriggered),
        resultSummary: cleanAnswer.slice(0, 160) + (cleanAnswer.length > 160 ? '...' : '')
      };

      console.log('🤖 [J.A.R.V.I.S. Activity Log Entry]', {
        query,
        source: logEntry.source,
        modelCalled: logEntry.modelUsed,
        httpStatus: logEntry.httpStatus,
        toolsInvoked: logEntry.toolsExecuted.map(t => ({ tool: t.name, args: t.args, dataReturned: t.result })),
        finalSynthesizedAnswer: cleanAnswer,
        latencyMs: logEntry.durationMs
      });


      setActivityLogs((prev) => {
        const updated = [logEntry, ...prev.slice(0, 49)];
        try {
          localStorage.setItem('jobscan_ai_activity_logs', JSON.stringify(updated));
        } catch {}
        return updated;
      });
    } catch (err) {
      console.error('Global AI Assistant error:', err);
      const errMsg = {
        sender: 'ai',
        text: `⚠️ I had a temporary issue connecting: ${err.message || 'Please try again.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    executeMessage(input);
  };

  // 1. Voice State Machine Subscription
  useEffect(() => {
    const sm = voiceSmRef.current;
    if (!sm) return;

    const unsubscribe = sm.subscribe((snapshot) => {
      setVoiceState(snapshot.state);
      setSilenceRemaining(snapshot.silenceRemaining);
      setIsRecording(snapshot.state === VOICE_STATES.LISTENING || snapshot.state === VOICE_STATES.AUTO_LISTENING);
    });

    return () => {
      unsubscribe();
      sm.clearTimers();
    };
  }, []);


  // 2. Sync Configuration Changes
  useEffect(() => {
    const sm = voiceSmRef.current;
    if (!sm) return;
    sm.updateConfig({
      mode: voiceMode,
      silenceTimeoutSec,
      wakeWordEnabled
    });
    try {
      localStorage.setItem('jobscan_voice_mode', voiceMode);
      localStorage.setItem('jobscan_silence_timeout_sec', String(silenceTimeoutSec));
      localStorage.setItem('jobscan_wake_word_enabled', String(wakeWordEnabled));
    } catch {}
  }, [voiceMode, silenceTimeoutSec, wakeWordEnabled]);

  // 3. Speech Recognition Controller tied to Voice State Machine
  useEffect(() => {
    const shouldListen = voiceState === VOICE_STATES.LISTENING || voiceState === VOICE_STATES.AUTO_LISTENING;

    if (!shouldListen) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech recognition not supported on this browser.');
      voiceSmRef.current?.handleError('not-supported', 'SpeechRecognition API unavailable');
      return;
    }

    const recSessionId = voiceSmRef.current.currentSessionId;
    const isPttMode = voiceSmRef.current.mode === VOICE_MODES.PUSH_TO_TALK;
    const rec = new SpeechRecognition();
    rec.continuous = !isPttMode;
    rec.interimResults = true;
    rec.lang = aiLanguage === 'es' ? 'es-US' : aiLanguage === 'en' ? 'en-US' : (typeof navigator !== 'undefined' && navigator.language?.startsWith('es')) ? 'es-US' : 'en-US';

    let silenceDebounceTimer = null;
    let accumulatedFinalText = '';
    let latestTranscript = '';
    let isCommitted = false;

    const commitUtterance = (transcript) => {
      if (isCommitted) return;
      const trimmed = (transcript || '').trim();
      if (!trimmed) return;
      if (voiceSmRef.current.currentSessionId !== recSessionId) return;

      isCommitted = true;
      if (silenceDebounceTimer) {
        clearTimeout(silenceDebounceTimer);
        silenceDebounceTimer = null;
      }
      accumulatedFinalText = '';
      latestTranscript = '';

      // Acoustic Feedback Check
      if (voiceSmRef.current.isAcousticFeedback(trimmed)) {
        console.log('🔇 [Acoustic Feedback Suppressed]', trimmed);
        return;
      }

      // Exit Intent Check
      if (isExitIntent(trimmed)) {
        voiceSmRef.current.standDown('exit_intent_detected');
        let replyText = 'Understood. Standing down.';
        const qLow = trimmed.toLowerCase();
        if (qLow.includes('night')) {
          replyText = 'Good night Sir. Standing down.';
        } else if (qLow.includes('later') || qLow.includes('catch you') || qLow.includes('see you')) {
          replyText = 'Talk to you later Sir. Standing down.';
        } else if (qLow.includes('goodbye') || qLow.includes('bye')) {
          replyText = 'Goodbye Sir. Standing down.';
        } else if (qLow.includes('that') && (qLow.includes('it') || qLow.includes('all'))) {
          replyText = "Understood. That's all for now. Standing down.";
        }
        const exitMsg = {
          sender: 'ai',
          text: replyText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages((prev) => [...prev, exitMsg]);
        try { rec.stop(); } catch {}

        let closeFired = false;
        const safeClose = () => {
          if (closeFired) return;
          closeFired = true;
          setIsOpen(false);
        };
        speakText(replyText, trimmed, safeClose);
        setTimeout(safeClose, 2500);
        return;
      }

      try {
        rec.stop();
      } catch {}

      // Normal Query or Wake-Word Processing
      const finalQuery = stripWakeWord(trimmed);
      if (finalQuery) {
        setInput(finalQuery);
        executeMessage(finalQuery);
      }
    };

    rec.onresult = (e) => {
      if (isCommitted || voiceSmRef.current.currentSessionId !== recSessionId) return; // Stale or committed guard
      
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        const res = e.results[i];
        const piece = res[0]?.transcript || '';
        if (res.isFinal) {
          accumulatedFinalText = (accumulatedFinalText ? (accumulatedFinalText.trim() + ' ' + piece.trim()) : piece.trim()).trim();
        } else {
          interimText += piece;
        }
      }

      const combined = (accumulatedFinalText ? (accumulatedFinalText + (interimText ? ' ' + interimText.trim() : '')) : interimText.trim()).trim();
      if (!combined) return;

      latestTranscript = combined;
      setInput(combined);

      if (silenceDebounceTimer) {
        clearTimeout(silenceDebounceTimer);
      }

      // Conversational pause buffer (shorter for PTT, natural for continuous)
      const debounceDelayMs = isPttMode ? 1000 : 1300;
      silenceDebounceTimer = setTimeout(() => {
        commitUtterance(latestTranscript);
      }, debounceDelayMs);
    };

    rec.onerror = (e) => {
      if (voiceSmRef.current.currentSessionId !== recSessionId) return;
      console.warn('[Speech Recognition Error]', e.error);
      voiceSmRef.current.handleError(e.error, e.message, recSessionId);
    };

    rec.onend = () => {
      if (voiceSmRef.current.currentSessionId !== recSessionId) return;
      if (silenceDebounceTimer) {
        clearTimeout(silenceDebounceTimer);
        silenceDebounceTimer = null;
      }
      // In PTT mode, ending recognition returns to IDLE unless thinking/speaking
      if (voiceSmRef.current.mode === VOICE_MODES.PUSH_TO_TALK && voiceSmRef.current.state === VOICE_STATES.LISTENING) {
        if (!isCommitted && latestTranscript) {
          commitUtterance(latestTranscript);
        }
        voiceSmRef.current.transition(VOICE_STATES.IDLE, 'rec_ended_ptt');
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
    } catch (err) {
      console.warn('Error starting speech recognition:', err);
      voiceSmRef.current.handleError('start-failed', err.message, recSessionId);
    }

    return () => {
      if (silenceDebounceTimer) clearTimeout(silenceDebounceTimer);
      try {
        rec.abort();
      } catch {}
    };
  }, [voiceState, aiLanguage]);

  const handleVoiceInput = () => {
    const sm = voiceSmRef.current;
    if (!sm) return;

    if (sm.state === VOICE_STATES.SPEAKING) {
      // Barge-in interruption
      sm.bargeIn('user_tapped_mic_during_speech');
    } else if (sm.state === VOICE_STATES.LISTENING || sm.state === VOICE_STATES.AUTO_LISTENING) {
      // Toggle off / cancel listening
      sm.standDown('user_toggled_off_mic');
    } else {
      // Start listening
      sm.startListening('user_tapped_mic');
    }
  };


  return (
    <>

      {/* Interactive Global AI Assistant Chat Modal */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            width: '100vw',
            height: '100dvh',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(10px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: typeof window !== 'undefined' && window.innerWidth <= 640 ? '0' : '16px',
            boxSizing: 'border-box'
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '640px',
              height: typeof window !== 'undefined' && window.innerWidth <= 640 ? '100dvh' : 'min(88vh, 820px)',
              maxHeight: '100dvh',
              backgroundColor: 'var(--color-zinc-900)',
              border: typeof window !== 'undefined' && window.innerWidth <= 640 ? 'none' : '1px solid var(--color-zinc-800)',
              borderRadius: typeof window !== 'undefined' && window.innerWidth <= 640 ? '0' : '14px',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.8)'
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                paddingTop: 'max(12px, env(safe-area-inset-top, 12px))',
                paddingBottom: '12px',
                paddingLeft: '14px',
                paddingRight: '14px',
                borderBottom: '1px solid var(--color-zinc-800)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: 'var(--color-zinc-950)',
                flexShrink: 0,
                position: 'relative'
              }}
            >
              {/* Left: Identity + Status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: '1 1 auto' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--color-amber-500)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#000',
                    flexShrink: 0
                  }}
                >
                  <Bot size={20} />
                </div>
                <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-zinc-100)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    J.A.R.V.I.S. — {projectName}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.70rem', fontWeight: 700, color: 'var(--color-amber-500)', margin: 0 }}>
                      Field Co-Pilot
                    </span>
                    <span
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: (voiceState === VOICE_STATES.LISTENING || voiceState === VOICE_STATES.AUTO_LISTENING)
                          ? 'rgba(34, 197, 94, 0.2)'
                          : (voiceState === VOICE_STATES.SPEAKING)
                          ? 'rgba(239, 68, 68, 0.2)'
                          : (voiceState === VOICE_STATES.THINKING)
                          ? 'rgba(168, 85, 247, 0.2)'
                          : 'rgba(39, 39, 42, 0.6)',
                        color: (voiceState === VOICE_STATES.LISTENING || voiceState === VOICE_STATES.AUTO_LISTENING)
                          ? '#86efac'
                          : (voiceState === VOICE_STATES.SPEAKING)
                          ? '#fca5a5'
                          : (voiceState === VOICE_STATES.THINKING)
                          ? '#d8b4fe'
                          : 'var(--color-zinc-400)',
                        border: '1px solid ' + (
                          (voiceState === VOICE_STATES.LISTENING || voiceState === VOICE_STATES.AUTO_LISTENING)
                            ? 'rgba(34, 197, 94, 0.4)'
                            : (voiceState === VOICE_STATES.SPEAKING)
                            ? 'rgba(239, 68, 68, 0.4)'
                            : (voiceState === VOICE_STATES.THINKING)
                            ? 'rgba(168, 85, 247, 0.4)'
                            : 'var(--color-zinc-800)'
                        )
                      }}
                    >
                      {voiceState === VOICE_STATES.SPEAKING
                        ? '🔊 Speaking'
                        : voiceState === VOICE_STATES.AUTO_LISTENING
                        ? `🟢 Auto-Listening (${silenceRemaining}s)`
                        : voiceState === VOICE_STATES.LISTENING
                        ? `🟢 Listening... (${silenceRemaining}s)`
                        : voiceState === VOICE_STATES.THINKING
                        ? '🧠 Thinking...'
                        : '⚪ Online'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: Clean Controls (More Menu ⋮ and Dedicated Close ✕) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginLeft: '8px' }}>
                {/* 3-Dot Overflow Menu Button */}
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => setShowMenu(!showMenu)}
                    style={{
                      background: showMenu ? 'var(--color-zinc-800)' : 'rgba(39, 39, 42, 0.6)',
                      border: '1px solid ' + (showMenu ? 'var(--color-zinc-600)' : 'var(--color-zinc-800)'),
                      color: showMenu ? 'var(--color-amber-400)' : 'var(--color-zinc-300)',
                      borderRadius: '8px',
                      padding: '7px 9px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: '38px',
                      minHeight: '38px'
                    }}
                    title="Tools & Settings Menu"
                  >
                    <MoreVertical size={18} />
                  </button>

                  {/* Overflow Dropdown Popup */}
                  {showMenu && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '46px',
                        right: '0',
                        width: '215px',
                        backgroundColor: 'var(--color-zinc-950)',
                        border: '1px solid var(--color-zinc-700)',
                        borderRadius: '10px',
                        boxShadow: '0 12px 28px rgba(0,0,0,0.7)',
                        padding: '6px',
                        zIndex: 10000,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px'
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => { setShowActivityLog(true); setShowMenu(false); }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '9px 12px',
                          borderRadius: '6px',
                          backgroundColor: 'transparent',
                          border: 'none',
                          color: 'var(--color-zinc-200)',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textAlign: 'left'
                        }}
                      >
                        <span>📋 Activity Log</span>
                        {activityLogs.length > 0 && (
                          <span style={{ fontSize: '0.70rem', padding: '1px 6px', borderRadius: '10px', backgroundColor: 'rgba(245, 158, 11, 0.2)', color: 'var(--color-amber-400)' }}>
                            {activityLogs.length}
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => { setShowTestSuite(true); setShowMenu(false); }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '9px 12px',
                          borderRadius: '6px',
                          backgroundColor: 'transparent',
                          border: 'none',
                          color: 'var(--color-zinc-200)',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textAlign: 'left'
                        }}
                      >
                        <span>🧪 Diagnostics Suite</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const next = !devMode;
                          setDevMode(next);
                          localStorage.setItem('jobscan_dev_mode', String(next));
                          setShowMenu(false);
                        }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '9px 12px',
                          borderRadius: '6px',
                          backgroundColor: 'transparent',
                          border: 'none',
                          color: devMode ? '#c084fc' : 'var(--color-zinc-200)',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textAlign: 'left'
                        }}
                      >
                        <span>🔬 Developer Mode</span>
                        <span style={{ fontSize: '0.70rem', fontWeight: 800, color: devMode ? '#a855f7' : 'var(--color-zinc-500)' }}>
                          {devMode ? 'ON' : 'OFF'}
                        </span>
                      </button>

                      <div style={{ height: '1px', backgroundColor: 'var(--color-zinc-800)', margin: '4px 0' }} />

                      <button
                        type="button"
                        onClick={() => { setShowSettings(!showSettings); setShowMenu(false); }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '9px 12px',
                          borderRadius: '6px',
                          backgroundColor: 'transparent',
                          border: 'none',
                          color: 'var(--color-zinc-200)',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textAlign: 'left'
                        }}
                      >
                        <span>⚙️ Voice & Settings</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSpeechEnabled(!speechEnabled);
                          if (speechEnabled) window.speechSynthesis.cancel();
                          setShowMenu(false);
                        }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '9px 12px',
                          borderRadius: '6px',
                          backgroundColor: 'transparent',
                          border: 'none',
                          color: 'var(--color-zinc-200)',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textAlign: 'left'
                        }}
                      >
                        <span>{speechEnabled ? '🔊 Voice Output' : '🔇 Mute Voice'}</span>
                        <span style={{ fontSize: '0.70rem', fontWeight: 700, color: speechEnabled ? '#86efac' : 'var(--color-zinc-500)' }}>
                          {speechEnabled ? 'ACTIVE' : 'MUTED'}
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Dedicated Prominent Close Button */}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  style={{
                    background: 'rgba(39, 39, 42, 0.7)',
                    border: '1px solid var(--color-zinc-700)',
                    color: 'var(--color-zinc-200)',
                    borderRadius: '8px',
                    padding: '7px 9px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: '38px',
                    minHeight: '38px'
                  }}
                  title="Close J.A.R.V.I.S. Assistant (Return to App)"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Compact Two-Tier Health Status Bar */}
            {(() => {
              const currentDash = loadProjectDashboard(projectId);
              const phasesList = currentDash?.subcontractors || currentDash?.phases || [];
              const spentTotal = currentDash?.projectInfo?.totalSpent || currentDash?.projectInfo?.drawsPaid;
              const dataLabel = spentTotal ? `${spentTotal} Spent (${phasesList.length} Phases)` : (phasesList.length > 0 ? `${phasesList.length} Phases Indexed` : 'Project Ready');
              return (
                <div
                  onClick={() => setShowTestSuite(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 14px',
                    backgroundColor: 'rgba(18, 18, 22, 0.98)',
                    borderBottom: '1px solid var(--color-zinc-800)',
                    fontSize: '0.70rem',
                    cursor: 'pointer',
                    flexShrink: 0
                  }}
                  title="Click to view full Tool & Data Health breakdown"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#86efac', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
                      🛠️ Tool Health: 🟢 Connected
                    </span>
                    <span style={{ color: 'var(--color-zinc-600)' }}>•</span>
                    <span style={{ color: '#93c5fd', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
                      📊 Data Health: 🟢 {dataLabel}
                    </span>
                  </div>
                  <span style={{ color: 'var(--color-amber-400)', fontWeight: 700, fontSize: '0.68rem' }}>
                    Diagnostics ↗
                  </span>
                </div>
              );
            })()}

            {/* Settings Drawer */}
            {showSettings && (
              <div style={{ padding: '14px', backgroundColor: 'var(--color-zinc-950)', borderBottom: '1px solid var(--color-zinc-800)', display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0 }}>
                {/* Language Mode Selector */}
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-zinc-400)', display: 'block', marginBottom: '6px' }}>
                    🌍 Voice & Recognition Language / Idioma:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => { setAiLanguage('auto'); localStorage.setItem('jobscan_ai_lang', 'auto'); }}
                      style={{
                        padding: '8px 4px',
                        borderRadius: '6px',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        backgroundColor: aiLanguage === 'auto' ? 'var(--color-amber-500)' : 'var(--color-zinc-900)',
                        color: aiLanguage === 'auto' ? '#000' : 'var(--color-zinc-300)',
                        border: aiLanguage === 'auto' ? '1px solid var(--color-amber-500)' : '1px solid var(--color-zinc-800)',
                        cursor: 'pointer',
                        textAlign: 'center'
                      }}
                    >
                      🌐 Auto
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAiLanguage('en'); localStorage.setItem('jobscan_ai_lang', 'en'); }}
                      style={{
                        padding: '8px 4px',
                        borderRadius: '6px',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        backgroundColor: aiLanguage === 'en' ? 'var(--color-amber-500)' : 'var(--color-zinc-900)',
                        color: aiLanguage === 'en' ? '#000' : 'var(--color-zinc-300)',
                        border: aiLanguage === 'en' ? '1px solid var(--color-amber-500)' : '1px solid var(--color-zinc-800)',
                        cursor: 'pointer',
                        textAlign: 'center'
                      }}
                    >
                      🇺🇸 English
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAiLanguage('es'); localStorage.setItem('jobscan_ai_lang', 'es'); }}
                      style={{
                        padding: '8px 4px',
                        borderRadius: '6px',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        backgroundColor: aiLanguage === 'es' ? 'var(--color-amber-500)' : 'var(--color-zinc-900)',
                        color: aiLanguage === 'es' ? '#000' : 'var(--color-zinc-300)',
                        border: aiLanguage === 'es' ? '1px solid var(--color-amber-500)' : '1px solid var(--color-zinc-800)',
                        cursor: 'pointer',
                        textAlign: 'center'
                      }}
                    >
                      🇲🇽 Español
                    </button>
                  </div>
                </div>

                {/* Voice Selector */}
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-zinc-400)', display: 'block', marginBottom: '4px' }}>
                    🎙️ J.A.R.V.I.S. Speech Synthesis Voice:
                  </label>
                  <select
                    value={selectedVoiceURI}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedVoiceURI(val);
                      const chosen = availableVoices.find((v) => v.voiceURI === val || v.name === val);
                      if (chosen) {
                        const cfg = { uri: chosen.voiceURI || '', name: chosen.name || '', lang: chosen.lang || 'en-GB' };
                        setSelectedVoiceConfig(cfg);
                        localStorage.setItem('jobscan_ai_voice_config', JSON.stringify(cfg));
                        localStorage.setItem('jobscan_ai_voice_uri', chosen.voiceURI || chosen.name || '');
                        try {
                          window.speechSynthesis.cancel();
                          const testUtt = new SpeechSynthesisUtterance('Voice updated. J.A.R.V.I.S. online.');
                          testUtt.voice = chosen;
                          testUtt.lang = chosen.lang || 'en-GB';
                          testUtt.rate = 1.2;
                          window.speechSynthesis.speak(testUtt);
                        } catch {}
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'var(--color-zinc-900)',
                      border: '1px solid var(--color-zinc-800)',
                      color: 'var(--color-zinc-100)',
                      fontSize: '0.82rem',
                      outline: 'none'
                    }}
                  >
                    {availableVoices.map((v) => {
                      const isFem = isFemaleVoice(v);
                      const isUk = (v.lang || '').toLowerCase().replace('_', '-').startsWith('en-gb');
                      const isRecommended = !isFem && (isUk || v.name.includes('George') || v.name.includes('Daniel') || v.name.includes('rjs'));
                      return (
                        <option key={v.voiceURI || v.name} value={v.voiceURI || v.name}>
                          {v.name} ({v.lang}) — {isFem ? '🌸 Female' : '🎙️ Male'}{isRecommended ? ' ✨ J.A.R.V.I.S.' : ''}
                        </option>
                      );
                    })}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      const chosen = availableVoices.find((v) => v.voiceURI === selectedVoiceURI || v.name === selectedVoiceURI) || resolveVoice(availableVoices, selectedVoiceConfig, false);
                      if (chosen) {
                        const cfg = { uri: chosen.voiceURI || '', name: chosen.name || '', lang: chosen.lang || 'en-GB' };
                        setSelectedVoiceConfig(cfg);
                        setSelectedVoiceURI(chosen.voiceURI || chosen.name);
                        localStorage.setItem('jobscan_ai_voice_config', JSON.stringify(cfg));
                        localStorage.setItem('jobscan_ai_voice_uri', chosen.voiceURI || chosen.name);
                        try {
                          window.speechSynthesis.cancel();
                          const testUtt = new SpeechSynthesisUtterance('J.A.R.V.I.S. voice confirmed and locked in.');
                          testUtt.voice = chosen;
                          testUtt.lang = chosen.lang || 'en-GB';
                          testUtt.rate = 1.2;
                          window.speechSynthesis.speak(testUtt);
                        } catch {}
                      }
                    }}
                    style={{
                      width: '100%',
                      marginTop: '8px',
                      padding: '7px 12px',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      backgroundColor: 'rgba(245, 158, 11, 0.15)',
                      color: 'var(--color-amber-400)',
                      border: '1px solid var(--color-amber-500)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px'
                    }}
                  >
                    🔊 Save & Test Voice
                  </button>
                </div>

                {/* Continuous Hands-Free & Wake-Word Settings */}
                <div style={{ borderTop: '1px dashed var(--color-zinc-800)', paddingTop: '10px' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--color-amber-400)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    🎙️ Voice Conversation & Microphone Loop
                  </div>

                  {/* Mode Selector */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '10px' }}>
                    <button
                      type="button"
                      onClick={() => setVoiceMode(VOICE_MODES.PUSH_TO_TALK)}
                      style={{
                        padding: '7px 6px',
                        borderRadius: '6px',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        backgroundColor: voiceMode === VOICE_MODES.PUSH_TO_TALK ? 'var(--color-amber-500)' : 'var(--color-zinc-900)',
                        color: voiceMode === VOICE_MODES.PUSH_TO_TALK ? '#000' : 'var(--color-zinc-300)',
                        border: voiceMode === VOICE_MODES.PUSH_TO_TALK ? '1px solid var(--color-amber-500)' : '1px solid var(--color-zinc-800)',
                        cursor: 'pointer'
                      }}
                    >
                      ✋ Push-to-Talk
                    </button>
                    <button
                      type="button"
                      onClick={() => setVoiceMode(VOICE_MODES.CONTINUOUS_HANDS_FREE)}
                      style={{
                        padding: '7px 6px',
                        borderRadius: '6px',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        backgroundColor: voiceMode === VOICE_MODES.CONTINUOUS_HANDS_FREE ? '#22c55e' : 'var(--color-zinc-900)',
                        color: voiceMode === VOICE_MODES.CONTINUOUS_HANDS_FREE ? '#000' : 'var(--color-zinc-300)',
                        border: voiceMode === VOICE_MODES.CONTINUOUS_HANDS_FREE ? '1px solid #22c55e' : '1px solid var(--color-zinc-800)',
                        cursor: 'pointer'
                      }}
                    >
                      🎙️ Continuous Hands-Free
                    </button>
                  </div>

                  {/* Silence Timeout Slider */}
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--color-zinc-300)', marginBottom: '3px' }}>
                      <span>⏳ Silence Timeout (Auto Stand-down):</span>
                      <strong style={{ color: 'var(--color-amber-400)' }}>{silenceTimeoutSec} seconds</strong>
                    </div>
                    <input
                      type="range"
                      min="4"
                      max="15"
                      step="1"
                      value={silenceTimeoutSec}
                      onChange={(e) => setSilenceTimeoutSec(parseInt(e.target.value, 10))}
                      style={{ width: '100%', accentColor: 'var(--color-amber-500)' }}
                    />
                  </div>

                  {/* Wake-Word Toggle */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.74rem', color: 'var(--color-zinc-200)', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={wakeWordEnabled}
                      onChange={(e) => setWakeWordEnabled(e.target.checked)}
                      style={{ accentColor: 'var(--color-amber-500)', width: '15px', height: '15px' }}
                    />
                    <span>Enable Wake-Word Detection (<strong>"Hey Jarvis"</strong> / <strong>"Jarvis"</strong>)</span>
                  </label>
                </div>
              </div>
            )}


            {/* Chat Messages */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}
            >
              {messages.map((m, idx) => {
                const isUser = m.sender === 'user';
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: isUser ? 'flex-end' : 'flex-start'
                    }}
                  >
                    <div
                      style={{
                        maxWidth: '85%',
                        padding: '10px 14px',
                        borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                        backgroundColor: isUser ? 'var(--color-amber-500)' : 'var(--color-zinc-800)',
                        color: isUser ? '#000' : 'var(--color-zinc-100)',
                        fontSize: '0.88rem',
                        lineHeight: '1.45',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)'
                      }}
                    >
                      <div style={{ whiteSpace: 'pre-wrap' }}>{isUser ? m.text : formatMessageDisplay(m.text)}</div>


                      {/* Developer Diagnostics Telemetry Panel */}
                      {devMode && m.telemetry && (
                        <div
                          style={{
                            marginTop: '8px',
                            borderTop: '1px dashed rgba(255, 255, 255, 0.15)',
                            paddingTop: '6px',
                            fontSize: '0.72rem'
                          }}
                        >
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ backgroundColor: 'rgba(168, 85, 247, 0.2)', color: '#d8b4fe', padding: '2px 6px', borderRadius: '4px', fontWeight: 800 }}>
                              🤖 {m.telemetry.modelUsed || 'gemini-3.6-flash'}
                            </span>
                            <span style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                              🎯 {m.telemetry.intent || 'Standard Lookup'}
                            </span>
                            {m.telemetry.durationMs !== undefined && (
                              <span style={{ backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#86efac', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                ⏱️ {m.telemetry.durationMs}ms
                              </span>
                            )}
                          </div>

                          {/* Sources Used Banner */}
                          {m.telemetry.sourcesUsed && m.telemetry.sourcesUsed.length > 0 && (
                            <div style={{ margin: '4px 0', fontSize: '0.70rem', color: '#fef08a', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 800 }}>📚 Sources:</span>
                              {m.telemetry.sourcesUsed.map((src, sIdx) => {
                                const isDocs = src.includes('Google Docs');
                                const isSheets = src.includes('Google Sheets');
                                const isMemory = src.includes('Memory');
                                const isReminders = src.includes('Field Reminders');
                                const isDrive = src.includes('Google Drive') && !isDocs;
                                const isInspection = src.includes('Inspection');
                                const isWeather = src.includes('Weather');
                                
                                const icon = isDocs ? '📄 ' : isSheets ? '📊 ' : isMemory ? '🧠 ' : isReminders ? '📝 ' : isDrive ? '📁 ' : isInspection ? '🏗️ ' : isWeather ? '🌦️ ' : '⚡ ';
                                const bg = isDocs ? 'rgba(56, 189, 248, 0.2)' : isSheets ? 'rgba(16, 185, 129, 0.15)' : isMemory ? 'rgba(168, 85, 247, 0.15)' : isReminders ? 'rgba(245, 158, 11, 0.15)' : isDrive ? 'rgba(56, 189, 248, 0.15)' : 'rgba(234, 179, 8, 0.15)';
                                const border = isDocs ? 'rgba(56, 189, 248, 0.4)' : isSheets ? 'rgba(16, 185, 129, 0.3)' : isMemory ? 'rgba(168, 85, 247, 0.3)' : isReminders ? 'rgba(245, 158, 11, 0.3)' : isDrive ? 'rgba(56, 189, 248, 0.3)' : 'rgba(234, 179, 8, 0.3)';
                                const color = isDocs ? '#38bdf8' : isSheets ? '#6ee7b7' : isMemory ? '#d8b4fe' : isReminders ? '#fde047' : isDrive ? '#7dd3fc' : '#fde047';

                                return (
                                  <span key={sIdx} style={{ backgroundColor: bg, border: `1px solid ${border}`, padding: '1px 5px', borderRadius: '3px', color: color, fontWeight: 600 }}>
                                    {icon}
                                    {src}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          {/* Cognitive Initiative Telemetry */}
                          {m.telemetry.cognitiveInitiative && (
                            <div style={{ margin: '4px 0', fontSize: '0.68rem', color: '#c084fc', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 800 }}>⚡ Initiative:</span>
                              <span style={{ backgroundColor: 'rgba(192, 132, 252, 0.15)', border: '1px solid rgba(192, 132, 252, 0.3)', padding: '1px 5px', borderRadius: '3px' }}>
                                Intent: {m.telemetry.cognitiveInitiative.intentType || 'direct_query'}
                              </span>
                              <span style={{ backgroundColor: 'rgba(192, 132, 252, 0.15)', border: '1px solid rgba(192, 132, 252, 0.3)', padding: '1px 5px', borderRadius: '3px' }}>
                                Score: {m.telemetry.cognitiveInitiative.score} (Gate: {m.telemetry.cognitiveInitiative.threshold || 0.70})
                              </span>
                              {m.telemetry.cognitiveInitiative.warranted && (
                                <span style={{ backgroundColor: 'rgba(52, 211, 153, 0.15)', border: '1px solid rgba(52, 211, 153, 0.3)', color: '#6ee7b7', padding: '1px 5px', borderRadius: '3px', fontWeight: 700 }}>
                                  💡 Offered: {m.telemetry.cognitiveInitiative.domain}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Latency Instrumentation Breakdown */}
                          {m.telemetry.latencyMetrics && (
                            <div style={{ margin: '4px 0', fontSize: '0.68rem', color: m.telemetry.latencyMetrics.retryOccurred ? '#fbbf24' : '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 800 }}>⏱️ Latency:</span>
                              <span style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '1px 5px', borderRadius: '3px' }}>
                                Total: {m.telemetry.latencyMetrics.totalDurationMs}ms
                              </span>
                              <span style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '1px 5px', borderRadius: '3px' }}>
                                Attempt 1: {m.telemetry.latencyMetrics.attempt1DurationMs}ms
                              </span>
                              {m.telemetry.latencyMetrics.retryOccurred && (
                                <>
                                  <span style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#fde047', padding: '1px 5px', borderRadius: '3px', fontWeight: 700 }}>
                                    🔄 Retried ({m.telemetry.latencyMetrics.retryReason}): +{m.telemetry.latencyMetrics.attempt2DurationMs}ms
                                  </span>
                                  <span style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5', padding: '1px 5px', borderRadius: '3px' }}>
                                    ⚠️ UX Latency Warning
                                  </span>
                                </>
                              )}
                            </div>
                          )}

                          {m.telemetry.toolsExecuted && m.telemetry.toolsExecuted.length > 0 ? (
                            <div style={{ marginTop: '5px', backgroundColor: 'rgba(0, 0, 0, 0.45)', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                              <div style={{ fontWeight: 800, color: 'var(--color-amber-400)', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                🛠️ Tools Called ({m.telemetry.toolsExecuted.length}):
                              </div>
                              {m.telemetry.toolsExecuted.map((t, tIdx) => (
                                <div key={tIdx} style={{ fontSize: '0.70rem', fontFamily: 'monospace', marginTop: '3px', paddingBottom: '3px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ color: '#67e8f9', fontWeight: 700 }}>⚡ {typeof t === 'string' ? t : (t.name || t.tool || 'Tool')}</span>
                                    {t.result?._executionDurationMs !== undefined && (
                                      <span style={{ color: '#86efac' }}>{t.result._executionDurationMs}ms</span>
                                    )}
                                  </div>
                                  <div style={{ color: 'var(--color-zinc-400)' }}>Args: {JSON.stringify(t.args || {})}</div>
                                  {t.result && (
                                    <div style={{ color: '#a7f3d0', marginTop: '2px', fontSize: '0.68rem' }}>
                                      Result: {t.result.writesPerformed !== undefined ? `${t.result.status || t.result.action || 'success'} (${t.result.writesPerformed} write${t.result.writesPerformed === 1 ? '' : 's'})` : t.result.results ? `${t.result.results.length} records found` : t.result.count ? `${t.result.count} receipts` : t.result.status || t.result.location || JSON.stringify(t.result).slice(0, 60) + '...'}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.68rem', color: 'var(--color-zinc-400)', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {m.telemetry.memoriesGroundedCount > 0 ? (
                                <span style={{ color: '#a7f3d0' }}>
                                  🧠 Memory Vault: {m.telemetry.memoriesGroundedCount} persistent memory retrieved from Firestore
                                </span>
                              ) : (
                                <span>ℹ️ Grounded directly from live data manifest.</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Unified Document & File Action Cards */}
                      {m.documents && m.documents.length > 0 && (
                        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {m.documents.map((doc, dIdx) => (
                            <DocumentCard
                              key={dIdx}
                              file={doc}
                              folderName={doc.folderName}
                              error={doc.error}
                            />
                          ))}
                        </div>
                      )}

                      {/* Interactive Document & Receipt Viewer Cards (Legacy Fallback) */}
                      {!m.documents && m.viewFiles && m.viewFiles.length > 0 && (
                        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {m.viewFiles.map((vf, vIdx) => (
                            <DocumentCard
                              key={vIdx}
                              file={{ name: vf.fileName, id: vf.fileId, webViewLink: `https://drive.google.com/file/d/${vf.fileId}/view` }}
                              folderName={vf.folderName}
                            />
                          ))}
                        </div>
                      )}

                      <div
                        style={{
                          fontSize: '0.68rem',
                          color: isUser ? 'rgba(0, 0, 0, 0.6)' : 'var(--color-zinc-400)',
                          textAlign: 'right',
                          marginTop: '4px'
                        }}
                      >
                        {m.timestamp}
                      </div>
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: '12px 12px 12px 2px',
                      backgroundColor: 'var(--color-zinc-800)',
                      color: 'var(--color-amber-500)',
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <Loader2 size={16} className="spin-animation" />
                    <span>J.A.R.V.I.S. is thinking...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Live Voice State Active Bar */}
            {(voiceState !== VOICE_STATES.IDLE) && (
              <div
                style={{
                  padding: '8px 16px',
                  backgroundColor: (voiceState === VOICE_STATES.LISTENING || voiceState === VOICE_STATES.AUTO_LISTENING)
                    ? 'rgba(34, 197, 94, 0.15)'
                    : (voiceState === VOICE_STATES.SPEAKING)
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'rgba(168, 85, 247, 0.15)',
                  borderTop: '1px solid ' + (
                    (voiceState === VOICE_STATES.LISTENING || voiceState === VOICE_STATES.AUTO_LISTENING)
                      ? 'rgba(34, 197, 94, 0.3)'
                      : (voiceState === VOICE_STATES.SPEAKING)
                      ? 'rgba(239, 68, 68, 0.3)'
                      : 'rgba(168, 85, 247, 0.3)'
                  ),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  flexShrink: 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: (voiceState === VOICE_STATES.LISTENING || voiceState === VOICE_STATES.AUTO_LISTENING)
                        ? '#22c55e'
                        : (voiceState === VOICE_STATES.SPEAKING)
                        ? '#ef4444'
                        : '#a855f7',
                      animation: 'pulse 1.2s infinite'
                    }}
                  />
                  <span
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      color: (voiceState === VOICE_STATES.LISTENING || voiceState === VOICE_STATES.AUTO_LISTENING)
                        ? '#86efac'
                        : (voiceState === VOICE_STATES.SPEAKING)
                        ? '#fca5a5'
                        : '#d8b4fe',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {voiceState === VOICE_STATES.AUTO_LISTENING
                      ? `🎙️ Hands-Free Listening: Speak now (${silenceRemaining}s remaining)...`
                      : voiceState === VOICE_STATES.LISTENING
                      ? '🎙️ Listening... Speak your question now'
                      : voiceState === VOICE_STATES.SPEAKING
                      ? '🔊 Jarvis is speaking... (Tap Interrupt to stop)'
                      : '🧠 Jarvis is processing...'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (voiceState === VOICE_STATES.SPEAKING) {
                      voiceSmRef.current?.bargeIn('user_clicked_banner_interrupt');
                    } else {
                      voiceSmRef.current?.standDown('user_clicked_banner_cancel');
                    }
                  }}
                  style={{
                    padding: '3px 8px',
                    backgroundColor: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '4px',
                    color: '#fff',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    flexShrink: 0
                  }}
                >
                  {voiceState === VOICE_STATES.SPEAKING ? '⏹ Interrupt' : '✕ Stand Down'}
                </button>
              </div>
            )}

            {/* Input Bar */}
            <form
              onSubmit={handleSendMessage}
              style={{
                padding: '10px 12px',
                paddingBottom: 'max(14px, env(safe-area-inset-bottom, 14px))',
                backgroundColor: 'var(--color-zinc-950)',
                borderTop: '1px solid var(--color-zinc-800)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexShrink: 0,
                width: '100%',
                boxSizing: 'border-box'
              }}
            >

              <button
                type="button"
                onClick={() => {
                  const nextMode = voiceMode === VOICE_MODES.CONTINUOUS_HANDS_FREE ? VOICE_MODES.PUSH_TO_TALK : VOICE_MODES.CONTINUOUS_HANDS_FREE;
                  setVoiceMode(nextMode);
                }}
                style={{
                  height: '44px',
                  padding: '0 8px',
                  backgroundColor: voiceMode === VOICE_MODES.CONTINUOUS_HANDS_FREE ? 'rgba(34, 197, 94, 0.18)' : 'rgba(39, 39, 42, 0.6)',
                  border: '1px solid ' + (voiceMode === VOICE_MODES.CONTINUOUS_HANDS_FREE ? '#22c55e' : 'var(--color-zinc-700)'),
                  color: voiceMode === VOICE_MODES.CONTINUOUS_HANDS_FREE ? '#86efac' : 'var(--color-zinc-400)',
                  borderRadius: '8px',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                }}
                title="Toggle Hands-Free Voice Mode (Automatically listens after Jarvis answers)"
              >
                {voiceMode === VOICE_MODES.CONTINUOUS_HANDS_FREE ? '🎙️ Auto' : '✋ PTT'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = aiLanguage === 'es' ? 'en' : 'es';
                  setAiLanguage(next);
                  localStorage.setItem('jobscan_ai_lang', next);
                }}
                style={{
                  height: '44px',
                  padding: '0 8px',
                  backgroundColor: aiLanguage === 'es' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                  border: '1px solid ' + (aiLanguage === 'es' ? '#22c55e' : '#3b82f6'),
                  color: aiLanguage === 'es' ? '#86efac' : '#93c5fd',
                  borderRadius: '8px',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                }}
                title="Click to toggle Mic Language (English / Español)"
              >
                {aiLanguage === 'es' ? '🇲🇽 ES' : '🇺🇸 EN'}
              </button>
              <button
                type="button"
                onClick={handleVoiceInput}
                style={{
                  height: '44px',
                  minWidth: '44px',
                  padding: '0 10px',
                  backgroundColor: (voiceState === VOICE_STATES.LISTENING || voiceState === VOICE_STATES.AUTO_LISTENING)
                    ? 'rgba(34, 197, 94, 0.25)'
                    : (voiceState === VOICE_STATES.SPEAKING)
                    ? 'rgba(239, 68, 68, 0.25)'
                    : 'rgba(197, 160, 89, 0.15)',
                  border: '1px solid ' + (
                    (voiceState === VOICE_STATES.LISTENING || voiceState === VOICE_STATES.AUTO_LISTENING)
                      ? '#22c55e'
                      : (voiceState === VOICE_STATES.SPEAKING)
                      ? '#ef4444'
                      : 'var(--color-amber-500)'
                  ),
                  color: (voiceState === VOICE_STATES.LISTENING || voiceState === VOICE_STATES.AUTO_LISTENING)
                    ? '#86efac'
                    : (voiceState === VOICE_STATES.SPEAKING)
                    ? '#fca5a5'
                    : 'var(--color-amber-500)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  flexShrink: 0,
                  boxShadow: (voiceState === VOICE_STATES.LISTENING || voiceState === VOICE_STATES.AUTO_LISTENING)
                    ? '0 0 10px rgba(34, 197, 94, 0.4)'
                    : 'none'
                }}
                title={
                  voiceState === VOICE_STATES.SPEAKING
                    ? 'Tap to Interrupt (Barge-In)'
                    : voiceState === VOICE_STATES.AUTO_LISTENING
                    ? `Hands-Free Listening (${silenceRemaining}s)`
                    : isRecording
                    ? 'Listening...'
                    : 'Voice Dictation (Mic)'
                }
              >
                {voiceState === VOICE_STATES.SPEAKING ? (
                  <>
                    <Square size={14} fill="#fca5a5" />
                    <span style={{ fontSize: '0.70rem', fontWeight: 800 }}>Stop</span>
                  </>
                ) : (voiceState === VOICE_STATES.LISTENING || voiceState === VOICE_STATES.AUTO_LISTENING) ? (
                  <>
                    <Mic size={16} />
                    <span style={{ fontSize: '0.70rem', fontWeight: 800 }}>{silenceRemaining}s</span>
                  </>
                ) : (
                  <Mic size={18} />
                )}
              </button>

              <input
                type="text"
                placeholder={aiLanguage === 'es' ? 'Pregunta en Español: "¿Cuánto balance con el pintor?"...' : 'Ask J.A.R.V.I.S. in English or Spanish...'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isLoading}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: '44px',
                  backgroundColor: 'var(--color-zinc-950)',
                  border: '1px solid var(--color-zinc-800)',
                  borderRadius: '8px',
                  padding: '0 12px',
                  color: 'var(--color-zinc-100)',
                  fontSize: '0.9rem',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              <button
                type="submit"
                disabled={isLoading}
                style={{
                  height: '44px',
                  minWidth: '44px',
                  padding: '0 16px',
                  backgroundColor: 'var(--color-amber-500)',
                  color: '#000',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  flexShrink: 0
                }}
              >
                <Send size={18} />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Provider-Agnostic, Capability-Driven Document Viewer Modal */}
      {activePreviewFile && (
        <DocumentViewerModal
          file={activePreviewFile}
          token={googleToken}
          onClose={() => setActivePreviewFile(null)}
        />
      )}


      {/* Two-Tier Health & AI Diagnostic Suite Modal */}
      {showTestSuite && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 100001,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            backdropFilter: 'blur(8px)'
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '700px',
              maxHeight: '92vh',
              backgroundColor: 'var(--color-zinc-950)',
              border: '1px solid var(--color-zinc-800)',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden'
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid var(--color-zinc-800)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: 'rgba(24, 24, 27, 0.6)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.3rem' }}>🧪</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: 'var(--color-zinc-100)' }}>
                    System Diagnostics & Health Suite
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--color-zinc-400)' }}>
                    Two-Tier health classification & one-click live tool testing
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTestSuite(false)}
                style={{ background: 'none', border: 'none', color: 'var(--color-zinc-400)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              
              {/* Action Banner */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--color-zinc-900)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--color-zinc-800)' }}>
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-zinc-200)' }}>
                    Active Project: <span style={{ color: 'var(--color-amber-400)' }}>{projectName}</span>
                  </div>
                  <div style={{ fontSize: '0.70rem', color: 'var(--color-zinc-400)' }}>
                    Model: <code style={{ color: '#86efac' }}>gemini-3.5-flash (GA Stable)</code>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRunDiagnosticSuite}
                  disabled={isRunningTests}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: isRunningTests ? 'var(--color-zinc-800)' : 'var(--color-amber-500)',
                    color: isRunningTests ? 'var(--color-zinc-400)' : '#000',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    fontSize: '0.82rem',
                    cursor: isRunningTests ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  {isRunningTests ? <Loader2 size={16} className="animate-spin" /> : '▶'}
                  {isRunningTests ? 'Running Checks...' : '▶ Run Diagnostic Suite'}
                </button>
              </div>

              {/* Two-Tier Health Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                
                {/* 1. Tool / API Infrastructure Health */}
                <div style={{ backgroundColor: 'var(--color-zinc-900)', border: '1px solid var(--color-zinc-800)', borderRadius: '8px', padding: '12px' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#86efac', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    🛠️ Tool & API Infrastructure
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {(testSuiteData?.health?.toolHealth || [
                      { name: 'Open-Meteo Weather API', badge: '🟢 Operational', detail: 'REST Endpoint Active' },
                      { name: 'Gemini Brain Engine', badge: '🟢 Operational', detail: 'gemini-3.5-flash (GA Stable)' },
                      { name: 'Google Drive API', badge: googleToken ? '🟢 Authenticated' : '🟡 Offline Cache', detail: googleToken ? 'OAuth2 Bearer Token Valid' : 'Using Local Storage Drive Cache' },
                      { name: 'Sheets Ledger Engine', badge: '🟢 Operational', detail: 'Category Router Active' }
                    ]).map((t, idx) => (
                      <div key={idx} style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: '6px 8px', borderRadius: '6px', fontSize: '0.72rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                          <span style={{ color: '#fff' }}>{t.name}</span>
                          <span>{t.badge}</span>
                        </div>
                        <div style={{ color: 'var(--color-zinc-400)', fontSize: '0.66rem', marginTop: '2px' }}>{t.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. Project Data Health */}
                <div style={{ backgroundColor: 'var(--color-zinc-900)', border: '1px solid var(--color-zinc-800)', borderRadius: '8px', padding: '12px' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#93c5fd', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    📊 Project Data Health
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {(testSuiteData?.health?.dataHealth || [
                      { name: 'Subcontractor Ledger', badge: '🟢 Ledger Ready', detail: 'Phase contract and quote data' },
                      { name: 'Receipts & Transactions', badge: '🟢 Records Indexed', detail: 'Payment attachments and logs' },
                      { name: 'Drive Document Tree', badge: driveTree?.subfolders?.length ? `🟢 ${driveTree.subfolders.length} Folders` : '🟡 No Files Indexed', detail: 'Blueprint and spec files' },
                      { name: 'Finish Specs', badge: finishCount ? `🟢 ${finishCount} Specs` : '🟡 0 Specs Configured', detail: 'Paint and material selections' }
                    ]).map((d, idx) => (
                      <div key={idx} style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: '6px 8px', borderRadius: '6px', fontSize: '0.72rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                          <span style={{ color: '#fff' }}>{d.name}</span>
                          <span>{d.badge}</span>
                        </div>
                        <div style={{ color: 'var(--color-zinc-400)', fontSize: '0.66rem', marginTop: '2px' }}>{d.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {/* 3. Live One-Click Tool Execution Results */}
              {testSuiteData?.testResults && (
                <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--color-amber-400)' }}>
                    🧪 Live Tool Endpoint Test Results ({testSuiteData.testResults.length})
                  </div>
                  {testSuiteData.testResults.map((t, idx) => (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: 'var(--color-zinc-900)',
                        border: '1px solid ' + (t.passed ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'),
                        borderRadius: '8px',
                        padding: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.95rem' }}>{t.passed ? '🟢' : '🔴'}</span>
                          <span style={{ fontWeight: 800, fontSize: '0.84rem', color: '#fff' }}>{t.title}</span>
                          <code style={{ fontSize: '0.70rem', color: '#67e8f9', backgroundColor: 'rgba(0,0,0,0.4)', padding: '2px 5px', borderRadius: '4px' }}>
                            {t.tool}
                          </code>
                        </div>
                        <span style={{ fontSize: '0.72rem', color: '#86efac', fontWeight: 700 }}>
                          ⏱️ {t.durationMs}ms
                        </span>
                      </div>

                      <div style={{ fontSize: '0.70rem', color: 'var(--color-zinc-400)', fontFamily: 'monospace' }}>
                        Args: {JSON.stringify(t.args)}
                      </div>

                      <details style={{ marginTop: '2px' }}>
                        <summary style={{ fontSize: '0.70rem', color: 'var(--color-amber-400)', cursor: 'pointer', fontWeight: 700 }}>
                          View Raw Returned Payload
                        </summary>
                        <pre style={{ margin: '6px 0 0 0', padding: '8px', backgroundColor: '#000', borderRadius: '6px', fontSize: '0.68rem', color: '#a7f3d0', overflowX: 'auto' }}>
                          {JSON.stringify(t.payload, null, 2)}
                        </pre>
                      </details>
                    </div>
                  ))}
                </div>
              )}

              {!testSuiteData && !isRunningTests && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-zinc-500)', fontSize: '0.82rem' }}>
                  Click <strong>"▶ Run Diagnostic Suite"</strong> to test all tool endpoints with live data.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Activity Log Drawer / Modal */}
      {showActivityLog && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 100001,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            backdropFilter: 'blur(8px)'
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '750px',
              maxHeight: '92vh',
              backgroundColor: 'var(--color-zinc-950)',
              border: '1px solid var(--color-zinc-800)',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden'
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid var(--color-zinc-800)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: 'rgba(24, 24, 27, 0.6)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.3rem' }}>📋</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: 'var(--color-zinc-100)' }}>
                    AI Activity Log ({activityLogs.length} interactions)
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--color-zinc-400)' }}>
                    History of models, tools called, input arguments, latency, and results
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {activityLogs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setActivityLogs([]);
                      localStorage.removeItem('jobscan_ai_activity_logs');
                    }}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#f87171',
                      borderRadius: '6px',
                      fontSize: '0.70rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    Clear History
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowActivityLog(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--color-zinc-400)', cursor: 'pointer' }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {activityLogs.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-zinc-500)', fontSize: '0.85rem' }}>
                  No AI interactions logged yet in this session. Ask a question in chat to record activity.
                </div>
              ) : (
                activityLogs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      backgroundColor: 'var(--color-zinc-900)',
                      border: '1px solid var(--color-zinc-800)',
                      borderRadius: '8px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.84rem', fontWeight: 800, color: 'var(--color-zinc-100)' }}>
                        💬 "{log.query}"
                      </span>
                      <span style={{ fontSize: '0.70rem', color: 'var(--color-zinc-400)' }}>
                        {log.timestamp}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                      <span style={{
                        backgroundColor: log.source === 'Local Tool Data' ? 'rgba(16, 185, 129, 0.2)' : (log.source === 'Local Project Ledger' ? 'rgba(6, 182, 212, 0.2)' : 'rgba(168, 85, 247, 0.2)'),
                        color: log.source === 'Local Tool Data' ? '#6ee7b7' : (log.source === 'Local Project Ledger' ? '#67e8f9' : '#d8b4fe'),
                        border: `1px solid ${log.source === 'Local Tool Data' ? 'rgba(16, 185, 129, 0.4)' : (log.source === 'Local Project Ledger' ? 'rgba(6, 182, 212, 0.4)' : 'rgba(168, 85, 247, 0.4)')}`,
                        padding: '2px 7px',
                        borderRadius: '4px',
                        fontSize: '0.70rem',
                        fontWeight: 800
                      }}>
                        {log.source === 'Local Tool Data' ? '⚡ Source: Local Tool Data' : (log.source === 'Local Project Ledger' ? '📁 Source: Local Project Ledger' : '🤖 Source: Gemini Cloud AI')}
                      </span>
                      <span style={{ backgroundColor: 'rgba(255, 255, 255, 0.06)', color: 'var(--color-zinc-300)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.70rem', fontWeight: 600 }}>
                        {log.modelUsed}
                      </span>
                      <span style={{ backgroundColor: log.httpStatus === '200 OK' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)', color: log.httpStatus === '200 OK' ? '#86efac' : '#fca5a5', padding: '2px 6px', borderRadius: '4px', fontSize: '0.70rem', fontWeight: 700 }}>
                        📡 {log.httpStatus || '200 OK'}
                      </span>
                      <span style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', padding: '2px 6px', borderRadius: '4px', fontSize: '0.70rem', fontWeight: 600 }}>
                        🎯 {log.intent}
                      </span>
                      <span style={{ backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#86efac', padding: '2px 6px', borderRadius: '4px', fontSize: '0.70rem', fontWeight: 600 }}>
                        ⏱️ {log.durationMs}ms
                      </span>
                    </div>


                    {/* Tools Invoked & Data Returned */}
                    {log.toolsExecuted && log.toolsExecuted.length > 0 && (
                      <div style={{ backgroundColor: 'rgba(0,0,0,0.4)', padding: '8px', borderRadius: '6px', marginTop: '4px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-amber-400)', marginBottom: '4px' }}>
                          🛠️ Tools Invoked ({log.toolsExecuted.length}):
                        </div>
                        {log.toolsExecuted.map((t, tIdx) => (
                          <div key={tIdx} style={{ fontSize: '0.70rem', fontFamily: 'monospace', color: 'var(--color-zinc-300)', marginTop: '4px', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ color: '#67e8f9', fontWeight: 700 }}>⚡ {typeof t === 'string' ? t : (t.name || t.tool || 'Tool')}</span>
                              <span style={{ color: 'var(--color-zinc-400)' }}>Args: {JSON.stringify(t.args || {})}</span>
                            </div>
                            {t.result && (
                              <details style={{ marginTop: '3px' }}>
                                <summary style={{ color: '#a7f3d0', cursor: 'pointer', fontSize: '0.68rem', fontWeight: 600 }}>
                                  View Data Returned from Sheet/Cache ▾
                                </summary>
                                <pre style={{ margin: '4px 0 0 0', padding: '6px', backgroundColor: '#000', borderRadius: '4px', fontSize: '0.65rem', color: '#86efac', overflowX: 'auto' }}>
                                  {JSON.stringify(t.result, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Final Synthesized Answer */}
                    <div style={{ fontSize: '0.74rem', color: 'var(--color-zinc-200)', backgroundColor: 'rgba(255,255,255,0.04)', padding: '8px', borderRadius: '6px', marginTop: '2px', borderLeft: '3px solid var(--color-amber-400)' }}>
                      <div style={{ color: 'var(--color-amber-400)', fontWeight: 800, fontSize: '0.70rem', marginBottom: '2px' }}>Final Synthesized Answer:</div>
                      {log.finalAnswer || log.resultSummary}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </>
  );
}

