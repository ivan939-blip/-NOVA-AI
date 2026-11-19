import './style.css';
import { supabase, isCloudReady } from './supabase.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};
let active = 'chat';
let messages = store.get('nova-messages', [{role:'nova', text:'Я NOVA. Опиши ідею — я допоможу перетворити її на щось незабутнє.'}]);
let library = store.get('nova-library', []);
let adult = store.get('nova-adult', false);
let session = null;
let authNotice = '';
let chatBusy = false;
let imageBusy = false;
let imageResult = '';
let imageError = '';
let imagePrompt = '';\nlet customCharacters = store.get('nova-characters', []);\nlet activeCharacter = store.get('nova-active-character', null);

function esc(t) { const e=document.createElement('div'); e.textContent=t; return e.innerHTML; }
function icon(n) { return ({chat:'◈',image:'◇',video:'▷',characters:'♙',library:'▣',adult:'18+'})[n]; }
function navItem(id, label) { return `<button class="nav-item ${active===id?'active':''}" data-go="${id}"><span>${icon(id)}</span><small>${label}</small></button>`; }
function hero() { return `<div class="hero"><button class="account-pill" id="open-auth">${session ? '● CLOUD' : '○ SIGN IN'}</button><div class="halo"></div><div class="heroine"><i></i><b></b><em></em></div><div class="scan"></div><div class="hero-copy"><span class="eyebrow">NOVA // AI STUDIO</span><h1>CREATE<br><strong>THE IMPOSSIBLE</strong></h1><p>Твоя темна муза для слів, образів і руху.</p></div></div>`; }
function chat() { return `<section class="screen chat-screen">${activeCharacter?`<div class="active-persona">✧ ${esc(activeCharacter.name)} <button id="clear-persona">×</button></div>`:''}${hero()}<div class="section-title"><div><span>NEURAL CHANNEL · ${chatBusy ? 'CONNECTING' : 'ONLINE'}</span><h2>Чат з NOVA</h2></div><button class="round" id="clear-chat" aria-label="Очистити чат">↻</button></div><div class="messages">${messages.map(m=>`<div class="message ${m.role}">${esc(m.text)}</div>`).join('')}</div><form class="composer" id="chat-form"><input id="chat-input" ${chatBusy?'disabled':''} placeholder="Напиши NOVA..." autocomplete="off"/><button ${chatBusy?'disabled':''} aria-label="Надіслати">${chatBusy?'…':'↑'}</button></form></section>`; }
function imageStudio() { return `<section class="screen"><div class="page-head"><span>01 // VISUAL FORGE</span><h2>Image Studio</h2><p>Створи кінематографічний образ із текстового опису.</p></div><div class="studio-card image-card"><div class="fake-art">✦<small>GENERATION CORE</small></div><label>Твій промпт<textarea id="image-prompt" placeholder="Наприклад: готична героїня під неоновим дощем..." value="${esc(imagePrompt)}"></textarea></label><div class="chips"><button type="button" data-prompt-chip="dark gothic cyberpunk">Cyberpunk</button><button type="button" data-prompt-chip="gothic dark fantasy">Gothic</button><button type="button" data-prompt-chip="cinematic portrait">Portrait</button></div><button class="primary" id="generate-image" ${imageBusy?'disabled':''}>${imageBusy?'⟳ Генерую...':'✦ Створити зображення'}</button>${imageError?'<p class="image-error">'+esc(imageError)+'</p>':''}${imageResult?'<div class="generated-image"><img src="'+imageResult+'" alt="Згенероване NOVA зображення"/><button class="secondary" id="save-image-concept">Зберегти опис до Library</button></div>':''}</div><p class="notice">Генерація використовує Cloudflare Workers AI. Доступність залежить від лімітів.</p></section>`; }
function videoStudio() { return `<section class="screen"><div class="page-head"><span>02 // MOTION VOID</span><h2>Video Studio</h2><p>Збери задум для короткого атмосферного відео.</p></div><div class="studio-card"><div class="video-preview"><span>▶</span><i>00:08</i></div><label>Сценарій руху<textarea id="video-prompt" placeholder="Камера наближається, неон мерехтить..."></textarea></label><div class="options"><button class="selected">9:16</button><button>16:9</button><button>1:1</button></div><button class="primary" data-draft="video">▷ Зберегти відео-ідею</button></div><p class="notice">Рендеринг відео ще не підключений. Зберігаємо лише ідею.</p></section>`; }
function characters() { const chars=[['NYX','Темна провидиця'],['VEX','Неоновий бунтар'],['LUNA','Синтетична муза']]; return `<section class="screen"><div class="page-head"><span>03 // SOUL ARCHIVE</span><h2>Characters</h2><p>Обери співрозмовника або створи власного.</p></div><div class="character-grid">${chars.map((c,i)=>`<button class="character" data-character="${c[0]}" data-intro="${c[1]}"><div class="avatar a${i}"><span>◉</span></div><b>${c[0]}</b><small>${c[1]}</small></button>`).join('')}${customCharacters.map(c=>`<button class="character" data-custom-character="${esc(c.name)}" data-intro="${esc(c.description)}"><div class="avatar"><span>✧</span></div><b>${esc(c.name)}</b><small>${esc(c.description)}</small><span class="delete-character" data-delete-character="${c.id}">×</span></button>`).join('')}<button class="character new" id="new-character"><div class="avatar">＋</div><b>NEW SOUL</b><small>Новий персонаж</small></button></div><div id="character-create"></div></section>`; }
function libraryView() { return `<section class="screen"><div class="page-head"><span>04 // MEMORY VAULT</span><h2>My Library</h2><p>${session ? 'Збережено на цьому пристрої; синхронізація текстів доступна.' : 'Збереження на цьому пристрої.'}</p></div><div class="library">${library.length?library.map((x,i)=>`<article class="saved">${x.image?'<img class="library-thumb" src="'+x.image+'" alt="Збережене зображення"/>':'<div class="saved-icon">'+(x.type==='image'?'✦':'▷')+'</div>'}<div><small>${x.type==='image'?'IMAGE':'VIDEO IDEA'} · ${x.date}</small><p>${esc(x.text)}</p></div><button data-remove="${i}" aria-label="Видалити">×</button></article>`).join(''):`<div class="empty"><span>▣</span><h3>Тут поки тихо</h3><p>Збережені з Image та Video Studio з’являться тут.</p></div>`}</div></section>`; }
function adultView() { return `<section class="screen adult"><div class="adult-mark">18<span>+</span></div><div class="page-head"><span>05 // PRIVATE CHAMBER</span><h2>18+ Mode</h2><p>${adult?'Приватний режим увімкнено на цьому пристрої.':'Цей простір призначений лише для повнолітніх.'}</p></div>${adult?`<div class="studio-card"><h3>Приватний простір готовий</h3><p>Підключення дорослих AI-функцій потребуватиме окремого безпечного бекенду та перевірок політик.</p><button class="secondary" id="disable-adult">Вимкнути режим</button></div>`:`<div class="studio-card"><h3>Підтвердження віку</h3><p>Підтверджую, що мені виповнилося 18 років.</p><button class="primary" id="enable-adult">Мені 18+</button></div>`}</section>`; }
function content(){ return ({chat,image:imageStudio,video:videoStudio,characters,library:libraryView,adult:adultView})[active](); }
function authModal(){return `<div class="modal-backdrop"><section class="auth-modal"><button class="modal-close" id="close-auth">×</button><span class="eyebrow">NOVA IDENTITY</span><h2>${session ? 'Твій профіль' : 'Увійти до NOVA'}</h2>${session?`<p>${esc(session.user.email)}</p><button class="secondary" id="sign-out">Вийти</button>`:isCloudReady?`<p>Увійди або створи акаунт, щоб синхронізувати бібліотеку.</p><form id="auth-form"><input type="email" id="auth-email" placeholder="Email" required/><input type="password" id="auth-password" placeholder="Пароль (мін. 6 символів)" minlength="6" required/><button class="primary">Продовжити</button></form><p class="notice">${authNotice || 'Новий email автоматично отримає посилання для підтвердження.'}</p>`:`<p>Хмарний обліковий запис ще не налаштований для цього deployment.</p><p class="notice">Хмарний вхід запрацює після підключення безкоштовного проєкту Supabase.</p>`}</section></div>`;}
function render(){ $('#app').innerHTML=`<main class="app-shell">${content()}<nav>${navItem('chat','Chat')}${navItem('image','Images')}${navItem('video','Video')}${navItem('characters','Souls')}${navItem('library','Library')}${navItem('adult','18+')}</nav></main>`; bind(); }
async function generateImage(){const prompt=$('#image-prompt')?.value.trim();if(!prompt||imageBusy)return;imagePrompt=prompt;imageBusy=true;imageError='';imageResult='';render();try{const res=await fetch(`${import.meta.env.BASE_URL}api/image`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});const data=await res.json();if(!res.ok||!data.image)throw new Error(data.error||data.code||'Сервер не повернув зображення.');imageResult=data.image;}catch(e){imageError=e.message||'Помилка генерації.';}finally{imageBusy=false;render();}}
async function askNOVA(text) {
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
    store.set('nova-messages',messages);
    render();
  }
}
async function compactImage(dataUrl){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const canvas=document.createElement('canvas');const max=768,scale=Math.min(1,max/Math.max(img.width,img.height));canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',0.78));};img.onerror=()=>reject(new Error('Не вдалося підготувати зображення для збереження.'));img.src=dataUrl;});}
async function saveDraft(type, text, image='') { const item={type,text,image,date:new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'short'}).format(new Date())}; library.unshift(item);try{store.set('nova-library',library);}catch(e){library.shift();throw new Error('Бібліотека пристрою переповнена. Видали старі записи й повтори.');}if(session&&supabase&&!image){const {error}=await supabase.from('library_items').insert({user_id:session.user.id,type,prompt:text});if(error) console.error('Cloud library save failed',error);}}
async function loadCloudLibrary(){if(!session||!supabase)return;const {data,error}=await supabase.from('library_items').select('type,prompt,created_at').order('created_at',{ascending:false});if(!error&&data){library=data.map(x=>({type:x.type,text:x.prompt,date:new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'short'}).format(new Date(x.created_at))}));store.set('nova-library',library);}}
function bind(){ document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{active=b.dataset.go;render();}); $('#chat-form')?.addEventListener('submit',async e=>{e.preventDefault();const input=$('#chat-input'),text=input.value.trim();if(!text||chatBusy)return;messages.push({role:'user',text});store.set('nova-messages',messages);await askNOVA(text);}); $('#clear-chat')?.addEventListener('click',()=>{messages=messages.slice(0,1);store.set('nova-messages',messages);render();}); $('#clear-persona')?.addEventListener('click',()=>{activeCharacter=null;store.set('nova-active-character',null);render();}); document.querySelectorAll('[data-draft]').forEach(b=>b.onclick=async()=>{const type=b.dataset.draft,text=$(`#${type}-prompt`).value.trim();if(!text)return;await saveDraft(type,text);b.textContent='✓ Збережено до Library';}); $('#image-prompt')?.addEventListener('input',e=>{imagePrompt=e.target.value;}); document.querySelectorAll('[data-prompt-chip]').forEach(b=>b.onclick=()=>{const input=$('#image-prompt');if(input){imagePrompt=(input.value.trim()+' '+b.dataset.promptChip).trim();input.value=imagePrompt;}}); $('#generate-image')?.addEventListener('click',generateImage); $('#save-image-concept')?.addEventListener('click',async()=>{const text=imagePrompt.trim();if(text&&imageResult){try{const compact=await compactImage(imageResult);await saveDraft('image',text,compact);imageError='Зображення та опис збережено до Library.';}catch(e){imageError=e.message;}render();}}); document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{library.splice(+b.dataset.remove,1);store.set('nova-library',library);render();}); $('#enable-adult')?.addEventListener('click',()=>{adult=true;store.set('nova-adult',true);render();}); $('#disable-adult')?.addEventListener('click',()=>{adult=false;store.set('nova-adult',false);render();}); document.querySelectorAll('[data-character]').forEach(b=>b.onclick=()=>{activeCharacter={name:b.dataset.character,description:b.dataset.intro};store.set('nova-active-character',activeCharacter);active='chat';messages.push({role:'nova',text:`Зв’язок із ${b.dataset.character} встановлено. ${b.dataset.intro}`});store.set('nova-messages',messages);render();}); document.querySelectorAll('[data-custom-character]').forEach(b=>b.onclick=()=>{activeCharacter={name:b.dataset.customCharacter,description:b.dataset.intro};store.set('nova-active-character',activeCharacter);active='chat';messages.push({role:'nova',text:`Зв’язок встановлено. ${b.dataset.customCharacter} готовий до розмови.`});store.set('nova-messages',messages);render();}); document.querySelectorAll('[data-delete-character]').forEach(b=>b.onclick=e=>{e.stopPropagation();customCharacters=customCharacters.filter(x=>x.id!==b.dataset.deleteCharacter);store.set('nova-characters',customCharacters);render();}); $('#new-character')?.addEventListener('click',()=>{const host=$('#character-create');host.innerHTML=`<div class="studio-card character-form"><h3>Створити персонажа</h3><label>Ім’я<input id="character-name" maxlength="32" placeholder="Ім’я"></label><label>Характер та вступ<textarea id="character-description" placeholder="Хто він/вона і з чого починає розмову..."></textarea></label><button class="primary" id="create-character">Створити</button></div>`;$('#create-character').onclick=()=>{const name=$('#character-name').value.trim(),description=$('#character-description').value.trim();if(!name||!description)return;customCharacters.unshift({id:String(Date.now()),name,description});store.set('nova-characters',customCharacters);render();};}); $('#open-auth')?.addEventListener('click',()=>{$('#app').insertAdjacentHTML('beforeend',authModal());bindAuth();}); }
function bindAuth(){ $('#close-auth')?.addEventListener('click',()=>$('.modal-backdrop').remove()); $('#sign-out')?.addEventListener('click',async()=>{await supabase?.auth.signOut();session=null;render();}); $('#auth-form')?.addEventListener('submit',async e=>{e.preventDefault();const email=$('#auth-email').value,password=$('#auth-password').value;let result=await supabase.auth.signInWithPassword({email,password});if(result.error?.message?.toLowerCase().includes('invalid'))result=await supabase.auth.signUp({email,password});if(result.error){authNotice=result.error.message;$('.modal-backdrop').remove();render();setTimeout(()=>$('#open-auth')?.click(),0);return;}session=result.data.session;await loadCloudLibrary();render();});}
async function initializeCloud(){if(!supabase)return;const {data}=await supabase.auth.getSession();session=data.session;if(session)await loadCloudLibrary();supabase.auth.onAuthStateChange(async(_event,next)=>{session=next;if(session)await loadCloudLibrary();render();});}
await initializeCloud();
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
