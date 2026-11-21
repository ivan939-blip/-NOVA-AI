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
let session = null;
let authNotice = '';
let chatBusy = false;
let imageBusy = false;
let imageResult = '';
let imageError = '';
let imagePrompt = '';
let imageReference = '';
let imageReferenceName = '';
let imagePresentation = 'unspecified';
let preserveFace = true;
let customCharacters = store.get('nova-characters', []);
let characterNotice = '';
let activeCharacter = store.get('nova-active-character', null);
let videoPrompt = '';
let videoDuration = '8';
let videoRatio = '9:16';
let videoStyle = 'dark cinematic';
let videoStoryboard = '';
let videoBusy = false;
let videoStatus = '';
let videoUrl = '';
let videoError = '';
let musicTracks = store.get('nova-music-tracks', []);
let musicNotice = '';
let musicPrompt = '';
const localVideoApi = (import.meta.env.VITE_LOCAL_VIDEO_API_URL || '').replace(/\/$/, '');

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
function persistChat() { const chat=conversations.find(item=>item.id===activeConversationId); if(chat){ chat.messages=messages; chat.title=chatTitle(chat); chat.updatedAt=Date.now(); } conversations.sort((a,b)=>b.updatedAt-a.updatedAt); store.set('nova-conversations',conversations); store.set('nova-active-conversation',activeConversationId); store.set('nova-messages',messages); }
function newChat() { const id=globalThis.crypto?.randomUUID?.() || `nova-${Date.now()}`; const chat={id,title:'Нова розмова',messages:[{...welcomeMessage}],updatedAt:Date.now()}; conversations.unshift(chat); activeConversationId=id; messages=chat.messages; active='chat'; persistChat(); render(); }
function openChat(id) { const chat=conversations.find(item=>item.id===id); if(!chat)return; activeConversationId=id; messages=chat.messages; active='chat'; store.set('nova-active-conversation',id); render(); }
function deleteChat(id) { conversations=conversations.filter(chat=>chat.id!==id); if(!conversations.length){ const replacement={id:`nova-${Date.now()}`,title:'Нова розмова',messages:[{...welcomeMessage}],updatedAt:Date.now()}; conversations=[replacement]; } if(id===activeConversationId){ activeConversationId=conversations[0].id; messages=conversations[0].messages; } persistChat(); render(); }
function icon(n) { return ({home:'⌂',chat:'◈',image:'◇',video:'▷',music:'♫',characters:'♙',library:'▣',adult:'18+'})[n]; }
function navItem(id, label) { return `<button class="nav-item ${active===id?'active':''}" data-go="${id}"><span>${icon(id)}</span><small>${label}</small></button>`; }
function hero() { return `<section class="hero home-hero"><img class="heroine-art" src="${import.meta.env.BASE_URL}nova-heroine.png" alt="Готична героїня NOVA AI"/><div class="hero-scrim"></div><button class="menu-mark" data-go="home" aria-label="Головна">☰</button><div class="hero-logo"><b>NOVA AI<span>✦</span></b><small>Your AI. Your world.</small></div><button class="crown-mark" data-go="adult" aria-label="18+ Mode">♛</button><button class="avatar-mark" id="open-auth" aria-label="Профіль">●</button><div class="free-panel"><b>∞</b><strong>Безкоштовно<br>Назавжди</strong><small>✓ Без лімітів<br>✓ Без підписок<br>✓ Без карток</small></div></section>`; }
function homeCard(id, iconText, title, subtitle){return `<button class="home-card" data-go="${id}"><span>${iconText}</span><b>${title}</b><small>${subtitle}</small></button>`;}
function home(){return `<section class="screen home-screen">${hero()}<button class="home-prompt" data-go="chat"><span>✦</span><div><b>Що ти хочеш створити?</b><small>Запитай мене або обери розділ...</small></div><i>↑</i></button><div class="home-grid">${homeCard('image','▧','Image Studio','Створи зображення')}${homeCard('video','▶','Video Studio','Створи відео')}${homeCard('characters','♙','Characters','Твої персонажі')}${homeCard('chat','◈','AI Chat','Спілкуйся зі мною')}${homeCard('library','▣','My Library','Твоя бібліотека')}${homeCard('adult','18+','18+ Mode','Для дорослих')}</div></section>`; }
function chat() { const onlyWelcome=messages.length===1&&messages[0].role==='nova'; return `<section class="screen chat-screen">${activeCharacter?`<div class="active-persona">✧ ${esc(activeCharacter.name)} <button id="clear-persona">×</button></div>`:''}<div class="chat-topbar"><div><span>NEURAL CHANNEL · ${chatBusy ? 'CONNECTING' : 'ONLINE'}</span><h2>${esc(chatTitle(conversations.find(c=>c.id===activeConversationId)||{}))}</h2></div><button class="round" id="clear-chat" aria-label="Очистити чат">↻</button></div><div class="messages">${messages.map(m=>`<article class="message ${m.role}"><div class="message-avatar">${m.role==='user'?'YOU':'N'}</div><div class="message-body"><b>${m.role==='user'?'Ти':'NOVA'}</b><p>${esc(m.text)}</p>${m.role==='nova'&&m.text!==welcomeMessage.text?'<button class="copy-answer" type="button" data-copy-answer="'+esc(m.text)+'">Копіювати</button>':''}</div></article>`).join('')}${onlyWelcome?`<div class="prompt-grid"><button data-suggestion="Допоможи написати сильний промпт для Image Studio">✦ Створити образ</button><button data-suggestion="Запропонуй концепцію короткого темного відео">▷ Спланувати відео</button><button data-suggestion="Допоможи з ідеєю для мого проєкту">◈ Обміркувати ідею</button></div>`:''}</div><form class="composer" id="chat-form"><textarea id="chat-input" rows="1" maxlength="4000" ${chatBusy?'disabled':''} placeholder="Напиши NOVA..." autocomplete="off"></textarea><button ${chatBusy?'disabled':''} aria-label="Надіслати">${chatBusy?'…':'↑'}</button></form><p class="composer-note">NOVA може помилятися. Перевіряй важливу інформацію.</p></section>`; }
function imageStudio() { return `<section class="screen"><div class="page-head"><span>01 // VISUAL FORGE</span><h2>Image Studio</h2><p>Створи кінематографічний образ із текстового опису або власного фото.</p></div><div class="studio-card image-card"><div class="fake-art">✦<small>GENERATION CORE</small></div><label class="image-picker">▧ Додати фото або зображення<input id="image-reference-file" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>${imageReference?`<div class="reference-preview"><img src="${imageReference}" alt="Твоє фото-референс"/><div><b>${esc(imageReferenceName)}</b><small>Фото буде стиснено до 512 px і надіслано лише для цієї генерації.</small></div><button class="icon-button" id="clear-image-reference" aria-label="Прибрати фото">×</button></div><div class="identity-controls"><b>Людина на фото</b><div class="chips"><button type="button" data-presentation="feminine" class="${imagePresentation==='feminine'?'selected':''}">Жіночий образ</button><button type="button" data-presentation="masculine" class="${imagePresentation==='masculine'?'selected':''}">Чоловічий образ</button><button type="button" data-presentation="unspecified" class="${imagePresentation==='unspecified'?'selected':''}">Не вказувати</button></div><label class="identity-toggle"><input id="preserve-face" type="checkbox" ${preserveFace?'checked':''}> Зберігати ключові риси обличчя</label><small>Це вибір користувача, не автоматичне визначення за фото. Генеративна модель може трохи змінити риси.</small></div>`:`<p class="notice">JPEG, PNG або WebP до 5 МБ. Фото не зберігається NOVA після запиту.</p>`}<label>Твій промпт<textarea id="image-prompt" maxlength="1800" placeholder="Наприклад: перетвори фото на готичний неоновий портрет...">${esc(imagePrompt)}</textarea></label><div class="chips"><button type="button" data-prompt-chip="dark gothic cyberpunk">Cyberpunk</button><button type="button" data-prompt-chip="gothic dark fantasy">Gothic</button><button type="button" data-prompt-chip="cinematic portrait">Portrait</button></div><button class="primary" id="generate-image" ${imageBusy?'disabled':''}>${imageBusy?'⟳ Генерую...':imageReference?'✦ Генерувати за фото':'✦ Створити зображення'}</button>${imageError?'<p class="image-error">'+esc(imageError)+'</p>':''}${imageResult?'<div class="generated-image"><img src="'+imageResult+'" alt="Згенероване NOVA зображення"/><a class="secondary download-image" download="nova-ai-image.jpg" href="'+imageResult+'">↓ Завантажити на пристрій</a><button class="secondary" id="save-image-concept">Зберегти опис до Library</button></div>':''}</div><p class="notice">Без фото використовується FLUX Schnell. Із фото — FLUX.2 reference generation; доступність залежить від лімітів Workers AI.</p></section>`; }
function videoStudio() { return `<section class="screen"><div class="page-head"><span>02 // MOTION VOID</span><h2>Video Studio</h2><p>Підготуй сценарій, кадри та промпт без платних сервісів.</p></div><div class="studio-card"><div class="video-preview"><span>▶</span><i>00:${videoDuration.padStart(2,'0')}</i></div><label>Ідея відео<textarea id="video-prompt" maxlength="1800" placeholder="Наприклад: героїня йде крізь неоновий дощ, камера повільно наближається...">${esc(videoPrompt)}</textarea></label><label class="video-field-label">Стиль</label><div class="chips video-styles"><button type="button" data-video-style="dark cinematic" class="${videoStyle==='dark cinematic'?'selected':''}">Cinematic</button><button type="button" data-video-style="gothic fantasy" class="${videoStyle==='gothic fantasy'?'selected':''}">Gothic</button><button type="button" data-video-style="neon cyberpunk" class="${videoStyle==='neon cyberpunk'?'selected':''}">Cyberpunk</button></div><label class="video-field-label">Тривалість</label><div class="options"><button type="button" data-duration="5" class="${videoDuration==='5'?'selected':''}">5 с</button><button type="button" data-duration="8" class="${videoDuration==='8'?'selected':''}">8 с</button><button type="button" data-duration="12" class="${videoDuration==='12'?'selected':''}">12 с</button></div><label class="video-field-label">Формат кадру</label><div class="options"><button type="button" data-ratio="9:16" class="${videoRatio==='9:16'?'selected':''}">9:16</button><button type="button" data-ratio="16:9" class="${videoRatio==='16:9'?'selected':''}">16:9</button><button type="button" data-ratio="1:1" class="${videoRatio==='1:1'?'selected':''}">1:1</button></div><button class="secondary" id="build-video-plan" type="button">✦ Створити розкадрування</button>${videoStoryboard?`<div class="video-storyboard"><b>ТВОЯ РОЗКАДРОВКА</b><p>${esc(videoStoryboard).replace(/\n/g,'<br>')}</p><button class="secondary" id="copy-video-plan" type="button">Копіювати готовий промпт</button></div>`:''}<button class="primary" data-draft="video">▷ Зберегти сценарій до Library</button><button class="primary" id="generate-real-video" type="button" ${videoBusy?"disabled":""}>${videoBusy?"⟳ Створюю відео...":"✦ Створити безкоштовне відео"}</button><div class="video-job-status" role="status">${esc(videoStatus||videoError)}</div>${videoUrl?'<video class="generated-video" controls playsinline src="'+esc(videoUrl)+'"></video><a href="'+esc(videoUrl)+'" target="_blank" rel="noopener">Відкрити відеофайл</a>':''}</div><p class="notice">Локальний Motion Forge · рух камери, неоновий стиль і ambient-аудіо без ключів, лімітів та підписок.</p></section>`; }
function musicLab(){return `<section class="screen"><div class="page-head"><span>03 // SOUND VAULT</span><h2>Music Lab</h2><p>Твої аудіофайли залишаються у сховищі цього браузера — вони не надсилаються на сервер.</p></div><div class="studio-card music-upload"><label class="audio-picker">♫ Завантажити пісню<input id="music-file" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac" hidden></label><p class="notice" role="status">${esc(musicNotice || 'Підтримуються аудіофайли до 50 МБ.')}</p></div><div class="music-list">${musicTracks.length?musicTracks.map(track=>`<article class="track-card"><div><b>${esc(track.name)}</b><small>${formatDuration(track.duration)} · ${esc(track.mime||'audio')}</small></div>${track.url?`<audio controls preload="metadata" src="${esc(track.url)}"></audio>`:'<p class="notice">Відкрий файл повторно, якщо браузер очистив локальне аудіосховище.</p>'}<label>Інструменти — вкажи або підтвердь після прослуховування<input data-track-instruments="${esc(track.id)}" value="${esc(track.instruments||'')}" placeholder="Наприклад: синтезатор, бас, ударні"></label><div class="track-actions"><button class="secondary" data-check-track="${esc(track.id)}">Перевірити склад</button><button class="primary" data-prompt-track="${esc(track.id)}">Створити промпт</button><button class="icon-button" data-remove-track="${esc(track.id)}" aria-label="Видалити пісню">×</button></div></article>`).join(''):`<div class="empty"><span>♫</span><h3>Додай першу пісню</h3><p>Після завантаження NOVA збереже файл локально та допоможе сформувати промпт.</p></div>`}</div>${musicPrompt?`<div class="studio-card music-result"><b>ГОТОВИЙ МУЗИЧНИЙ ПРОМПТ</b><p>${esc(musicPrompt)}</p><button class="secondary" id="copy-music-prompt">Копіювати промпт</button></div>`:''}</section>`;}
function characters() { const chars=[['NYX','Темна провидиця'],['VEX','Неоновий бунтар'],['LUNA','Синтетична муза']]; return `<section class="screen"><div class="page-head"><span>03 // SOUL ARCHIVE</span><h2>Characters</h2><p>Обери співрозмовника або створи власного.</p></div>${characterNotice?`<p class="notice" role="status">${esc(characterNotice)}</p>`:'' }<div class="character-grid">${chars.map((c,i)=>`<button class="character" data-character="${c[0]}" data-intro="${c[1]}"><div class="avatar a${i}"><span>◉</span></div><b>${c[0]}</b><small>${c[1]}</small></button>`).join('')}${customCharacters.map(c=>`<div class="character" role="button" tabindex="0" data-custom-character="${esc(c.name)}" data-intro="${esc(c.description)}"><div class="avatar"><span>✧</span></div><b>${esc(c.name)}</b><small>${esc(c.description)}</small><button type="button" class="delete-character" aria-label="Видалити персонажа" data-delete-character="${esc(c.id)}">×</button></div>`).join('')}<button class="character new" id="new-character"><div class="avatar">＋</div><b>NEW SOUL</b><small>Новий персонаж</small></button></div><div id="character-create"></div></section>`; }
function libraryView() { return `<section class="screen"><div class="page-head"><span>04 // MEMORY VAULT</span><h2>My Library</h2><p>${session ? 'Збережено на цьому пристрої; синхронізація текстів доступна.' : 'Збереження на цьому пристрої.'}</p><button class="secondary library-music-link" data-go="music">♫ Music Lab</button></div><div class="library">${library.length?library.map((x,i)=>`<article class="saved">${x.image?'<img class="library-thumb" src="'+x.image+'" alt="Збережене зображення"/>':'<div class="saved-icon">'+(x.type==='image'?'✦':'▷')+'</div>'}<div><small>${x.type==='image'?'IMAGE':'VIDEO IDEA'} · ${x.date}</small><p>${esc(x.text)}</p></div><button data-remove="${i}" aria-label="Видалити">×</button></article>`).join(''):`<div class="empty"><span>▣</span><h3>Тут поки тихо</h3><p>Збережені з Image та Video Studio з’являться тут.</p></div>`}</div></section>`; }
function adultView() { return `<section class="screen adult"><div class="adult-mark">18<span>+</span></div><div class="page-head"><span>05 // PRIVATE CHAMBER</span><h2>18+ Mode</h2><p>${adult?'Приватний режим увімкнено на цьому пристрої.':'Цей простір призначений лише для повнолітніх.'}</p></div>${adult?`<div class="studio-card"><h3>Приватний простір готовий</h3><p>Підключення дорослих AI-функцій потребуватиме окремого безпечного бекенду та перевірок політик.</p><button class="secondary" id="disable-adult">Вимкнути режим</button></div>`:`<div class="studio-card"><h3>Підтвердження віку</h3><p>Підтверджую, що мені виповнилося 18 років.</p><button class="primary" id="enable-adult">Мені 18+</button></div>`}</section>`; }
function content(){ return ({home,chat,image:imageStudio,video:videoStudio,music:musicLab,characters,library:libraryView,adult:adultView})[active](); }
function authModal(){return `<div class="modal-backdrop"><section class="auth-modal"><button class="modal-close" id="close-auth">×</button><span class="eyebrow">NOVA IDENTITY</span><h2>${session ? 'Твій профіль' : 'Увійти до NOVA'}</h2>${session?`<p>${esc(session.user.email)}</p><button class="secondary" id="sign-out">Вийти</button>`:isCloudReady?`<p>Увійди або створи акаунт, щоб синхронізувати бібліотеку.</p><form id="auth-form"><input type="email" id="auth-email" placeholder="Email" required/><input type="password" id="auth-password" placeholder="Пароль (мін. 6 символів)" minlength="6" required/><button class="primary">Продовжити</button></form><p class="notice">${authNotice || 'Новий email автоматично отримає посилання для підтвердження.'}</p>`:`<p>Хмарний обліковий запис ще не налаштований для цього deployment.</p><p class="notice">Хмарний вхід запрацює після підключення безкоштовного проєкту Supabase.</p>`}</section></div>`;}
function workspaceSidebar(){return `<aside class="workspace-sidebar"><button class="nova-brand" data-go="home"><span>✦</span> NOVA <i>AI</i></button><button class="new-chat" id="new-chat">＋ Нова розмова</button><div class="sidebar-section"><small>РОЗМОВИ</small><div class="conversation-list">${conversations.map(chat=>`<div class="conversation ${chat.id===activeConversationId?'selected':''}"><button data-open-chat="${esc(chat.id)}">${esc(chatTitle(chat))}</button><button class="conversation-delete" data-delete-chat="${esc(chat.id)}" aria-label="Видалити розмову">×</button></div>`).join('')}</div></div><div class="sidebar-tools"><button data-go="image">◇ Image Studio</button><button data-go="video">▷ Video Studio</button><button data-go="music">♫ Music Lab</button><button data-go="characters">♙ Characters</button><button data-go="library">▣ My Library</button></div><button class="sidebar-account" id="open-auth">${session?'● '+esc(session.user.email):'○ Увійти до NOVA'}</button></aside>`;}
function render(){ const hadAuth=Boolean($('.modal-backdrop')); $('#app').innerHTML=`<main class="app-shell">${workspaceSidebar()}<div class="app-content">${content()}</div><nav>${navItem('home','Головна')}${navItem('image','Галерея')}${navItem('chat','Історія')}${navItem('library','Вибране')}<button class="nav-item" id="open-settings"><span>⚙</span><small>Налаштування</small></button></nav></main>`; bind(); if(hadAuth&&!session){$('#app').insertAdjacentHTML('beforeend',authModal());bindAuth();} }
async function generateImage(){
  const prompt=$('#image-prompt')?.value.trim();
  if(!prompt||imageBusy)return;
  if (location.hostname.endsWith('github.io')) { imageError='GitHub Pages не підтримує Cloudflare Workers AI API. Для генерації відкрий Cloudflare Pages версію NOVA AI.'; render(); return; }
  imagePrompt=prompt;imageBusy=true;imageError='';imageResult='';render();
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),120000);
  try{
    const res=await fetch(`${import.meta.env.BASE_URL}api/image`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt,referenceImage:imageReference||undefined,presentation:imagePresentation,preserveFace}),signal:controller.signal
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||data.code||'Сервер не повернув зображення.');
    if(typeof data.image!=='string'||!data.image.startsWith('data:image/'))throw new Error('Сервер повернув некоректне зображення.');
    imageResult=data.image;
  }catch(e){
    imageError=e.name==='AbortError'?'Генерація перевищила 2 хвилини. Спробуй коротший опис або повтори пізніше.':e.message||'Не вдалося згенерувати зображення.';
  }finally{clearTimeout(timeout);imageBusy=false;render();}
}
async function askNOVA(text) {
  if (location.hostname.endsWith('github.io')) { messages.push({role:'nova',text:'AI Chat потребує Cloudflare Workers AI. Відкрий NOVA AI на Cloudflare Pages, оскільки GitHub Pages не виконує /api/chat.'});persistChat();render();return; }
  chatBusy=true;
  render();
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),90000);
  let reply=null;
  try {
    const history=messages
      .filter((m,i)=>!(i===0&&m.role==='nova')&&!(i===messages.length-1&&m.role==='user'&&m.text===text))
      .map(m=>({role:m.role==='nova'?'assistant':'user',content:m.text}));
    const result=await fetch(`${import.meta.env.BASE_URL}api/chat`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({messages:[...history,{role:'user',content:text}],persona:activeCharacter}),
      signal:controller.signal
    });

    if(!result.ok) {
      const raw=await result.text();
      let data;
      try { data=JSON.parse(raw); } catch { data={error:raw}; }
      throw new Error(`${data.code || `HTTP_${result.status}`}: ${data.error || 'Сервер не повернув відповідь.'}`);
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
        if(replyEl) { const body=replyEl.querySelector('.message-body p'); if(body) body.textContent=reply.text; }
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

      while(true) {
        const {value,done}=await reader.read();
        if(done) break;
        buffer+=decoder.decode(value,{stream:true});
        const events=buffer.split(/\r?\n\r?\n/);
        buffer=events.pop() || '';
        events.forEach(parseEvent);
      }
      buffer+=decoder.decode();
      if(buffer.trim()) parseEvent(buffer);
      if(!reply.text.trim()) reply.text='Модель завершила запит, але не надіслала текстових фрагментів.';
    } else {
      const data=await result.json();
      if(!data.answer) throw new Error(data.error || 'Сервер не повернув текст відповіді.');
      messages.push({role:'nova',text:data.answer});
    }
  } catch(error) {
    const detail=error?.name==='AbortError'
      ? 'Час очікування вичерпано (90 секунд). Потік AI-сервера не завершився.'
      : error?.message?.includes('Failed to fetch')
        ? 'Не вдалося з’єднатися з /api/chat. Перевір інтернет і адресу розгортання.'
        : `Помилка AI: ${error?.message || 'невідома помилка'}`;
    if(reply) reply.text=reply.text ? `${reply.text}\n\nДІАГНОСТИКА: ${detail}` : `ДІАГНОСТИКА: ${detail}`;
    else messages.push({role:'nova',text:`ДІАГНОСТИКА: FRONTEND_REQUEST_FAILED. ${detail}`});
  } finally {
    clearTimeout(timeout);
    chatBusy=false;
    persistChat();
    render();
  }
}
async function compactImage(dataUrl){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const canvas=document.createElement('canvas');const max=768,scale=Math.min(1,max/Math.max(img.width,img.height));canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',0.78));};img.onerror=()=>reject(new Error('Не вдалося підготувати зображення для збереження.'));img.src=dataUrl;});}
async function prepareReferenceImage(file){if(!file?.type.match(/^image\/(jpeg|png|webp)$/))throw new Error('Обери JPEG, PNG або WebP.');if(file.size>5*1024*1024)throw new Error('Фото має бути до 5 МБ.');const raw=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Не вдалося прочитати фото.'));reader.readAsDataURL(file);});return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const scale=Math.min(1,512/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',0.84));};img.onerror=()=>reject(new Error('Браузер не зміг підготувати фото.'));img.src=raw;});}
async function saveDraft(type, text, image='') { const item={type,text,image,date:new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'short'}).format(new Date())}; library.unshift(item);if(!store.set('nova-library',library)){library.shift();throw new Error('Бібліотека пристрою переповнена. Видали старі записи й повтори.');}let cloudWarning='';if(session&&supabase&&!image){const {data,error}=await supabase.from('library_items').insert({user_id:session.user.id,type,prompt:text}).select('id').single();if(error){item.cloudError=true;store.set('nova-library',library);cloudWarning='Збережено лише на цьому пристрої: хмарна синхронізація не вдалася.';}if(data?.id){item.cloudId=data.id;store.set('nova-library',library);}}return {cloudWarning};}
async function loadCloudLibrary(){if(!session||!supabase)return;const {data,error}=await supabase.from('library_items').select('id,type,prompt,created_at').order('created_at',{ascending:false});if(error){console.error('Cloud library load failed',error);return;}if(data){const fmt=d=>new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'short'}).format(new Date(d));const localImages=library.filter(x=>x.image);const cloudItems=data.map(x=>({type:x.type,text:x.prompt,date:fmt(x.created_at),cloud:true,cloudId:x.id}));const unsynced=library.filter(x=>!x.image&&!x.cloud&&!data.some(y=>y.prompt===x.text&&y.type===x.type));library=[...localImages,...unsynced,...cloudItems];try{store.set('nova-library',library);}catch(e){console.warn('Library local cache limit',e);}}}
async function generateRealVideo() {
  const prompt = $('#video-prompt')?.value.trim();
  if (!prompt || videoBusy) return;
  if (!localVideoApi) { videoError = 'Генерація відео потребує налаштованого VITE_LOCAL_VIDEO_API_URL та доступного відеосервера. Розкадрування й збереження сценарію працюють без сервера.'; videoStatus = ''; render(); return; }
  videoPrompt = prompt; videoBusy = true; videoStatus = 'Надсилаю запит...'; videoError = ''; videoUrl = ''; render();
  try {
    const res = await fetch(localVideoApi, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({prompt:prompt+' Style: '+videoStyle+'. Cinematic camera movement.',seconds:Math.max(4,Math.min(12,Number(videoDuration)||5)),aspect_ratio:videoRatio,image:imageResult||undefined}) });
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
function bind(){
  $('#generate-real-video')?.addEventListener('click',generateRealVideo);
  document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{active=b.dataset.go;render();});
  $('#new-chat')?.addEventListener('click',newChat);
  document.querySelectorAll('[data-open-chat]').forEach(b=>b.onclick=()=>openChat(b.dataset.openChat));
  document.querySelectorAll('[data-delete-chat]').forEach(b=>b.onclick=()=>deleteChat(b.dataset.deleteChat));
  document.querySelectorAll('[data-suggestion]').forEach(b=>b.onclick=()=>{const input=$('#chat-input');if(input){input.value=b.dataset.suggestion;input.focus();}});
  document.querySelectorAll('[data-copy-answer]').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.copyAnswer);b.textContent='Скопійовано';}catch{b.textContent='Не вдалося скопіювати';}});
  $('#chat-input')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#chat-form')?.requestSubmit();}});
  $('#chat-form')?.addEventListener('submit',async e=>{e.preventDefault();const input=$('#chat-input'),text=input.value.trim();if(!text||chatBusy)return;messages.push({role:'user',text});persistChat();await askNOVA(text);});
  $('#clear-chat')?.addEventListener('click',()=>{messages=[{...welcomeMessage}];persistChat();render();});
  $('#clear-persona')?.addEventListener('click',()=>{activeCharacter=null;store.set('nova-active-character',null);render();});
  document.querySelectorAll('[data-ratio]').forEach(b=>b.onclick=()=>{videoRatio=b.dataset.ratio;render();});
  document.querySelectorAll('[data-duration]').forEach(b=>b.onclick=()=>{videoDuration=b.dataset.duration;render();});
  document.querySelectorAll('[data-video-style]').forEach(b=>b.onclick=()=>{videoStyle=b.dataset.videoStyle;render();});
  $('#video-prompt')?.addEventListener('input',e=>{videoPrompt=e.target.value;});
  $('#build-video-plan')?.addEventListener('click',()=>{videoPrompt=$('#video-prompt')?.value.trim()||'';if(!videoPrompt){$('#video-prompt')?.focus();return;}const cuts=Number(videoDuration)===5?[[0,2,'Встановчий кадр: покажи місце та атмосферу'],[2,4,'Головна дія: персонаж або об’єкт рухається'],[4,5,'Фінальний акцент: виразний завершальний образ']]:[[0,2,'Встановчий кадр: покажи локацію та атмосферу'],[2,6,'Основна дія: персонаж рухається, камера супроводжує'],[6,Number(videoDuration),'Фінальний акцент: завершальний кінематографічний образ']];videoStoryboard=cuts.map((s,i)=>`КАДР ${i+1} · ${s[0]}–${s[1]} с\n${s[2]}`).join('\n\n');render();});
  $('#copy-video-plan')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(videoStoryboard);const b=$('#copy-video-plan');if(b)b.textContent='✓ Скопійовано';}catch{}});
  document.querySelectorAll('[data-draft]').forEach(b=>b.onclick=async()=>{const text=$('#video-prompt')?.value.trim();if(!text)return;try{const {cloudWarning}=await saveDraft('video',text);b.textContent=cloudWarning?'✓ Збережено локально':'✓ Збережено до Library';}catch{b.textContent='⚠ Помилка збереження';}});
  $('#image-prompt')?.addEventListener('input',e=>{imagePrompt=e.target.value;});
  $('#image-reference-file')?.addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{imageReference=await prepareReferenceImage(file);imageReferenceName=file.name;imageError='';render();}catch(error){imageError=error.message||'Не вдалося підготувати фото.';render();}});
  $('#clear-image-reference')?.addEventListener('click',()=>{imageReference='';imageReferenceName='';imageError='';render();});
  document.querySelectorAll('[data-presentation]').forEach(b=>b.onclick=()=>{imagePresentation=b.dataset.presentation;render();});
  $('#preserve-face')?.addEventListener('change',event=>{preserveFace=event.target.checked;});
  document.querySelectorAll('[data-prompt-chip]').forEach(b=>b.onclick=()=>{const input=$('#image-prompt');if(input){imagePrompt=(input.value.trim()+' '+b.dataset.promptChip).trim();input.value=imagePrompt;}});
  $('#generate-image')?.addEventListener('click',generateImage);
  $('#save-image-concept')?.addEventListener('click',async()=>{const text=imagePrompt.trim();if(text&&imageResult){try{const {cloudWarning}=await saveDraft('image',text,await compactImage(imageResult));imageError=cloudWarning||'Зображення та опис збережено до Library.';}catch(e){imageError=e.message;}render();}});
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{library.splice(+b.dataset.remove,1);store.set('nova-library',library);render();});
  $('#music-file')?.addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;if(!isSupportedAudio(file)){musicNotice='Обери аудіофайл.';render();return;}if(file.size>50*1024*1024){musicNotice='Файл більший за 50 МБ. Стисни його або вибери інший.';render();return;}try{musicNotice='Зчитую аудіофайл…';render();const duration=await audioDuration(file),id=globalThis.crypto?.randomUUID?.()||`track-${Date.now()}`;await audioStore.put(id,file);const track={id,name:file.name.replace(/\.[^.]+$/,''),duration,mime:file.type||'audio/unknown',instruments:'',url:URL.createObjectURL(file)};musicTracks.unshift(track);if(!store.set('nova-music-tracks',musicTracks.map(({url,...item})=>item))){musicTracks.shift();URL.revokeObjectURL(track.url);await audioStore.remove(id);throw new Error('Не вдалося зберегти каталог пісень у браузері.');}musicNotice='Пісню збережено локально. Додай або підтвердь інструменти після прослуховування.';render();}catch(error){musicNotice=error.message||'Не вдалося зберегти аудіофайл.';render();}});
  document.querySelectorAll('[data-check-track]').forEach(b=>b.onclick=()=>{const track=musicTracks.find(item=>item.id===b.dataset.checkTrack),input=document.querySelector(`[data-track-instruments="${b.dataset.checkTrack}"]`);if(!track)return;track.instruments=input?.value.trim()||'';store.set('nova-music-tracks',musicTracks.map(({url,...item})=>item));musicNotice=track.instruments?`Склад для «${track.name}» збережено: ${track.instruments}.`:'Прослухай трек і впиши інструменти для точного промпту. Автоматичного AI-розпізнавання тут немає.';render();});
  document.querySelectorAll('[data-prompt-track]').forEach(b=>b.onclick=()=>{const track=musicTracks.find(item=>item.id===b.dataset.promptTrack),input=document.querySelector(`[data-track-instruments="${b.dataset.promptTrack}"]`);if(!track)return;track.instruments=input?.value.trim()||track.instruments||'інструменти не вказані';store.set('nova-music-tracks',musicTracks.map(({url,...item})=>item));musicPrompt=`Створи оригінальну композицію, натхнену моїм завантаженим треком «${track.name}» (${formatDuration(track.duration)}). Інструментальний склад: ${track.instruments}. Передай подібний настрій, динаміку та енергію, але не копіюй мелодію, вокал, текст або впізнавані елементи оригіналу. Додай темну кінематографічну атмосферу NOVA AI.`;render();});
  document.querySelectorAll('[data-remove-track]').forEach(b=>b.onclick=async()=>{const track=musicTracks.find(item=>item.id===b.dataset.removeTrack);if(track){if(track.url)URL.revokeObjectURL(track.url);try{await audioStore.remove(track.id);}catch(error){console.warn('NOVA audio delete failed',error);}musicTracks=musicTracks.filter(item=>item.id!==track.id);store.set('nova-music-tracks',musicTracks.map(({url,...item})=>item));render();}});
  $('#copy-music-prompt')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(musicPrompt);const button=$('#copy-music-prompt');if(button)button.textContent='✓ Скопійовано';}catch{}});
  $('#enable-adult')?.addEventListener('click',()=>{adult=true;store.set('nova-adult',true);render();}); $('#disable-adult')?.addEventListener('click',()=>{adult=false;store.set('nova-adult',false);render();});
  document.querySelectorAll('[data-character]').forEach(b=>b.onclick=()=>{activeCharacter={name:b.dataset.character,description:b.dataset.intro};store.set('nova-active-character',activeCharacter);active='chat';messages.push({role:'nova',text:`Зв’язок із ${b.dataset.character} встановлено. ${b.dataset.intro}`});persistChat();render();});
  document.querySelectorAll('[data-custom-character]').forEach(b=>{const activate=()=>{activeCharacter={name:b.dataset.customCharacter,description:b.dataset.intro};store.set('nova-active-character',activeCharacter);active='chat';messages.push({role:'nova',text:`Зв’язок встановлено. ${b.dataset.customCharacter} готовий до розмови.`});persistChat();render();};b.onclick=activate;b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}};});
  document.querySelectorAll('[data-delete-character]').forEach(b=>b.onclick=e=>{e.stopPropagation();customCharacters=customCharacters.filter(x=>String(x.id)!==String(b.dataset.deleteCharacter));store.set('nova-characters',customCharacters);render();});
  $('#new-character')?.addEventListener('click',()=>{const host=$('#character-create');host.innerHTML=`<form class="studio-card character-form" id="character-form"><h3>Створити персонажа</h3><label>Ім’я<input id="character-name" maxlength="32" placeholder="Ім’я" required></label><label>Характер та вступ<textarea id="character-description" maxlength="1800" placeholder="Хто він/вона і з чого починає розмову..." required></textarea></label><p class="notice" id="character-save-status" role="status"></p><button class="primary" type="submit">Створити</button></form>`;$('#character-form').addEventListener('submit',e=>{e.preventDefault();const name=$('#character-name').value.trim(),description=$('#character-description').value.trim(),status=$('#character-save-status');if(!name||!description){status.textContent='Заповни ім’я та опис персонажа.';return;}const id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;customCharacters=[{id,name,description},...customCharacters];if(store.set('nova-characters',customCharacters)){characterNotice='Персонажа збережено на цьому пристрої.';render();}else status.textContent='Не вдалося зберегти персонажа.';});});
  $('#open-auth')?.addEventListener('click',()=>{$('#app').insertAdjacentHTML('beforeend',authModal());bindAuth();});
  $('#open-settings')?.addEventListener('click',()=>{$('#app').insertAdjacentHTML('beforeend',authModal());bindAuth();});
}
function bindAuth(){ $('#close-auth')?.addEventListener('click',()=>$('.modal-backdrop')?.remove()); $('#sign-out')?.addEventListener('click',async()=>{const {error}=await supabase?.auth.signOut();if(error){authNotice=error.message;return;}session=null;render();}); $('#auth-form')?.addEventListener('submit',async e=>{e.preventDefault();const email=$('#auth-email')?.value.trim(),password=$('#auth-password')?.value;const form=$('#auth-form');const button=form?.querySelector('button');if(button)button.disabled=true;let result=await supabase.auth.signInWithPassword({email,password});if(result.error&&/invalid login credentials|user not found/i.test(result.error.message))result=await supabase.auth.signUp({email,password});if(result.error){authNotice=result.error.message;if(button)button.disabled=false;render();return;}session=result.data.session;if(!session){authNotice='Перевір email: Supabase очікує підтвердження реєстрації.';render();return;}authNotice='';await loadCloudLibrary();render();});}
async function initializeCloud(){if(!supabase)return;const {data}=await supabase.auth.getSession();session=data.session;if(session)await loadCloudLibrary();supabase.auth.onAuthStateChange(async(_event,next)=>{session=next;if(session)await loadCloudLibrary();render();});}
await initializeCloud();
render();
hydrateMusicTracks();
if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
