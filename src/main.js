import './style.css';
import { supabase, isCloudReady } from './supabase.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { console.warn('NOVA local storage write failed',e); return false; } }
};
let active = 'home';
const welcomeMessage = {role:'nova', text:'Я NOVA. Опиши ідею — я допоможу перетворити її на щось незабутнє.'};
const legacyMessages = store.get('nova-messages', [welcomeMessage]);
let conversations = store.get('nova-conversations', []);
if (!Array.isArray(conversations) || !conversations.length) conversations = [{id:'nova-first', title:'Нова розмова', messages:legacyMessages, updatedAt:Date.now()}];
let activeConversationId = store.get('nova-active-conversation', conversations[0].id);
if (!conversations.some(chat => chat.id === activeConversationId)) activeConversationId = conversations[0].id;
let messages = conversations.find(chat => chat.id === activeConversationId).messages;
let library = store.get('nova-library', []);
let adult = store.get('nova-adult', false);
let adultTone = store.get('nova-adult-tone', false);
let adultLearning = store.get('nova-adult-learning', false);
let adultVocabulary = store.get('nova-adult-vocabulary', []);
if (!Array.isArray(adultVocabulary)) adultVocabulary = [];
let session = null;
let authNotice = '';
let authMode = 'login';
let chatBusy = false;
let imageBusy = false;
let imageResult = '';
let imageError = '';
let imagePrompt = '';
let imageReference = '';
let imageReferenceName = '';
let imagePresentation = 'unspecified';
let preserveFace = true;
let imageSeed = store.get('nova-image-seed', Math.floor(Math.random()*9_999_999_999)+1);
let imageStrictPrompt = store.get('nova-image-strict-prompt', true);
let imageBuilder = {subject:'',scene:'',clothing:'',pose:'',mood:''};
let adultModel = store.get('nova-adult-image-model', 'unspecified');
let adultStyle = store.get('nova-adult-image-style', 'photorealistic');
let novaAura = store.get('nova-director-aura', 'violet');
let novaFocus = store.get('nova-director-focus', 'portrait');
let customCharacters = store.get('nova-characters', []);
let characterNotice = '';
let activeCharacter = store.get('nova-active-character', null);
let videoPrompt = '';
let videoDuration = '8';
let videoRatio = '9:16';
let videoStyle = 'dark cinematic';
let videoMotion = 'push-in';
let videoEngine = store.get('nova-video-engine', 'neural');
let videoStoryboard = '';
let videoBusy = false;
let videoStatus = '';
let videoUrl = '';
let videoError = '';
let musicTracks = store.get('nova-music-tracks', []);
let musicNotice = '';
let musicPrompt = '';
let voiceAutoSpeak = store.get('nova-voice-autospeak', true);
let voiceSendAfterRecognition = store.get('nova-voice-send-after-recognition', false);
let voiceListening = false;
let currentRecognition = null;
let voiceSpeechUnlocked = false;
let voiceConversationMode = store.get('nova-voice-conversation-mode', false);
let voiceNotice = '';
let voicePhase = 'idle';
let voiceSessionId = 0;
let voiceSpeechUtterance = null;
let voiceRestartTimer = null;
let voiceRecognitionFailed = false;
let workFiles = [];
let workPlan = '';
let workStatus = '';
let workBusy = false;
let workDirectory = null;
let workScopes = store.get('nova-work-scopes', { files:true, browser:false, apps:false });
if(!workScopes || typeof workScopes !== 'object') workScopes={files:true,browser:false,apps:false};
let workActionQueue = store.get('nova-work-action-queue', []);
if(!Array.isArray(workActionQueue)) workActionQueue=[];
let workDesktopApps = [];
let workPendingApp = '';
let workVoiceListening = false;
const localVideoApi = (import.meta.env.VITE_LOCAL_VIDEO_API_URL || '/api/video').replace(/\/$/, '');

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const nativeVoice = () => Boolean(window.NovaVoice);
const voiceInputSupported = Boolean(SpeechRecognition || nativeVoice());
const voiceOutputSupported = Boolean(('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) || nativeVoice());
function setVoiceNotice(message) { voiceNotice=message; const status=$('#voice-status'); if(status) status.textContent=message; }
function setVoicePhase(phase){voicePhase=phase;const room=$('.nova-voice-room');if(room)room.dataset.voicePhase=phase;const label=$('#voice-phase-label');if(label)label.textContent=({idle:'Готова до розмови',listening:'Слухаю тебе',thinking:'NOVA думає',speaking:'NOVA говорить'})[phase]||'Готова до розмови';}
function unlockNOVAVoice(){
  if(!voiceOutputSupported)return;
  try { window.speechSynthesis.resume(); voiceSpeechUnlocked=true; } catch(error){console.warn('NOVA speech unlock failed',error);}
}
function scheduleNextVoiceTurn(sessionId){
  clearTimeout(voiceRestartTimer);
  if(!voiceConversationMode||sessionId!==voiceSessionId||chatBusy||voiceListening||active!=='voice')return;
  voiceRestartTimer=setTimeout(()=>{
    if(voiceConversationMode&&sessionId===voiceSessionId&&!chatBusy&&!voiceListening&&active==='voice')startVoiceInput();
  },500);
}
function voiceFriendlyText(text){
  return String(text || '')
    .replace(/ДІАГНОСТИКА:[\s\S]*$/i, '')
    .replace(/https?:\/\/\S+/g, ' посилання ')
    .replace(/\*\*|__|[#*]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[•►▶]/g, ', ')
    .replace(/\s+/g, ' ').trim().slice(0, 2500);
}
function speakNOVA(text){
  if(!voiceOutputSupported&&!nativeVoice()){setVoiceNotice('Голос NOVA недоступний у цьому браузері. Спробуй Chrome і перевір голосовий рушій Android.');return false;}
  if(!text)return false;
  const sessionId=voiceSessionId;
  if(nativeVoice()){
    try{setVoicePhase('speaking');setVoiceNotice('NOVA говорить…');window.NovaVoice.speak(voiceFriendlyText(text));return true;}
    catch(error){setVoiceNotice('Помилка Android TTS: '+(error?.message||'невідомо'));return false;}
  }
  try {
    window.speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(String(text).replace(/[`*_#]/g,' ').slice(0,3500));
    voiceSpeechUtterance=utterance;
    utterance.lang='uk-UA';utterance.rate=0.96;utterance.pitch=1;utterance.volume=1;
    const voices=window.speechSynthesis.getVoices();
    const voice=voices.find(v=>/^uk/i.test(v.lang))||voices.find(v=>/^ru/i.test(v.lang))||voices.find(v=>/^en/i.test(v.lang));
    if(voice)utterance.voice=voice;
    utterance.onstart=()=>{if(sessionId!==voiceSessionId)return;setVoicePhase('speaking');setVoiceNotice('NOVA говорить…');};
    utterance.onend=()=>{
      if(voiceSpeechUtterance===utterance)voiceSpeechUtterance=null;
      if(sessionId!==voiceSessionId)return;
      setVoicePhase('idle');setVoiceNotice('NOVA слухатиме твою наступну фразу.');
      scheduleNextVoiceTurn(sessionId);
    };
    utterance.onerror=event=>{
      if(voiceSpeechUtterance===utterance)voiceSpeechUtterance=null;
      if(sessionId!==voiceSessionId||event.error==='canceled'||event.error==='interrupted')return;
      setVoicePhase('idle');setVoiceNotice('Не вдалося відтворити голос NOVA ('+(event.error||'помилка')+'). Перевір Android Text-to-Speech.');
    };
    setVoicePhase('speaking');setVoiceNotice('NOVA озвучує відповідь…');
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
    return true;
  }catch(error){setVoicePhase('idle');setVoiceNotice('Помилка голосу: '+(error?.message||'невідома'));return false;}
}
function startVoiceInput(){
  if(!voiceInputSupported&&!nativeVoice()){setVoiceNotice('Розпізнавання голосу недоступне у цьому Android WebView. Відкрий NOVA у Chrome.');return;}
  if(voiceListening||currentRecognition||chatBusy)return;
  clearTimeout(voiceRestartTimer);
  const sessionId=voiceSessionId;
  if(nativeVoice()){
    currentRecognition={abort:()=>window.NovaVoice.stopListening()};
    voiceListening=true;setVoicePhase('listening');setVoiceNotice('NOVA слухає…');
    try{window.NovaVoice.listen();}catch(error){voiceListening=false;currentRecognition=null;setVoiceNotice('Помилка Android мікрофона: '+(error?.message||'невідомо'));}
    return;
  }
  let recognition;
  try{recognition=new SpeechRecognition();}catch(error){setVoiceNotice('Мікрофон недоступний: '+(error?.message||'помилка'));return;}
  currentRecognition=recognition;
  recognition.lang='uk-UA';recognition.interimResults=true;recognition.maxAlternatives=1;
  let transcript='';let finalTranscript='';let failed=false;
  recognition.onstart=()=>{if(sessionId!==voiceSessionId)return;voiceListening=true;setVoicePhase('listening');setVoiceNotice('NOVA слухає…');const b=$('#voice-input');if(b)b.disabled=true;};
  recognition.onresult=event=>{
    if(sessionId!==voiceSessionId)return;
    transcript=Array.from(event.results).map(r=>r[0]?.transcript||'').join(' ').trim();
    finalTranscript=Array.from(event.results).filter(r=>r.isFinal).map(r=>r[0]?.transcript||'').join(' ').trim()||finalTranscript;
    const input=$('#chat-input');if(input)input.value=transcript;
    setVoiceNotice(transcript?'Почула: '+transcript:'Говори…');
  };
  recognition.onerror=event=>{
    failed=true;
    if(sessionId!==voiceSessionId)return;
    const permission=event.error==='not-allowed'||event.error==='service-not-allowed';
    if(permission){voiceConversationMode=false;store.set('nova-voice-conversation-mode',false);}
    setVoiceNotice(permission?'Дозволь доступ до мікрофона в налаштуваннях Android.':'Помилка розпізнавання ('+event.error+'). Спробуй ще раз.');
  };
  recognition.onend=()=>{
    if(currentRecognition===recognition)currentRecognition=null;
    voiceListening=false;const b=$('#voice-input');if(b)b.disabled=false;
    if(sessionId!==voiceSessionId)return;
    const text=(finalTranscript||transcript).trim();
    if(text&&!chatBusy&&(voiceConversationMode||voiceSendAfterRecognition)){
      setVoiceNotice('Почула: '+text+'. Надсилаю NOVA…');setVoicePhase('thinking');
      learnAdultVocabulary(text);messages.push({role:'user',text});persistChat();
      askNOVA(text);
    }else if(voiceConversationMode&&!failed){setVoicePhase('idle');setVoiceNotice('Слухаю далі…');scheduleNextVoiceTurn(sessionId);}
    else setVoicePhase('idle');
  };
  try{recognition.start();}catch(error){currentRecognition=null;voiceListening=false;setVoicePhase('idle');setVoiceNotice('Не вдалося ввімкнути мікрофон: '+(error?.message||'перевір дозволи'));}
}

window.addEventListener('nova-native-voice',event=>{
  const {type,value}=event.detail||{};
  if(type==='apps-ready'){loadDesktopApplications();return;}
  if(type==='recognition-result'&&workVoiceListening){workVoiceListening=false;applyWorkVoiceCommand(value);return;}
  if(type==='recognition-error'&&workVoiceListening){workVoiceListening=false;const notice=$('#work-voice-notice');if(notice)notice.textContent='Не вдалося розпізнати команду. Спробуй ще раз.';return;}
  if(type==='speech-start'){setVoicePhase('speaking');setVoiceNotice('NOVA говорить…');}
  if(type==='speech-end'){setVoicePhase('idle');if(voiceConversationMode)scheduleNextVoiceTurn(voiceSessionId);}
  if(type==='speech-error'){setVoicePhase('idle');setVoiceNotice('Помилка озвучення Android: '+(value||'невідомо'));}
  if(type==='recognition-start'){setVoicePhase('listening');setVoiceNotice('NOVA слухає…');}
  if(type==='recognition-result'){
    voiceListening=false;currentRecognition=null;
    if(!voiceConversationMode)return;
    const text=String(value||'').trim();
    if(text&&!chatBusy){setVoiceNotice('Почула: '+text+'. Надсилаю NOVA…');setVoicePhase('thinking');learnAdultVocabulary(text);messages.push({role:'user',text});persistChat();askNOVA(text);}
    else {setVoiceNotice('Не розпізнала слова. Слухаю ще раз…');scheduleNextVoiceTurn(voiceSessionId);}
  }
  if(type==='recognition-error'){voiceListening=false;currentRecognition=null;setVoicePhase('idle');const code=Number(value);if(voiceConversationMode&&(code===6||code===7||code===8)){setVoiceNotice('Не почула фразу. Слухаю ще раз…');scheduleNextVoiceTurn(voiceSessionId);}else setVoiceNotice('Мікрофон Android: '+(value||'помилка')+'. Перевір дозволи та натисни «Почати».');}
});

const audioStore = (() => {
  const open = () => new Promise((resolve, reject) => { const request=indexedDB.open('nova-audio',1); request.onupgradeneeded=()=>request.result.createObjectStore('tracks'); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); });
  const run = async (mode, id, value) => { const db=await open(); return new Promise((resolve,reject)=>{const tx=db.transaction('tracks',mode); const request=mode==='readwrite' ? (value ? tx.objectStore('tracks').put(value,id) : tx.objectStore('tracks').delete(id)) : tx.objectStore('tracks').get(id); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);}); };
  return {get:id=>run('readonly',id), put:(id,blob)=>run('readwrite',id,blob), remove:id=>run('readwrite',id)};
})();
async function hydrateMusicTracks(){ for(const track of musicTracks){try{const blob=await audioStore.get(track.id);if(blob)track.url=URL.createObjectURL(blob);}catch(error){console.warn('NOVA audio restore failed',error);} } render(); }
function audioDuration(file){ return new Promise((resolve,reject)=>{const audio=document.createElement('audio');const url=URL.createObjectURL(file);audio.preload='metadata';audio.onloadedmetadata=()=>{URL.revokeObjectURL(url);resolve(Math.round(audio.duration));};audio.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Браузер не зміг прочитати аудіофайл.'));};audio.src=url;});}
function formatDuration(seconds){const m=Math.floor((seconds||0)/60),s=(seconds||0)%60;return `${m}:${String(s).padStart(2,'0')}`;}
function isSupportedAudio(file){return Boolean(file?.type?.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac|aac|webm)$/i.test(file?.name||''));}

function esc(t) { return String(t ?? '').replace(/[&<>"']/g, ch => { switch (ch) { case '&': return '&amp;'; case '<': return '&lt;'; case '>': return '&gt;'; case '"': return '&quot;'; case "'": return '&#39;'; default: return ch; } }); }
function chatTitle(chat) { const first=chat.messages?.find(message=>message.role==='user')?.text || chat.title || 'Нова розмова'; return first.replace(/\s+/g,' ').slice(0,42); }
function learnAdultVocabulary(text) {
  if (!adult || !adultTone || !adultLearning) return;
  const words = String(text || '').toLocaleLowerCase('uk-UA').match(/[\p{L}\p{N}'’-]{3,}/gu) || [];
  const ignored = new Set(['це','так','але','для','про','або','мене','тобі','тому','щоб','коли','якщо','дуже','треба','можна','буде','після','також','тільки','будь','please']);
  adultVocabulary = [...new Set([...adultVocabulary, ...words.filter(word => !ignored.has(word))])].slice(-30);
  store.set('nova-adult-vocabulary', adultVocabulary);
}
function persistChat() { const chat=conversations.find(item=>item.id===activeConversationId); if(chat){ chat.messages=messages; chat.title=chatTitle(chat); chat.updatedAt=Date.now(); } conversations.sort((a,b)=>b.updatedAt-a.updatedAt); store.set('nova-conversations',conversations); store.set('nova-active-conversation',activeConversationId); store.set('nova-messages',messages); }
function newChat() { const id=globalThis.crypto?.randomUUID?.() || `nova-${Date.now()}`; const chat={id,title:'Нова розмова',messages:[{...welcomeMessage}],updatedAt:Date.now()}; conversations.unshift(chat); activeConversationId=id; messages=chat.messages; active='chat'; persistChat(); render(); }
function openChat(id) { const chat=conversations.find(item=>item.id===id); if(!chat)return; activeConversationId=id; messages=chat.messages; active='chat'; store.set('nova-active-conversation',id); render(); }
function deleteChat(id) { conversations=conversations.filter(chat=>chat.id!==id); if(!conversations.length){ const replacement={id:`nova-${Date.now()}`,title:'Нова розмова',messages:[{...welcomeMessage}],updatedAt:Date.now()}; conversations=[replacement]; } if(id===activeConversationId){ activeConversationId=conversations[0].id; messages=conversations[0].messages; } persistChat(); render(); }
function icon(n) { return ({home:'⌂',chat:'◈',image:'◇',video:'▷',music:'♫',characters:'♙',library:'▣',adult:'18+',work:'⚙'})[n]; }
function navItem(id, label) { return `<button class="nav-item ${active===id?'active':''}" data-go="${id}"><span>${icon(id)}</span><small>${label}</small></button>`; }
function hero() { return `<section class="hero home-hero"><img class="heroine-art" src="${import.meta.env.BASE_URL}nova-heroine.png" alt="Готична героїня NOVA AI"/><div class="hero-scrim"></div><button class="menu-mark" data-go="work" aria-label="Режим роботи NOVA">☰</button><div class="hero-logo"><b>NOVA AI<span>✦</span></b><small>Your AI. Your world.</small></div><button class="crown-mark" data-go="adult" aria-label="18+ Mode">♛</button><button class="avatar-mark" id="open-auth" aria-label="Профіль">●</button><div class="free-panel"><b>∞</b><strong>Безкоштовно<br>Назавжди</strong><small>✓ Без лімітів<br>✓ Без підписок<br>✓ Без карток</small></div></section>`; }
function homeCard(id, iconText, title, subtitle){return `<button class="home-card" data-go="${id}"><span>${iconText}</span><b>${title}</b><small>${subtitle}</small></button>`;}
function home(){return `<section class="screen home-screen">${hero()}<button class="home-prompt" data-go="chat"><span>✦</span><div><b>Що ти хочеш створити?</b><small>Запитай мене або обери розділ...</small></div><i>↑</i></button><div class="home-grid">${homeCard('image','▧','Image Studio','Створи зображення')}${homeCard('video','▶','Video Studio','Створи відео')}${homeCard('characters','♙','Characters','Твої персонажі')}${homeCard('chat','◈','AI Chat','Спілкуйся зі мною')}${homeCard('library','▣','My Library','Твоя бібліотека')}${homeCard('adult','18+','18+ Mode','Для дорослих')}</div></section>`; }
function stopVoiceRoom(){try{window.NovaVoice?.stopListening();window.NovaVoice?.stopSpeaking();}catch{}voiceSessionId++;clearTimeout(voiceRestartTimer);setVoicePhase('idle');voiceConversationMode=false;store.set('nova-voice-conversation-mode',false);try{currentRecognition?.abort();}catch{}currentRecognition=null;voiceListening=false;voiceSpeechUtterance=null;window.speechSynthesis?.cancel();setVoiceNotice('Розмову завершено.');}
function voiceRoom(){const latest=messages.slice(-6);return `<section class="screen nova-voice-room" data-voice-phase="${voicePhase}"><button class="voice-back" id="voice-back">← Повернутися до чату</button><div class="voice-room-hero"><img src="${import.meta.env.BASE_URL}nova-heroine.png" alt="NOVA"/><div class="voice-room-shade"></div><div class="voice-room-title"><span>LIVE · NOVA AI</span><h2>Голосова розмова</h2><p id="voice-status">${esc(voiceNotice||'Натисни «Почати розмову»')}</p></div></div><div class="voice-visualizer" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div><p class="voice-phase-label" id="voice-phase-label">${({idle:"Готова до розмови",listening:"Слухаю тебе",thinking:"NOVA думає",speaking:"NOVA говорить"})[voicePhase]}</p><div class="voice-room-actions"><button id="voice-room-start">${voiceConversationMode?'🎙 Слухати':'🎙 Почати розмову'}</button><button id="voice-room-stop">■ Завершити</button><button id="voice-room-test" type="button">🔊 Перевірити голос</button></div><div class="voice-room-transcript" aria-live="polite">${latest.map(m=>`<p><b>${m.role==='nova'?'NOVA':'Ти'}:</b> ${esc(m.text)}</p>`).join('')}</div>${!voiceInputSupported&&!nativeVoice()?'<p class="voice-room-help">Розпізнавання голосу недоступне у цьому Android WebView. Спробуй Chrome.</p>':''}</section>`;}
function chat() { const onlyWelcome=messages.length===1&&messages[0].role==='nova'; const voiceState=voiceNotice || (voiceInputSupported?'Натисни мікрофон і скажи повідомлення.':'Голосове введення не підтримується цим браузером.'); return `<section class="screen chat-screen">${activeCharacter?`<div class="active-persona">✧ ${esc(activeCharacter.name)} <button id="clear-persona">×</button></div>`:''}<div class="chat-topbar"><div><span>NEURAL CHANNEL · ${chatBusy ? 'CONNECTING' : 'ONLINE'}</span><h2>${esc(chatTitle(conversations.find(c=>c.id===activeConversationId)||{}))}</h2></div><button class="round" id="clear-chat" aria-label="Очистити чат">↻</button></div><button type="button" class="open-voice-room" id="open-voice-room">🎙 Окремий голосовий режим</button><div class="voice-bar"><button type="button" id="voice-input" ${voiceInputSupported?'':'disabled'} aria-label="Сказати повідомлення">🎙</button><span id="voice-status">${esc(voiceState)}</span><button type="button" id="voice-test" ${voiceOutputSupported?'':'disabled'} aria-label="Перевірити голос NOVA">🔊</button><label><input id="voice-autospeak" type="checkbox" ${voiceAutoSpeak?'checked':''} ${voiceOutputSupported?'':'disabled'}> Озвучувати NOVA</label><label><input id="voice-send-after-recognition" type="checkbox" ${voiceSendAfterRecognition?'checked':''} ${voiceInputSupported?'':'disabled'}> Надсилати голосом</label><button type="button" id="voice-conversation" class="voice-conversation-toggle" ${voiceInputSupported&&voiceOutputSupported?'':'disabled'} aria-pressed="${voiceConversationMode}">${voiceConversationMode?'■ Завершити діалог':'☎ Голосовий діалог'}</button></div><div class="messages">${messages.map((m,index)=>`<article class="message ${m.role}"><div class="message-avatar">${m.role==='user'?'YOU':'N'}</div><div class="message-body"><b>${m.role==='user'?'Ти':'NOVA'}</b><p>${esc(m.text)}</p>${m.role==='nova'&&m.text!==welcomeMessage.text?'<button class="copy-answer" type="button" data-copy-answer="'+esc(m.text)+'">Копіювати</button><button class="speak-answer" type="button" data-speak-index="'+index+'">🔊 Озвучити</button>':''}</div></article>`).join('')}${onlyWelcome?`<div class="prompt-grid"><button data-suggestion="Допоможи написати сильний промпт для Image Studio">✦ Створити образ</button><button data-suggestion="Запропонуй концепцію короткого темного відео">▷ Спланувати відео</button><button data-suggestion="Допоможи з ідеєю для мого проєкту">◈ Обміркувати ідею</button></div>`:''}</div><form class="composer" id="chat-form"><button type="button" id="chat-voice-mode" class="chat-voice-mode" aria-label="Відкрити голосову розмову з NOVA">🎙<span>Голос</span></button><textarea id="chat-input" rows="1" maxlength="4000" ${chatBusy?'disabled':''} placeholder="Напиши NOVA..." autocomplete="off"></textarea><button ${chatBusy?'disabled':''} aria-label="Надіслати">${chatBusy?'…':'↑'}</button></form><p class="composer-note">NOVA може помилятися. Перевіряй важливу інформацію.</p></section>`; }
function imageStudio() { return `<section class="screen"><div class="page-head"><span>01 // VISUAL FORGE</span><h2>Image Studio</h2><p>Створи кінематографічний образ із текстового опису або власного фото.</p></div><div class="studio-card image-card"><div class="fake-art">✦<small>GENERATION CORE</small></div><label class="image-picker">▧ Додати фото або зображення<input id="image-reference-file" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>${imageReference?`<div class="reference-preview"><img src="${imageReference}" alt="Твоє фото-референс"/><div><b>${esc(imageReferenceName)}</b><small>Фото буде стиснено до 512 px і надіслано лише для цієї генерації.</small></div><button class="icon-button" id="clear-image-reference" aria-label="Прибрати фото">×</button></div><div class="identity-controls"><b>Людина на фото</b><div class="chips"><button type="button" data-presentation="feminine" class="${imagePresentation==='feminine'?'selected':''}">Жіночий образ</button><button type="button" data-presentation="masculine" class="${imagePresentation==='masculine'?'selected':''}">Чоловічий образ</button><button type="button" data-presentation="unspecified" class="${imagePresentation==='unspecified'?'selected':''}">Не вказувати</button></div><label class="identity-toggle"><input id="preserve-face" type="checkbox" ${preserveFace?'checked':''}> Зберігати ключові риси обличчя</label><small>Це вибір користувача, не автоматичне визначення за фото. Генеративна модель може трохи змінити риси.</small></div>`:`<p class="notice">JPEG, PNG або WebP до 5 МБ. Фото не зберігається NOVA після запиту.</p>`}<div class="identity-controls"><b>✦ Конструктор зображення</b><p class="notice">Поля автоматично враховуються під час генерації. Не потрібно натискати «Додати до опису».</p><label>Головний персонаж / об'єкт<input data-image-builder="subject" placeholder="Наприклад: доросла жінка" value="${esc(imageBuilder.subject)}"></label><label>Місце / сцена<input data-image-builder="scene" placeholder="Наприклад: вулиця" value="${esc(imageBuilder.scene)}"></label><label>Одяг і деталі<input data-image-builder="clothing" placeholder="Наприклад: повсякденний одяг" value="${esc(imageBuilder.clothing)}"></label><label>Поза / дія<input data-image-builder="pose" placeholder="Наприклад: дивиться в камеру" value="${esc(imageBuilder.pose)}"></label><label>Світло / настрій<input data-image-builder="mood" placeholder="Наприклад: природне освітлення" value="${esc(imageBuilder.mood)}"></label></div><label>Твій промпт<textarea id="image-prompt" maxlength="1800" placeholder="Наприклад: перетвори фото на готичний неоновий портрет...">${esc(imagePrompt)}</textarea></label><div class="chips"><button type="button" data-prompt-chip="dark gothic cyberpunk">Cyberpunk</button><button type="button" data-prompt-chip="gothic dark fantasy">Gothic</button><button type="button" data-prompt-chip="cinematic portrait">Portrait</button></div><div class="image-control-row"><label class="identity-toggle"><input id="image-strict-prompt" type="checkbox" ${imageStrictPrompt?'checked':''}> Точно слідувати опису</label><label class="image-seed">Seed для повтору<input id="image-seed" type="number" min="1" max="9999999999" value="${esc(imageSeed)}"></label><button type="button" class="secondary" id="new-image-seed">↻ Новий seed</button></div><p class="notice">Однаковий опис і seed дають відтворюваний варіант. Зміни seed, якщо хочеш іншу композицію.</p><button class="primary" id="generate-image" ${imageBusy?'disabled':''}>${imageBusy?'⟳ Генерую...':imageReference?'✦ Генерувати за фото':'✦ Створити зображення'}</button>${imageError?'<p class="image-error">'+esc(imageError)+'</p>':''}${imageResult?'<div class="generated-image"><img src="'+imageResult+'" alt="Згенероване NOVA зображення"/><p class="notice">Формат 9:16 · 1080 × 1920 PNG (кадрування й масштабування; не додаткова AI-деталізація)</p><button type="button" class="secondary download-image">↓ Зберегти на телефон</button><button class="secondary" id="save-image-concept">Зберегти опис до Library</button></div>':''}</div><p class="notice">Без фото використовується FLUX Schnell. Із фото — FLUX.2 reference generation; доступність залежить від лімітів Workers AI.</p></section>`; }
function videoStudio() { return `<section class="screen"><div class="page-head"><span>02 // MOTION VOID</span><h2>Video Studio</h2><p>Створи відео локально: нейромережею або Motion Forge без платних API.</p></div><div class="studio-card"><div class="video-preview"><span>▶</span><i>00:${videoDuration.padStart(2,'0')}</i></div><label>Режим створення</label><div class="chips video-engine"><button type="button" data-video-engine="neural" class="${videoEngine==='neural'?'selected':''}">✦ Нейромережа</button><button type="button" data-video-engine="motion" class="${videoEngine==='motion'?'selected':''}">◌ Motion Forge</button></div><p class="notice">${videoEngine==='neural'?'Нейромережа: локальний ComfyUI/Wan workflow на твоєму ПК або GPU. Модель не підключається до платного хмарного API.':'Motion Forge: безкоштовна анімація кадру; це не нейромережеве text-to-video.'}</p><label>Ідея відео<textarea id="video-prompt" maxlength="1800" placeholder="Наприклад: героїня йде крізь неоновий дощ, камера повільно наближається...">${esc(videoPrompt)}</textarea></label><label class="video-field-label">Стиль</label><div class="chips video-styles"><button type="button" data-video-style="dark cinematic" class="${videoStyle==='dark cinematic'?'selected':''}">Cinematic</button><button type="button" data-video-style="gothic fantasy" class="${videoStyle==='gothic fantasy'?'selected':''}">Gothic</button><button type="button" data-video-style="neon cyberpunk" class="${videoStyle==='neon cyberpunk'?'selected':''}">Cyberpunk</button></div><label class="video-field-label">Тривалість</label><div class="options"><button type="button" data-duration="5" class="${videoDuration==='5'?'selected':''}">5 с</button><button type="button" data-duration="8" class="${videoDuration==='8'?'selected':''}">8 с</button><button type="button" data-duration="12" class="${videoDuration==='12'?'selected':''}">12 с</button></div><label class="video-field-label">Формат кадру</label><div class="options"><button type="button" data-ratio="9:16" class="${videoRatio==='9:16'?'selected':''}">9:16</button><button type="button" data-ratio="16:9" class="${videoRatio==='16:9'?'selected':''}">16:9</button><button type="button" data-ratio="1:1" class="${videoRatio==='1:1'?'selected':''}">1:1</button></div><button class="secondary" id="build-video-plan" type="button">✦ Створити розкадрування</button>${videoStoryboard?`<div class="video-storyboard"><b>ТВОЯ РОЗКАДРОВКА</b><p>${esc(videoStoryboard).replace(/\n/g,'<br>')}</p><button class="secondary" id="copy-video-plan" type="button">Копіювати готовий промпт</button></div>`:''}<button class="primary" data-draft="video">▷ Зберегти сценарій до Library</button><button class="primary" id="generate-real-video" type="button" ${videoBusy?"disabled":""}>${videoBusy?"⟳ Створюю відео...":videoEngine==='neural'?"✦ Створити нейромережеве відео":"✦ Створити Motion Forge відео"}</button><div class="video-job-status" role="status">${esc(videoStatus||videoError)}</div>${videoUrl?'<video class="generated-video" controls playsinline src="'+esc(videoUrl)+'"></video><a href="'+esc(videoUrl)+'" target="_blank" rel="noopener">Відкрити відеофайл</a>':''}</div><p class="notice">Для нейромережі потрібні запущений ComfyUI, Wan-сумісний workflow та відеокарта. У вебверсії телефон підключається до companion-сервера в локальній мережі.</p></section>`; }
function musicLab(){return `<section class="screen"><div class="page-head"><span>03 // SOUND VAULT</span><h2>Music Lab</h2><p>Твої аудіофайли залишаються у сховищі цього браузера — вони не надсилаються на сервер.</p></div><div class="studio-card music-upload"><label class="audio-picker">♫ Завантажити пісню<input id="music-file" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac" hidden></label><p class="notice" role="status">${esc(musicNotice || 'Підтримуються аудіофайли до 50 МБ.')}</p></div><div class="music-list">${musicTracks.length?musicTracks.map(track=>`<article class="track-card"><div><b>${esc(track.name)}</b><small>${formatDuration(track.duration)} · ${esc(track.mime||'audio')}</small></div>${track.url?`<audio controls preload="metadata" src="${esc(track.url)}"></audio>`:'<p class="notice">Відкрий файл повторно, якщо браузер очистив локальне аудіосховище.</p>'}<label>Інструменти — вкажи або підтвердь після прослуховування<input data-track-instruments="${esc(track.id)}" value="${esc(track.instruments||'')}" placeholder="Наприклад: синтезатор, бас, ударні"></label><div class="track-actions"><button class="secondary" data-check-track="${esc(track.id)}">Перевірити склад</button><button class="primary" data-prompt-track="${esc(track.id)}">Створити промпт</button><button class="icon-button" data-remove-track="${esc(track.id)}" aria-label="Видалити пісню">×</button></div></article>`).join(''):`<div class="empty"><span>♫</span><h3>Додай першу пісню</h3><p>Після завантаження NOVA збереже файл локально та допоможе сформувати промпт.</p></div>`}</div>${musicPrompt?`<div class="studio-card music-result"><b>ГОТОВИЙ МУЗИЧНИЙ ПРОМПТ</b><p>${esc(musicPrompt)}</p><button class="secondary" id="copy-music-prompt">Копіювати промпт</button></div>`:''}</section>`;}
function characters() { const chars=[['NYX','Темна провидиця'],['VEX','Неоновий бунтар'],['LUNA','Синтетична муза']]; return `<section class="screen"><div class="page-head"><span>03 // SOUL ARCHIVE</span><h2>Characters</h2><p>Обери співрозмовника або створи власного.</p></div>${characterNotice?`<p class="notice" role="status">${esc(characterNotice)}</p>`:'' }<div class="character-grid">${chars.map((c,i)=>`<button class="character" data-character="${c[0]}" data-intro="${c[1]}"><div class="avatar a${i}"><span>◉</span></div><b>${c[0]}</b><small>${c[1]}</small></button>`).join('')}${customCharacters.map(c=>`<div class="character" role="button" tabindex="0" data-custom-character="${esc(c.name)}" data-intro="${esc(c.description)}"><div class="avatar"><span>✧</span></div><b>${esc(c.name)}</b><small>${esc(c.description)}</small><button type="button" class="delete-character" aria-label="Видалити персонажа" data-delete-character="${esc(c.id)}">×</button></div>`).join('')}<button class="character new" id="new-character"><div class="avatar">＋</div><b>NEW SOUL</b><small>Новий персонаж</small></button></div><div id="character-create"></div></section>`; }
function libraryView() { return `<section class="screen"><div class="page-head"><span>04 // MEMORY VAULT</span><h2>My Library</h2><p>${session ? 'Збережено на цьому пристрої; синхронізація текстів доступна.' : 'Збереження на цьому пристрої.'}</p><button class="secondary library-music-link" data-go="music">♫ Music Lab</button></div><div class="library">${library.length?library.map((x,i)=>`<article class="saved">${x.image?'<img class="library-thumb" src="'+x.image+'" alt="Збережене зображення"/>':'<div class="saved-icon">'+(x.type==='image'?'✦':'▷')+'</div>'}<div><small>${x.type==='image'?'IMAGE':'VIDEO IDEA'} · ${x.date}</small><p>${esc(x.text)}</p></div><button data-remove="${i}" aria-label="Видалити">×</button></article>`).join(''):`<div class="empty"><span>▣</span><h3>Тут поки тихо</h3><p>Збережені з Image та Video Studio з’являться тут.</p></div>`}</div></section>`; }
function adultView() { return `<section class="screen adult"><div class="adult-mark">18<span>+</span></div><div class="page-head"><span>05 // PRIVATE CHAMBER</span><h2>18+ Mode</h2><p>${adult?'Приватний режим увімкнено на цьому пристрої.':'Цей простір призначений лише для повнолітніх.'}</p></div>${adult?`<div class="studio-card adult-studio"><h3>Генератор 18+</h3><p class="notice">Лише вигадані або повнолітні люди, які дали явну згоду. Не завантажуй фото реальних людей для інтимної генерації; запити про неповнолітніх або без згоди блокуються.</p><label class="identity-toggle"><input id="adult-tone" type="checkbox" ${adultTone?'checked':''}> Дорослий тон у чаті (можлива ненормативна лексика)</label><label class="identity-toggle"><input id="adult-learning" type="checkbox" ${adultLearning?'checked':''} ${adultTone?'':'disabled'}> Запам’ятовувати мої слова локально для 18+ чату</label><p class="notice">${adultLearning&&adultTone?`Збережено ${adultVocabulary.length} слів на цьому пристрої. NOVA використовує їх тільки як стильову підказку в 18+ чаті.`:'Навчання вимкнено. Увімкни дорослий тон і добровільну локальну пам’ять.'}</p>${adultVocabulary.length?'<button class="secondary adult-memory-clear" id="clear-adult-vocabulary">Очистити вивчені слова</button>':''}<label>Приватний опис<textarea id="adult-prompt" maxlength="1800" placeholder="Наприклад: чуттєвий, але неявний готичний портрет повнолітньої вигаданої героїні…">${esc(imagePrompt)}</textarea></label><button class="primary" id="generate-adult-image" ${imageBusy?'disabled':''}>${imageBusy?'⟳ Генерую…':'✦ Створити 18+ зображення'}</button>${imageError?'<p class="image-error">'+esc(imageError)+'</p>':''}${imageResult?'<div class="generated-image"><img src="'+imageResult+'" alt="Згенероване NOVA приватне зображення"/><button type="button" class="secondary download-image">↓ Зберегти на телефон</button><button class="secondary" id="save-image-concept">Зберегти опис до Library</button></div>':''}<button class="secondary" id="disable-adult">Вимкнути режим</button></div>`:`<div class="studio-card"><h3>Підтвердження віку</h3><p>Підтверджую, що мені виповнилося 18 років і створюватиму лише законний контент за участі повнолітніх зі згодою.</p><button class="primary" id="enable-adult">Мені 18+</button></div>`}</section>`; }
function workView(){ return `<section class="screen work-screen"><div class="page-head"><span>06 // NOVA WORK MODE</span><h2>Режим роботи</h2><p>NOVA планує завдання й працює лише з файлами та папками, які ти сам обереш у браузері.</p></div><div class="studio-card work-card"><label>Завдання для NOVA<textarea id="work-task" maxlength="1800" placeholder="Наприклад: підготуй план упорядкування цих матеріалів і структуру папок."></textarea></label><div class="work-actions"><label class="secondary file-action">▧ Додати файли<input id="work-files" type="file" multiple hidden></label><button class="secondary" id="choose-work-folder" type="button">▣ Обрати папку</button></div><p class="notice" id="work-status">${esc(workStatus || 'Файли не надсилаються: до AI передаються лише назви, типи та розміри після натискання «Створити план».')}</p>${workFiles.length?`<ul class="work-file-list">${workFiles.map(file=>`<li>${esc(file.name)} <small>${esc(file.type||'невідомий тип')} · ${Math.ceil(file.size/1024)} КБ</small></li>`).join('')}</ul>`:''}<button class="primary" id="create-work-plan" ${workBusy?'disabled':''}>${workBusy?'⟳ NOVA працює…':'✦ Створити робочий план'}</button>${workPlan?`<div class="work-plan"><b>ПЛАН NOVA</b><p>${esc(workPlan)}</p><div class="work-actions"><button class="secondary" id="download-work-plan">↓ Завантажити план</button><button class="secondary" id="save-work-plan" ${workDirectory?'':'disabled'}>▣ Записати в обрану папку</button></div></div>`:''}</div></section>`; }
function content(){ return ({home,chat,voice:voiceRoom,image:imageStudio,video:videoStudio,music:musicLab,characters,library:libraryView,adult:adultView,work:workView})[active](); }
function authModal(){return `<div class="modal-backdrop" role="presentation"><section class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button class="modal-close" id="close-auth" aria-label="Закрити">×</button><span class="eyebrow">NOVA IDENTITY</span><h2 id="auth-title">${session ? 'Твій профіль' : authMode==='register' ? 'Створити NOVA ID' : 'Увійти до NOVA'}</h2>${session?`<p>${esc(session.user.email)}</p><button class="secondary" id="sign-out">Вийти</button>`:isCloudReady?`<div class="auth-tabs" role="tablist"><button type="button" data-auth-mode="login" class="${authMode==='login'?'selected':''}" role="tab" aria-selected="${authMode==='login'}">Увійти</button><button type="button" data-auth-mode="register" class="${authMode==='register'?'selected':''}" role="tab" aria-selected="${authMode==='register'}">Реєстрація</button></div><p>${authMode==='register'?'Створи NOVA ID. Ми надішлемо лист для підтвердження email.':'Увійди за email і паролем до свого NOVA ID.'}</p><form id="auth-form"><label>Email<input type="email" id="auth-email" autocomplete="email" placeholder="name@example.com" required/></label><label>Пароль<input type="password" id="auth-password" autocomplete="${authMode==='register'?'new-password':'current-password'}" placeholder="Мінімум 6 символів" minlength="6" required/></label>${authMode==='register'?'<label>Повтори пароль<input type="password" id="auth-password-confirm" autocomplete="new-password" placeholder="Повтори пароль" minlength="6" required/></label>':''}<button class="primary" type="submit">${authMode==='register'?'Створити акаунт':'Увійти'}</button></form><p class="notice" role="status">${esc(authNotice || (authMode==='register'?'Після реєстрації підтверди email і повернися для входу.':'Використовуй email, з яким зареєстрований NOVA ID.'))}</p>`:`<p>Хмарний обліковий запис ще не налаштований для цього deployment.</p><p class="notice">Хмарний вхід запрацює після підключення безкоштовного проєкту Supabase.</p>`}</section></div>`;}
function workspaceSidebar(){return `<aside class="workspace-sidebar"><button class="nova-brand" data-go="home"><span>✦</span> NOVA <i>AI</i></button><button class="new-chat" id="new-chat">＋ Нова розмова</button><div class="sidebar-section"><small>РОЗМОВИ</small><div class="conversation-list">${conversations.map(chat=>`<div class="conversation ${chat.id===activeConversationId?'selected':''}"><button data-open-chat="${esc(chat.id)}">${esc(chatTitle(chat))}</button><button class="conversation-delete" data-delete-chat="${esc(chat.id)}" aria-label="Видалити розмову">×</button></div>`).join('')}</div></div><div class="sidebar-tools"><button data-go="image">◇ Image Studio</button><button data-go="video">▷ Video Studio</button><button data-go="music">♫ Music Lab</button><button data-go="characters">♙ Characters</button><button data-go="library">▣ My Library</button><button data-go="work">⚙ Режим роботи</button></div><button class="sidebar-account" id="open-auth">${session?'● '+esc(session.user.email):'○ Увійти до NOVA'}</button></aside>`;}
function render(){ const hadAuth=Boolean($('.modal-backdrop')); $('#app').innerHTML=`<main class="app-shell">${workspaceSidebar()}<div class="app-content">${content()}</div><nav>${navItem('home','Головна')}${navItem('image','Галерея')}${navItem('chat','Історія')}${navItem('library','Вибране')}<button class="nav-item" id="open-settings"><span>⚙</span><small>Налаштування</small></button></nav></main>`; bind(); if(hadAuth&&!session){$('#app').insertAdjacentHTML('beforeend',authModal());bindAuth();} }
// FLUX Schnell returns a fixed-size image. Export a real 9:16 PNG by
// center-cropping to the requested aspect ratio, then resizing to 1080x1920.
async function formatImagePortrait916(source){
  const image=new Image();
  image.src=source;
  await image.decode();
  const canvas=document.createElement('canvas');
  canvas.width=1080;canvas.height=1920;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Canvas unavailable');
  const sourceRatio=image.naturalWidth/image.naturalHeight;
  const targetRatio=9/16;
  let sx=0,sy=0,sw=image.naturalWidth,sh=image.naturalHeight;
  if(sourceRatio>targetRatio){sw=sh*targetRatio;sx=(image.naturalWidth-sw)/2;}
  else{sh=sw/targetRatio;sy=(image.naturalHeight-sh)/2;}
  context.imageSmoothingEnabled=true;
  context.imageSmoothingQuality='high';
  context.drawImage(image,sx,sy,sw,sh,0,0,1080,1920);
  return canvas.toDataURL('image/png');
}
async function downloadGeneratedImage(){
  if(!imageResult)return;
  try{
    if(typeof window.NovaVoice?.saveImage==='function'){
      const saved=window.NovaVoice.saveImage(imageResult);
      if(saved==='OK'){
        imageError='✓ Зображення збережено у Галерея → Pictures → NOVA AI.';
        render();
        return;
      }
      imageError='Android не зміг зберегти файл у галерею ('+saved+').';
      render();
      return;
    }
    const response=await fetch(imageResult);
    const blob=await response.blob();
    const type=blob.type||'image/png';
    const extension=type.includes('jpeg')?'jpg':type.includes('webp')?'webp':'png';
    const filename='NOVA-AI-'+Date.now()+'.'+extension;
    const file=new File([blob],filename,{type});
    if(navigator.canShare?.({files:[file]})&&navigator.share){
      await navigator.share({files:[file],title:'NOVA AI'});
      return;
    }
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(error){
    if(error?.name==='AbortError')return;
    imageError='Не вдалося зберегти зображення. Відкрий NOVA у Chrome та спробуй ще раз.';
    render();
  }
}
async function generateImage(){
  const freePrompt=$('#image-prompt')?.value.trim() || $('#adult-prompt')?.value.trim() || '';
  const builderPrompt=active==='adult'?'':Object.entries(imageBuilder).filter(([,value])=>value.trim()).map(([key,value])=>({subject:'Main subject',scene:'Scene',clothing:'Clothing and details',pose:'Pose and action',mood:'Lighting and mood'})[key]+': '+value.trim()).join('\n');
  const prompt=[builderPrompt,freePrompt].filter(Boolean).join('\n');
  if(!prompt||imageBusy)return;
  imagePrompt=prompt;imageBusy=true;imageError='';imageResult='';render();
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),120000);
  try{
    const res=await fetch(`${import.meta.env.BASE_URL}api/image`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt,referenceImage:imageReference||undefined,presentation:imagePresentation,preserveFace,adultMode:Boolean(adult&&active==='adult'),adultModel,adultStyle,novaAura,novaFocus,seed:imageSeed,strictPrompt:imageStrictPrompt}),signal:controller.signal
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||data.code||'Сервер не повернув зображення.');
    if(typeof data.image!=='string'||!data.image.startsWith('data:image/'))throw new Error('Сервер повернув некоректне зображення.');
    imageResult=await formatImagePortrait916(data.image);if(Number.isInteger(data.seed)){imageSeed=data.seed;store.set('nova-image-seed',imageSeed);}if(data.seedApplied===false)imageError='Workers AI створив зображення без seed: повтор того самого варіанта зараз недоступний для цього акаунта.';
  }catch(e){
    imageError=e.name==='AbortError'?'Генерація перевищила 2 хвилини. Спробуй коротший опис або повтори пізніше.':e.message||'Не вдалося згенерувати зображення.';
  }finally{clearTimeout(timeout);imageBusy=false;render();}
}
async function createWorkPlan(){
  const task=$('#work-task')?.value.trim();
  if(!task||workBusy)return;
  workBusy=true; workStatus='NOVA формує план…'; render();
  const inventory=workFiles.map(file=>`${file.name} (${file.type||'unknown'}, ${Math.ceil(file.size/1024)} KB)`).join('; ') || 'Файли не додані.';
  const scope=Object.entries(workScopes).filter(([,enabled])=>enabled).map(([name])=>({files:'лише обрані файли та папки',browser:'браузерні кроки для ручного підтвердження',apps:'дії у програмах для ручного підтвердження'})[name]).join('; ') || 'лише план без доступу до зовнішніх систем';
  try {
    const response=await fetch(`${import.meta.env.BASE_URL}api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:`Ти працюєш у режимі NOVA Work Mode. Створи стислий практичний план українською для завдання: ${task}\n\nДозволена область: ${scope}.\nДоступний лише інвентар файлів (не їхній вміст): ${inventory}\n\nНе стверджуй, що виконав дію. Для браузера, програм або змін у файлах запропонуй окремі кроки, які потребують явного підтвердження користувача.`} ]})});
    if(!response.ok) throw new Error('AI-сервер тимчасово недоступний.');
    const raw=await response.text();
    const answer=raw.split(/\r?\n\r?\n/).map(event=>event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n')).filter(data=>data&&data!=='[DONE]').map(data=>{try{const packet=JSON.parse(data);return packet?.choices?.[0]?.delta?.content||packet?.response||'';}catch{return '';}}).join('').trim();
    workPlan=answer || 'NOVA не отримала текст плану. Спробуй ще раз.'; workStatus='План готовий. Він не змінює файли без твоєї окремої команди.';
  }catch(error){workStatus=error.message||'Не вдалося створити план.';}
  finally{workBusy=false;render();}
}
function downloadWorkPlan(){ const blob=new Blob([workPlan],{type:'text/plain;charset=utf-8'}); const url=URL.createObjectURL(blob); const link=document.createElement('a');link.href=url;link.download='nova-work-plan.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
async function saveWorkPlan(){ if(!workDirectory||!workPlan)return; try{const file=await workDirectory.getFileHandle('nova-work-plan.txt',{create:true});const writer=await file.createWritable();await writer.write(workPlan);await writer.close();workStatus='План записано в обрану папку як nova-work-plan.txt.';}catch(error){workStatus='Не вдалося записати файл у папку.';}render(); }
async function askNOVA(text) {
  const requestVoiceSession=voiceConversationMode?voiceSessionId:null;
  if(voiceConversationMode){setVoicePhase('thinking');setVoiceNotice('Питання надіслано. Чекаю відповідь AI…');}
  chatBusy=true;
  render();
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),voiceConversationMode?45000:90000);
  let reply=null;
  try {
    const history=(voiceConversationMode?messages.slice(-8):messages)
      .filter((m,i,items)=>!(i===0&&m.role==='nova')&&!(i===items.length-1&&m.role==='user'&&m.text===text))
      .map(m=>({role:m.role==='nova'?'assistant':'user',content:m.text}));
    const result=await fetch(`${import.meta.env.BASE_URL}api/chat`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({messages:[...history,{role:'user',content:text}],voiceMode:voiceConversationMode,persona:activeCharacter,adultTone:Boolean(adult&&adultTone),styleMemory:adult&&adultTone&&adultLearning?adultVocabulary:undefined}),
      signal:controller.signal
    });

    if(!result.ok) {
      const raw=await result.text();
      let data;
      try { data=JSON.parse(raw); } catch { data={error:raw}; }
      const diagnostics=Array.isArray(data.failures)
        ? data.failures.slice(0,3).map(item=>`${String(item.model||'model').replace('@cf/','')}: ${String(item.reason||'UNKNOWN')}`).join('; ')
        : '';
            throw new Error(`${data.code || `HTTP_${result.status}`}: ${data.error || 'Сервер не повернув відповідь.'}${diagnostics ? ' | Моделі: '+diagnostics : ''}`);
    }

    const contentType=result.headers.get('content-type') || '';
    if(contentType.includes('text/event-stream') && result.body) {
      reply={role:'nova',text:''};
      messages.push(reply);
      render();
      const replyEl=document.querySelector('.messages .message.nova:last-child');
      const reader=result.body.getReader();
      const decoder=new TextDecoder();
      let buffer='';

      const addChunk=(chunk)=>{
        if(!chunk) return;
        reply.text+=chunk;
        if(replyEl) replyEl.textContent=reply.text;
      };
      const parseEvent=(event)=>{
        const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');
        if(!data || data==='[DONE]') return;
        try {
          const packet=JSON.parse(data);
          const delta=packet?.choices?.[0]?.delta?.content
            ?? packet?.choices?.[0]?.message?.content
            ?? packet?.response
            ?? '';
          if(Array.isArray(delta)) addChunk(delta.map(part=>typeof part==='string'?part:part?.text||'').join(''));
          else if(typeof delta==='string') addChunk(delta);
        } catch {
          // Ignore non-JSON keep-alive/event frames.
        }
      };

      let lastChunkAt=Date.now();
      let pendingRead=reader.read();
      let streamDone=false;
      while(true) {
        let idleTimer;
        const next=await Promise.race([
          pendingRead,
          new Promise(resolve=>{idleTimer=setTimeout(()=>resolve({idle:true}),2500);})
        ]);
        clearTimeout(idleTimer);
        if(next.idle){
          if(reply.text.trim()&&Date.now()-lastChunkAt>=2500)break;
          continue;
        }
        if(next.done){streamDone=true;break;}
        lastChunkAt=Date.now();
        buffer+=decoder.decode(next.value,{stream:true});
        const events=buffer.split(/\r?\n\r?\n/);
        buffer=events.pop() || '';
        events.forEach(parseEvent);
        pendingRead=reader.read();
      }
      if(streamDone){buffer+=decoder.decode();if(buffer.trim())parseEvent(buffer);}
      if(!reply.text.trim()) reply.text='Модель не надіслала текстової відповіді. Спробуй ще раз.';
      if(!streamDone){reader.cancel().catch(()=>{});}
    } else {
      const data=await result.json();
      if(!data.answer) throw new Error(data.error || 'Сервер не повернув текст відповіді.');
      messages.push({role:'nova',text:data.answer});
    }
  } catch(error) {
    const detail=error?.name==='AbortError'
      ? `Час очікування вичерпано (${voiceConversationMode?45:90} секунд). AI-сервер не завершив відповідь.`
      : error?.message?.includes('Failed to fetch')
        ? 'Не вдалося з’єднатися з /api/chat. Перевір інтернет і адресу розгортання.'
        : `Помилка AI: ${error?.message || 'невідома помилка'}`;
    if(reply) reply.text=reply.text ? `${reply.text}\n\nДІАГНОСТИКА: ${detail}` : `ДІАГНОСТИКА: ${detail}`;
    else messages.push({role:'nova',text:`ДІАГНОСТИКА: FRONTEND_REQUEST_FAILED. ${detail}`});
  } finally {
    clearTimeout(timeout);
    chatBusy=false;
    persistChat();
    const newestReply=messages.slice().reverse().find(message=>message.role==='nova');
    render();
    const voiceSessionActive=requestVoiceSession!==null&&voiceConversationMode&&requestVoiceSession===voiceSessionId;
    const shouldSpeak=requestVoiceSession===null?voiceAutoSpeak:voiceSessionActive;
    if(shouldSpeak&&newestReply?.text&&newestReply.text!==welcomeMessage.text&&!newestReply.text.startsWith('ДІАГНОСТИКА:')){
      const started=speakNOVA(newestReply.text);
      if(!started&&voiceSessionActive)setVoiceNotice('NOVA отримала текст, але не змогла озвучити його. Перевір голос Android.');
    }else if(voiceSessionActive){
      setVoicePhase('idle');
      const errorText=newestReply?.text||'Сервер не повернув відповідь.';
      setVoiceNotice('NOVA не отримала відповідь від AI: '+errorText.slice(0,220));
    }
  }
}
async function compactImage(dataUrl){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const canvas=document.createElement('canvas');const max=768,scale=Math.min(1,max/Math.max(img.width,img.height));canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',0.78));};img.onerror=()=>reject(new Error('Не вдалося підготувати зображення для збереження.'));img.src=dataUrl;});}
async function prepareReferenceImage(file){if(!file?.type.match(/^image\/(jpeg|png|webp)$/))throw new Error('Обери JPEG, PNG або WebP.');if(file.size>5*1024*1024)throw new Error('Фото має бути до 5 МБ.');const raw=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Не вдалося прочитати фото.'));reader.readAsDataURL(file);});return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const scale=Math.min(1,512/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',0.84));};img.onerror=()=>reject(new Error('Браузер не зміг підготувати фото.'));img.src=raw;});}
async function saveDraft(type, text, image='') { const item={type,text,image,date:new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'short'}).format(new Date())}; library.unshift(item);if(!store.set('nova-library',library)){library.shift();throw new Error('Бібліотека пристрою переповнена. Видали старі записи й повтори.');}let cloudWarning='';if(session&&supabase&&!image){const {data,error}=await supabase.from('library_items').insert({user_id:session.user.id,type,prompt:text}).select('id').single();if(error){item.cloudError=true;store.set('nova-library',library);cloudWarning='Збережено лише на цьому пристрої: хмарна синхронізація не вдалася.';}if(data?.id){item.cloudId=data.id;store.set('nova-library',library);}}return {cloudWarning};}
async function loadCloudLibrary(){if(!session||!supabase)return;const {data,error}=await supabase.from('library_items').select('id,type,prompt,created_at').order('created_at',{ascending:false});if(error){console.error('Cloud library load failed',error);return;}if(data){const fmt=d=>new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'short'}).format(new Date(d));const localImages=library.filter(x=>x.image);const cloudItems=data.map(x=>({type:x.type,text:x.prompt,date:fmt(x.created_at),cloud:true,cloudId:x.id}));const unsynced=library.filter(x=>!x.image&&!x.cloud&&!data.some(y=>y.prompt===x.text&&y.type===x.type));library=[...localImages,...unsynced,...cloudItems];try{store.set('nova-library',library);}catch(e){console.warn('Library local cache limit',e);}}}
async function generateRealVideo() {
  const prompt = $('#video-prompt')?.value.trim();
  if (!prompt || videoBusy) return;
  videoPrompt = prompt; videoBusy = true; videoStatus = 'Надсилаю запит...'; videoError = ''; videoUrl = ''; render();
  try {
    const res = await fetch(localVideoApi, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({engine:videoEngine,prompt:prompt+' Style: '+videoStyle+'. Camera: '+videoMotion+'.',seconds:Math.max(4,Math.min(12,Number(videoDuration)||5)),aspect_ratio:videoRatio,motion:videoMotion,image:imageResult||undefined}) });
    const data = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(data.error || data.message || 'Не вдалося запустити генерацію (HTTP '+res.status+').');
    const id=data.video_id||data.id||data.data?.video_id; if(!id) throw new Error('API не повернув video_id.');
    videoStatus='Завдання створено. Очікую відео...'; render();
    for(let i=0;i<60;i++){
      await new Promise(resolve=>setTimeout(resolve,10000));
      const poll=await fetch(`${localVideoApi}?video_id=${encodeURIComponent(id)}`);
      const result=await poll.json().catch(()=>({}));
      if(!poll.ok) throw new Error(result.error||result.message||'Помилка перевірки статусу (HTTP '+poll.status+').');
      const status=String(result.status||result.data?.status||'').toLowerCase();
      const url=result.url||result.video_url||result.data?.url||result.data?.video_url;
      if(['completed','complete','success','succeeded','finished','done'].includes(status)&&url){videoUrl=url;videoStatus='Відео готове!';break;}
      if(['failed','error','cancelled','canceled'].includes(status)) throw new Error(result.error||result.message||result.data?.error||'Модель повідомила про помилку.');
      videoStatus='Генерація триває...';render();
    }
    if(!videoUrl) throw new Error('Час очікування (10 хвилин) завершився. Спробуй пізніше.');
  } catch(e) { videoError=e.message||'Помилка генерації відео.'; videoStatus=''; }
  finally { videoBusy=false; render(); }
}
function installVideoMotionControls(){
  const prompt=$('#video-prompt');
  if(!prompt||$('#video-motion-controls'))return;
  const controls=document.createElement('section');controls.id='video-motion-controls';controls.className='video-motion-controls';
  controls.innerHTML=`<b>РУХ КАМЕРИ MOTION FORGE</b><small>${imageResult?'Буде застосовано до поточного зображення з Image Studio.':'Без зображення NOVA створить анімований неоновий фон.'}</small><div class="chips"><button type="button" data-video-motion="push-in" class="${videoMotion==='push-in'?'selected':''}">Наближення</button><button type="button" data-video-motion="pan-left" class="${videoMotion==='pan-left'?'selected':''}">Панорама ←</button><button type="button" data-video-motion="pan-right" class="${videoMotion==='pan-right'?'selected':''}">Панорама →</button><button type="button" data-video-motion="drift" class="${videoMotion==='drift'?'selected':''}">Плавний дрейф</button></div>`;
  prompt.closest('label')?.after(controls);
  controls.querySelectorAll('[data-video-motion]').forEach(button=>button.onclick=()=>{videoMotion=button.dataset.videoMotion;render();});
}

function installImageComposer(){
  const prompt=$('#image-prompt');
  if(!prompt||$('#image-composer'))return;
  const composer=document.createElement('section');
  composer.id='image-composer';composer.className='image-composer';
  composer.innerHTML=`<b>✦ Конструктор зображення</b><small>Заповни потрібне — NOVA перетворить параметри на точний опис кадру.</small><div class="image-composer-grid"><label>Головний персонаж / об’єкт<input id="composer-subject" maxlength="180" placeholder="Наприклад: готична героїня"/></label><label>Місце / сцена<input id="composer-scene" maxlength="180" placeholder="Наприклад: замок під місяцем"/></label><label>Одяг і важливі деталі<input id="composer-details" maxlength="220" placeholder="Наприклад: чорна сукня, срібні прикраси"/></label><label>Поза або дія<input id="composer-action" maxlength="180" placeholder="Наприклад: дивиться в камеру"/></label><label>Світло / настрій<input id="composer-light" maxlength="180" placeholder="Наприклад: м’яке фіолетове неонове світло"/></label><label>Формат кадру<select id="composer-frame"><option value="vertical 9:16 mobile poster composition">Вертикальний 9:16</option><option value="square 1:1 balanced composition">Квадрат 1:1</option><option value="wide 16:9 cinematic composition">Горизонтальний 16:9</option><option value="close-up portrait composition">Крупний портрет</option></select></label></div><div class="work-actions"><button type="button" class="secondary" id="apply-image-composer">✦ Додати до опису</button><button type="button" class="secondary" id="clear-image-composer">Очистити поля</button></div><p class="notice" id="image-composer-notice">Можна комбінувати з власним текстом і фото-референсом. Модель може інтерпретувати деталі, тому для нового варіанта змінюй seed.</p>`;
  prompt.closest('label')?.before(composer);
  composer.querySelector('#apply-image-composer')?.addEventListener('click',()=>{
    const values=[['subject','Головний об’єкт'],['scene','Сцена'],['details','Деталі'],['action','Дія'],['light','Світло']].map(([id,label])=>[label,composer.querySelector(`#composer-${id}`)?.value.trim()]).filter(([,value])=>value);
    const frame=composer.querySelector('#composer-frame')?.value;
    if(!values.length){composer.querySelector('#image-composer-notice').textContent='Додай хоча б персонажа, сцену або важливу деталь.';return;}
    const description=[...values.map(([label,value])=>`${label}: ${value}.`),frame?`Composition: ${frame}.`:'' ].filter(Boolean).join(' ');
    imagePrompt=(prompt.value.trim()+' '+description).trim();prompt.value=imagePrompt;composer.querySelector('#image-composer-notice').textContent='Опис кадру додано. За потреби відредагуй текст перед генерацією.';
  });
  composer.querySelector('#clear-image-composer')?.addEventListener('click',()=>{composer.querySelectorAll('input').forEach(input=>input.value='');composer.querySelector('#image-composer-notice').textContent='Поля очищено. Твій основний опис не змінено.';});
}

function installNovaDirector(){
  const prompt=$('#image-prompt');
  if(!prompt||$('#nova-director'))return;
  const director=document.createElement('section');
  director.id='nova-director';
  director.className='nova-director';
  director.innerHTML=`<b>✦ NOVA Director</b><small>Твоя ідея + постійний авторський почерк NOVA.</small><label>Аура світу</label><div class="chips"><button type="button" data-nova-aura="violet" class="${novaAura==='violet'?'selected':''}">Violet</button><button type="button" data-nova-aura="moonlit" class="${novaAura==='moonlit'?'selected':''}">Moonlit</button><button type="button" data-nova-aura="cyber" class="${novaAura==='cyber'?'selected':''}">Cyber</button><button type="button" data-nova-aura="ember" class="${novaAura==='ember'?'selected':''}">Ember</button></div><label>Фокус кадру</label><div class="chips"><button type="button" data-nova-focus="portrait" class="${novaFocus==='portrait'?'selected':''}">Портрет</button><button type="button" data-nova-focus="fullbody" class="${novaFocus==='fullbody'?'selected':''}">Повний зріст</button><button type="button" data-nova-focus="world" class="${novaFocus==='world'?'selected':''}">Світ персонажа</button></div>`;
  prompt.closest('label')?.before(director);
  director.querySelectorAll('[data-nova-aura]').forEach(button=>button.onclick=()=>{novaAura=button.dataset.novaAura;store.set('nova-director-aura',novaAura);render();});
  director.querySelectorAll('[data-nova-focus]').forEach(button=>button.onclick=()=>{novaFocus=button.dataset.novaFocus;store.set('nova-director-focus',novaFocus);render();});
}

async function loadDesktopApplications(){
  const bridge=window.NovaDesktop||window.NovaVoice;
  if(!bridge?.listApplications)return;
  try { const listed=await bridge.listApplications();workDesktopApps=Array.isArray(listed)?listed:JSON.parse(listed);render(); } catch { workDesktopApps=[]; }
}

function findSpokenApplication(command){
  const text=command.toLowerCase();
  const aliases={chrome:['chrome','хром','гугл'],edge:['edge','едж','майкрософт'],explorer:['провідник','папк'],notepad:['блокнот','notepad'],calculator:['калькулятор','calc'],youtube:['youtube','ютуб'],maps:['maps','мап','карти'],settings:['налаштуван','settings']};
  return workDesktopApps.find(app=>(aliases[app.id]||[app.label.toLowerCase()]).some(alias=>text.includes(alias)));
}

function updatePendingAppUI(){
  const select=$('#work-app-select'), open=$('#open-work-app'), notice=$('#work-voice-notice');
  if(select)select.value=workPendingApp;
  if(open)open.disabled=!workPendingApp;
  if(notice&&workPendingApp){const app=workDesktopApps.find(item=>item.id===workPendingApp);notice.textContent=`Розпізнано: ${app?.label||'програма'}. Підтвердь відкриття кнопкою нижче.`;}
}

function applyWorkVoiceCommand(rawCommand){
  const task=$('#work-task'), notice=$('#work-voice-notice');
  const command=String(rawCommand||'').trim();
  if(!task||!command)return;
  task.value=command;
  const normalized=command.toLowerCase();
  const spokenApp=findSpokenApplication(command);
  if(spokenApp){workScopes.apps=true;workPendingApp=spokenApp.id;workActionQueue=[{title:`Відкрити програму: ${spokenApp.label}`}];updatePendingAppUI();}
  else if(/запусти|відкрий програм|launch/.test(normalized)){workScopes.apps=true;workActionQueue=[{title:`Дія у програмі: ${command}`}];if(notice)notice.textContent='Яку саме програму відкрити? Назви доступну програму зі списку нижче.';}
  else if(/відкрий|open/.test(normalized)){workScopes.browser=true;workActionQueue=[{title:`Браузерна дія: ${command}`}];}
  else {workActionQueue=[{title:`Робоче завдання: ${command}`}];}
  store.set('nova-work-scopes',workScopes);store.set('nova-work-action-queue',workActionQueue);
  if(notice&&!spokenApp)notice.textContent='Команду розпізнано. Перевір текст і створюй план або список дій.';
}

function startWorkVoiceCommand(){
  const notice=$('#work-voice-notice');
  if(!SpeechRecognition&&nativeVoice()){workVoiceListening=true;if(notice)notice.textContent='Слухаю команду…';window.NovaVoice.listen();return;}
  if(!SpeechRecognition){if(notice)notice.textContent='Голосові команди недоступні на цьому пристрої.';return;}
  const recognition=new SpeechRecognition();
  recognition.lang='uk-UA';recognition.interimResults=false;recognition.maxAlternatives=1;
  if(notice)notice.textContent='Слухаю команду…';
  recognition.onresult=event=>{
    applyWorkVoiceCommand(event.results[0]?.[0]?.transcript);
  };
  recognition.onerror=()=>{if(notice)notice.textContent='Не вдалося розпізнати команду. Спробуй ще раз або введи текст.';};
  recognition.start();
}

function installWorkConsole(){
  const task=$('#work-task');
  if(!task||$('#work-console'))return;
  const console=document.createElement('section');
  console.id='work-console';
  console.className='work-console';
  const queued=workActionQueue.length?`<ul>${workActionQueue.map(item=>`<li><b>${esc(item.title)}</b><small>Очікує твого окремого підтвердження</small></li>`).join('')}</ul>`:'';
  console.innerHTML=`<b>КОНСОЛЬ ДІЙ NOVA</b><p>Обери, для чого підготувати кроки. NOVA не натискає кнопки, не керує програмами та не змінює дані без окремого підтвердження.</p><button type="button" class="secondary" id="work-voice-command">🎙 Сказати команду</button><small id="work-voice-notice">Скажи, наприклад: «Відкрий сайт і підготуй перевірку» або «Запусти програму та створи список кроків».</small><label><input type="checkbox" data-work-scope="files" ${workScopes.files?'checked':''}> Обрані файли й папки</label><label><input type="checkbox" data-work-scope="browser" ${workScopes.browser?'checked':''}> Браузер: підготувати дії та перевірки</label><label><input type="checkbox" data-work-scope="apps" ${workScopes.apps?'checked':''}> Програми: підготувати послідовність дій</label><button type="button" class="secondary" id="build-work-queue">＋ Створити список дій</button>${queued}`;
  task.closest('label')?.after(console);
  const appBridge=window.NovaDesktop||window.NovaVoice;
  if(appBridge?.openApplication){
    const launcher=document.createElement('div');
    launcher.className='work-app-launcher';
    launcher.innerHTML=`<label>Програма для відкриття<select id="work-app-select"><option value="">Обери програму…</option>${workDesktopApps.map(app=>`<option value="${esc(app.id)}" ${workPendingApp===app.id?'selected':''}>${esc(app.label)}</option>`).join('')}</select></label><button type="button" class="secondary" id="open-work-app" ${workPendingApp?'':'disabled'}>↗ Підтвердити відкриття</button>`;
    console.querySelector('#work-voice-command')?.after(launcher);
  } else {
    const note=document.createElement('small');note.className='work-desktop-note';note.textContent='Відкривання програм доступне у Windows desktop-версії NOVA.';console.querySelector('#work-voice-command')?.after(note);
  }
  console.querySelectorAll('[data-work-scope]').forEach(input=>input.onchange=()=>{workScopes[input.dataset.workScope]=input.checked;store.set('nova-work-scopes',workScopes);});
  console.querySelector('#work-voice-command')?.addEventListener('click',startWorkVoiceCommand);
  console.querySelector('#work-app-select')?.addEventListener('change',event=>{workPendingApp=event.target.value;updatePendingAppUI();});
  console.querySelector('#open-work-app')?.addEventListener('click',async()=>{
    const appInfo=workDesktopApps.find(app=>app.id===workPendingApp);if(!appInfo||!appBridge)return;
    if(!window.confirm(`Відкрити «${appInfo.label}» на цьому пристрої?`))return;
    const opened=await appBridge.openApplication(appInfo.id);const result=typeof opened==='string'?JSON.parse(opened):opened;
    workStatus=result.ok?`Відкрито: ${result.label}.`:(result.error||'Не вдалося відкрити програму.');render();
  });
  console.querySelector('#build-work-queue')?.addEventListener('click',()=>{
    const taskText=task.value.trim()||'Поточне завдання';
    workActionQueue=[];
    if(workScopes.files)workActionQueue.push({title:`Перевірити обрані файли для: ${taskText}`});
    if(workScopes.browser)workActionQueue.push({title:'Відкрити та перевірити потрібні сторінки у браузері'});
    if(workScopes.apps)workActionQueue.push({title:'Підготувати кроки у вибраних програмах'});
    if(!workActionQueue.length)workActionQueue.push({title:'Уточнити область роботи перед будь-якою дією'});
    store.set('nova-work-action-queue',workActionQueue);workStatus='Список дій сформовано. Кожну зовнішню дію NOVA виконує лише після окремого підтвердження.';render();
  });
}

function installAdultCreativeControls(){
  const prompt=$('#adult-prompt');
  if(!prompt||$('#adult-creative-controls'))return;
  const controls=document.createElement('section');
  controls.id='adult-creative-controls';
  controls.className='adult-creative-controls';
  controls.innerHTML=`<b>Реалістичний персонаж</b><small>Лише вигаданий повнолітній образ. Вибір додається до промпту.</small><label>Тип персонажа</label><div class="chips"><button type="button" data-adult-model="feminine" class="${adultModel==='feminine'?'selected':''}">Жіночий</button><button type="button" data-adult-model="masculine" class="${adultModel==='masculine'?'selected':''}">Чоловічий</button><button type="button" data-adult-model="androgynous" class="${adultModel==='androgynous'?'selected':''}">Андрогінний</button></div><label>Візуальний стиль</label><div class="chips"><button type="button" data-adult-style="photorealistic" class="${adultStyle==='photorealistic'?'selected':''}">Fashion photo</button><button type="button" data-adult-style="cinematic" class="${adultStyle==='cinematic'?'selected':''}">Cinematic</button><button type="button" data-adult-style="gothic" class="${adultStyle==='gothic'?'selected':''}">Gothic</button></div><label>Готові безпечні деталі</label><div class="chips"><button type="button" data-adult-preset="full-length editorial pose, elegant evening outfit, detailed fabric, violet rim lighting">Повний зріст</button><button type="button" data-adult-preset="close-up beauty portrait, detailed skin texture, soft studio lighting, fashion magazine composition">Портрет</button><button type="button" data-adult-preset="dark gothic fashion, moonlit castle, dramatic violet light, confident pose">Готична сцена</button></div>`;
  prompt.closest('label')?.before(controls);
  controls.querySelectorAll('[data-adult-model]').forEach(button=>button.onclick=()=>{adultModel=button.dataset.adultModel;store.set('nova-adult-image-model',adultModel);installAdultCreativeControls();render();});
  controls.querySelectorAll('[data-adult-style]').forEach(button=>button.onclick=()=>{adultStyle=button.dataset.adultStyle;store.set('nova-adult-image-style',adultStyle);installAdultCreativeControls();render();});
  controls.querySelectorAll('[data-adult-preset]').forEach(button=>button.onclick=()=>{imagePrompt=(prompt.value.trim()+' '+button.dataset.adultPreset).trim();prompt.value=imagePrompt;prompt.focus();});
}

function bind(){
  document.querySelectorAll('.download-image').forEach(button=>button.addEventListener('click',downloadGeneratedImage));
  installVideoMotionControls();
  installImageComposer();
  installNovaDirector();
  installWorkConsole();
  installAdultCreativeControls();
  $('#generate-real-video')?.addEventListener('click',generateRealVideo);
  document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{active=b.dataset.go;render();});
  $('#new-chat')?.addEventListener('click',newChat);
  document.querySelectorAll('[data-open-chat]').forEach(b=>b.onclick=()=>openChat(b.dataset.openChat));
  document.querySelectorAll('[data-delete-chat]').forEach(b=>b.onclick=()=>deleteChat(b.dataset.deleteChat));
  document.querySelectorAll('[data-suggestion]').forEach(b=>b.onclick=()=>{const input=$('#chat-input');if(input){input.value=b.dataset.suggestion;input.focus();}});
  document.querySelectorAll('[data-copy-answer]').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.copyAnswer);b.textContent='Скопійовано';}catch{b.textContent='Не вдалося скопіювати';}});
  $('#open-voice-room')?.addEventListener('click',()=>{active='voice';render();});
  $('#chat-voice-mode')?.addEventListener('click',()=>{active='voice';render();});
  $('#voice-back')?.addEventListener('click',()=>{stopVoiceRoom();active='chat';render();});
  $('#voice-room-start')?.addEventListener('click',()=>{unlockNOVAVoice();if(!voiceInputSupported&&!nativeVoice()){setVoiceNotice('На цьому Android WebView голосове введення недоступне. Відкрий NOVA AI у Chrome.');return;}if(!voiceOutputSupported&&!nativeVoice()){setVoiceNotice('На цьому пристрої недоступне озвучення. Перевір налаштування синтезу мовлення Android.');return;}if(voiceConversationMode){if(!voiceListening&&!chatBusy)startVoiceInput();return;}voiceSessionId++;voiceConversationMode=true;voiceAutoSpeak=true;voiceSendAfterRecognition=true;store.set('nova-voice-conversation-mode',true);store.set('nova-voice-autospeak',true);store.set('nova-voice-send-after-recognition',true);render();startVoiceInput();});
  $('#voice-room-stop')?.addEventListener('click',()=>{stopVoiceRoom();render();});
  $('#voice-room-test')?.addEventListener('click',()=>{unlockNOVAVoice();speakNOVA('Привіт! Я NOVA. Тепер ми можемо розмовляти голосом.');});
  $('#voice-input')?.addEventListener('click',startVoiceInput);
  $('#voice-conversation')?.addEventListener('click',()=>{unlockNOVAVoice();voiceConversationMode=!voiceConversationMode;store.set('nova-voice-conversation-mode',voiceConversationMode);if(voiceConversationMode){voiceAutoSpeak=true;voiceSendAfterRecognition=true;store.set('nova-voice-autospeak',true);store.set('nova-voice-send-after-recognition',true);setVoiceNotice('Голосовий діалог увімкнено. Говори після сигналу.');startVoiceInput();}else{window.speechSynthesis?.cancel();setVoiceNotice('Голосовий діалог завершено.');}const b=$('#voice-conversation');if(b){b.textContent=voiceConversationMode?'■ Завершити діалог':'☎ Голосовий діалог';b.setAttribute('aria-pressed',String(voiceConversationMode));}});
  $('#voice-autospeak')?.addEventListener('change',event=>{voiceAutoSpeak=event.target.checked;store.set('nova-voice-autospeak',voiceAutoSpeak);});
  $('#voice-send-after-recognition')?.addEventListener('change',event=>{voiceSendAfterRecognition=event.target.checked;store.set('nova-voice-send-after-recognition',voiceSendAfterRecognition);});
  $('#voice-test')?.addEventListener('click',()=>{unlockNOVAVoice();speakNOVA('Привіт. Я NOVA. Голосовий канал працює.');});
  document.querySelectorAll('[data-speak-index]').forEach(button=>button.onclick=()=>speakNOVA(messages[Number(button.dataset.speakIndex)]?.text));
  $('#chat-input')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#chat-form')?.requestSubmit();}});
  $('#chat-form')?.addEventListener('submit',async e=>{e.preventDefault();const input=$('#chat-input'),text=input.value.trim();if(!text||chatBusy)return;learnAdultVocabulary(text);messages.push({role:'user',text});persistChat();await askNOVA(text);});
  $('#clear-chat')?.addEventListener('click',()=>{messages=[{...welcomeMessage}];persistChat();render();});
  $('#clear-persona')?.addEventListener('click',()=>{activeCharacter=null;store.set('nova-active-character',null);render();});
  document.querySelectorAll('[data-ratio]').forEach(b=>b.onclick=()=>{videoRatio=b.dataset.ratio;render();});
  document.querySelectorAll('[data-duration]').forEach(b=>b.onclick=()=>{videoDuration=b.dataset.duration;render();});
  document.querySelectorAll('[data-video-style]').forEach(b=>b.onclick=()=>{videoStyle=b.dataset.videoStyle;render();});
  document.querySelectorAll('[data-video-engine]').forEach(b=>b.onclick=()=>{videoEngine=b.dataset.videoEngine;store.set('nova-video-engine',videoEngine);render();});
  $('#video-prompt')?.addEventListener('input',e=>{videoPrompt=e.target.value;});
  $('#build-video-plan')?.addEventListener('click',()=>{videoPrompt=$('#video-prompt')?.value.trim()||'';if(!videoPrompt){$('#video-prompt')?.focus();return;}const cuts=Number(videoDuration)===5?[[0,2,'Встановчий кадр: покажи місце та атмосферу'],[2,4,'Головна дія: персонаж або об’єкт рухається'],[4,5,'Фінальний акцент: виразний завершальний образ']]:[[0,2,'Встановчий кадр: покажи локацію та атмосферу'],[2,6,'Основна дія: персонаж рухається, камера супроводжує'],[6,Number(videoDuration),'Фінальний акцент: завершальний кінематографічний образ']];videoStoryboard=cuts.map((s,i)=>`КАДР ${i+1} · ${s[0]}–${s[1]} с\n${s[2]}`).join('\n\n');render();});
  $('#copy-video-plan')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(videoStoryboard);const b=$('#copy-video-plan');if(b)b.textContent='✓ Скопійовано';}catch{}});
  document.querySelectorAll('[data-draft]').forEach(b=>b.onclick=async()=>{const text=$('#video-prompt')?.value.trim();if(!text)return;try{const {cloudWarning}=await saveDraft('video',text);b.textContent=cloudWarning?'✓ Збережено локально':'✓ Збережено до Library';}catch{b.textContent='⚠ Помилка збереження';}});
  $('#image-prompt')?.addEventListener('input',e=>{imagePrompt=e.target.value;});
  document.querySelectorAll('[data-image-builder]').forEach(input=>input.addEventListener('input',()=>{imageBuilder[input.dataset.imageBuilder]=input.value;}));
  $('#image-reference-file')?.addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{imageReference=await prepareReferenceImage(file);imageReferenceName=file.name;imageError='';render();}catch(error){imageError=error.message||'Не вдалося підготувати фото.';render();}});
  $('#clear-image-reference')?.addEventListener('click',()=>{imageReference='';imageReferenceName='';imageError='';render();});
  document.querySelectorAll('[data-presentation]').forEach(b=>b.onclick=()=>{imagePresentation=b.dataset.presentation;render();});
  $('#preserve-face')?.addEventListener('change',event=>{preserveFace=event.target.checked;});
  $('#image-strict-prompt')?.addEventListener('change',event=>{imageStrictPrompt=event.target.checked;store.set('nova-image-strict-prompt',imageStrictPrompt);});
  $('#image-seed')?.addEventListener('change',event=>{const seed=Number(event.target.value);if(Number.isInteger(seed)&&seed>=1&&seed<=9_999_999_999){imageSeed=seed;store.set('nova-image-seed',imageSeed);}else event.target.value=imageSeed;});
  $('#new-image-seed')?.addEventListener('click',()=>{imageSeed=Math.floor(Math.random()*9_999_999_999)+1;store.set('nova-image-seed',imageSeed);const input=$('#image-seed');if(input)input.value=imageSeed;});
  document.querySelectorAll('[data-prompt-chip]').forEach(b=>b.onclick=()=>{const input=$('#image-prompt');if(input){imagePrompt=(input.value.trim()+' '+b.dataset.promptChip).trim();input.value=imagePrompt;}});
  $('#generate-image')?.addEventListener('click',generateImage);
  $('#generate-adult-image')?.addEventListener('click',generateImage);
  $('#save-image-concept')?.addEventListener('click',async()=>{const text=imagePrompt.trim();if(text&&imageResult){try{const {cloudWarning}=await saveDraft('image',text,await compactImage(imageResult));imageError=cloudWarning||'Зображення та опис збережено до Library.';}catch(e){imageError=e.message;}render();}});
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{library.splice(+b.dataset.remove,1);store.set('nova-library',library);render();});
  $('#music-file')?.addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;if(!isSupportedAudio(file)){musicNotice='Обери аудіофайл.';render();return;}if(file.size>50*1024*1024){musicNotice='Файл більший за 50 МБ. Стисни його або вибери інший.';render();return;}try{musicNotice='Зчитую аудіофайл…';render();const duration=await audioDuration(file),id=globalThis.crypto?.randomUUID?.()||`track-${Date.now()}`;await audioStore.put(id,file);const track={id,name:file.name.replace(/\.[^.]+$/,''),duration,mime:file.type||'audio/unknown',instruments:'',url:URL.createObjectURL(file)};musicTracks.unshift(track);if(!store.set('nova-music-tracks',musicTracks.map(({url,...item})=>item))){musicTracks.shift();URL.revokeObjectURL(track.url);await audioStore.remove(id);throw new Error('Не вдалося зберегти каталог пісень у браузері.');}musicNotice='Пісню збережено локально. Додай або підтвердь інструменти після прослуховування.';render();}catch(error){musicNotice=error.message||'Не вдалося зберегти аудіофайл.';render();}});
  document.querySelectorAll('[data-check-track]').forEach(b=>b.onclick=()=>{const track=musicTracks.find(item=>item.id===b.dataset.checkTrack),input=document.querySelector(`[data-track-instruments="${b.dataset.checkTrack}"]`);if(!track)return;track.instruments=input?.value.trim()||'';store.set('nova-music-tracks',musicTracks.map(({url,...item})=>item));musicNotice=track.instruments?`Склад для «${track.name}» збережено: ${track.instruments}.`:'Прослухай трек і впиши інструменти для точного промпту. Автоматичного AI-розпізнавання тут немає.';render();});
  document.querySelectorAll('[data-prompt-track]').forEach(b=>b.onclick=()=>{const track=musicTracks.find(item=>item.id===b.dataset.promptTrack),input=document.querySelector(`[data-track-instruments="${b.dataset.promptTrack}"]`);if(!track)return;track.instruments=input?.value.trim()||track.instruments||'інструменти не вказані';store.set('nova-music-tracks',musicTracks.map(({url,...item})=>item));musicPrompt=`Створи оригінальну композицію, натхнену моїм завантаженим треком «${track.name}» (${formatDuration(track.duration)}). Інструментальний склад: ${track.instruments}. Передай подібний настрій, динаміку та енергію, але не копіюй мелодію, вокал, текст або впізнавані елементи оригіналу. Додай темну кінематографічну атмосферу NOVA AI.`;render();});
  document.querySelectorAll('[data-remove-track]').forEach(b=>b.onclick=async()=>{const track=musicTracks.find(item=>item.id===b.dataset.removeTrack);if(track){if(track.url)URL.revokeObjectURL(track.url);try{await audioStore.remove(track.id);}catch(error){console.warn('NOVA audio delete failed',error);}musicTracks=musicTracks.filter(item=>item.id!==track.id);store.set('nova-music-tracks',musicTracks.map(({url,...item})=>item));render();}});
  $('#copy-music-prompt')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(musicPrompt);const button=$('#copy-music-prompt');if(button)button.textContent='✓ Скопійовано';}catch{}});
  $('#enable-adult')?.addEventListener('click',()=>{adult=true;store.set('nova-adult',true);render();}); $('#disable-adult')?.addEventListener('click',()=>{adult=false;adultTone=false;adultLearning=false;store.set('nova-adult',false);store.set('nova-adult-tone',false);store.set('nova-adult-learning',false);render();});
  $('#adult-tone')?.addEventListener('change',event=>{adultTone=event.target.checked;if(!adultTone)adultLearning=false;store.set('nova-adult-tone',adultTone);store.set('nova-adult-learning',adultLearning);render();});
  $('#adult-learning')?.addEventListener('change',event=>{adultLearning=Boolean(adultTone&&event.target.checked);store.set('nova-adult-learning',adultLearning);render();});
  $('#clear-adult-vocabulary')?.addEventListener('click',()=>{adultVocabulary=[];store.set('nova-adult-vocabulary',adultVocabulary);render();});
  $('#work-files')?.addEventListener('change',event=>{workFiles=Array.from(event.target.files||[]).map(file=>({name:file.name,type:file.type,size:file.size}));workStatus=workFiles.length?`${workFiles.length} файл(и) обрано. Їхній вміст не завантажувався.`:'Файли не обрано.';render();});
  $('#choose-work-folder')?.addEventListener('click',async()=>{if(!window.showDirectoryPicker){workStatus='Цей браузер не підтримує вибір папки. Можна завантажити план на пристрій.';render();return;}try{workDirectory=await window.showDirectoryPicker({mode:'readwrite'});workStatus=`Обрано папку «${workDirectory.name}». NOVA ще нічого в ній не змінювала.`;}catch{workStatus='Папку не обрано.';}render();});
  $('#create-work-plan')?.addEventListener('click',createWorkPlan);
  $('#download-work-plan')?.addEventListener('click',downloadWorkPlan);
  $('#save-work-plan')?.addEventListener('click',saveWorkPlan);
  document.querySelectorAll('[data-character]').forEach(b=>b.onclick=()=>{activeCharacter={name:b.dataset.character,description:b.dataset.intro};store.set('nova-active-character',activeCharacter);active='chat';messages.push({role:'nova',text:`Зв’язок із ${b.dataset.character} встановлено. ${b.dataset.intro}`});persistChat();render();});
  document.querySelectorAll('[data-custom-character]').forEach(b=>{const activate=()=>{activeCharacter={name:b.dataset.customCharacter,description:b.dataset.intro};store.set('nova-active-character',activeCharacter);active='chat';messages.push({role:'nova',text:`Зв’язок встановлено. ${b.dataset.customCharacter} готовий до розмови.`});persistChat();render();};b.onclick=activate;b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}};});
  document.querySelectorAll('[data-delete-character]').forEach(b=>b.onclick=e=>{e.stopPropagation();customCharacters=customCharacters.filter(x=>String(x.id)!==String(b.dataset.deleteCharacter));store.set('nova-characters',customCharacters);render();});
  $('#new-character')?.addEventListener('click',()=>{const host=$('#character-create');host.innerHTML=`<form class="studio-card character-form" id="character-form"><h3>Створити персонажа</h3><label>Ім’я<input id="character-name" maxlength="32" placeholder="Ім’я" required></label><label>Характер та вступ<textarea id="character-description" maxlength="1800" placeholder="Хто він/вона і з чого починає розмову..." required></textarea></label><p class="notice" id="character-save-status" role="status"></p><button class="primary" type="submit">Створити</button></form>`;$('#character-form').addEventListener('submit',e=>{e.preventDefault();const name=$('#character-name').value.trim(),description=$('#character-description').value.trim(),status=$('#character-save-status');if(!name||!description){status.textContent='Заповни ім’я та опис персонажа.';return;}const id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;customCharacters=[{id,name,description},...customCharacters];if(store.set('nova-characters',customCharacters)){characterNotice='Персонажа збережено на цьому пристрої.';render();}else status.textContent='Не вдалося зберегти персонажа.';});});
  $('#open-auth')?.addEventListener('click',()=>{$('#app').insertAdjacentHTML('beforeend',authModal());bindAuth();});
  $('#open-settings')?.addEventListener('click',()=>{$('#app').insertAdjacentHTML('beforeend',authModal());bindAuth();});
}
function bindAuth(){ $('#close-auth')?.addEventListener('click',()=>$('.modal-backdrop')?.remove()); document.querySelectorAll('[data-auth-mode]').forEach(button=>button.addEventListener('click',()=>{authMode=button.dataset.authMode;authNotice='';$('.modal-backdrop')?.remove();$('#app').insertAdjacentHTML('beforeend',authModal());bindAuth();})); $('#sign-out')?.addEventListener('click',async()=>{const {error}=await supabase?.auth.signOut();if(error){authNotice=error.message;render();return;}session=null;render();}); $('#auth-form')?.addEventListener('submit',async e=>{e.preventDefault();const email=$('#auth-email')?.value.trim(),password=$('#auth-password')?.value,confirm=$('#auth-password-confirm')?.value;const form=$('#auth-form');const button=form?.querySelector('button');if(authMode==='register'&&password!==confirm){authNotice='Паролі не збігаються.';render();return;}if(button)button.disabled=true;const result=authMode==='register'?await supabase.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin}}):await supabase.auth.signInWithPassword({email,password});if(result.error){authNotice=result.error.message;render();return;}session=result.data.session;if(!session){authNotice=authMode==='register'?'Лист для підтвердження надіслано. Підтвердь email, потім увійди.':'Потрібне підтвердження email. Перевір пошту та увійди повторно.';authMode='login';$('.modal-backdrop')?.remove();$('#app').insertAdjacentHTML('beforeend',authModal());bindAuth();return;}authNotice='';await loadCloudLibrary();render();});}
async function initializeCloud(){if(!supabase)return;const {data}=await supabase.auth.getSession();session=data.session;if(session)await loadCloudLibrary();supabase.auth.onAuthStateChange(async(_event,next)=>{session=next;if(session)await loadCloudLibrary();render();});}
await initializeCloud();
loadDesktopApplications();
render();
hydrateMusicTracks();
if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
