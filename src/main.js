import './style.css';
import { supabase, isCloudReady } from './supabase.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { console.warn('NOVA local storage write failed',e); return false; } }
};
let active = 'home';
let messages = store.get('nova-messages', [{role:'nova', text:'Я NOVA. Опиши ідею — я допоможу перетворити її на щось незабутнє.'}]);
let library = store.get('nova-library', []);
let adult = store.get('nova-adult', false);
let session = null;
let authNotice = '';
let chatBusy = false;
let imageBusy = false;
let imageResult = '';
let imageError = '';
let imagePrompt = '';
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
const localVideoApi = (import.meta.env.VITE_LOCAL_VIDEO_API_URL || 'http://127.0.0.1:8189/api/video').replace(/\/$/, '');

function esc(t) { return String(t ?? '').replace(/[&<>"']/g, ch => { switch (ch) { case '&': return '&amp;'; case '<': return '&lt;'; case '>': return '&gt;'; case '"': return '&quot;'; case "'": return '&#39;'; default: return ch; } }); }
function icon(n) { return ({home:'⌂',chat:'◈',image:'◇',video:'▷',characters:'♙',library:'▣',adult:'18+'})[n]; }
function navItem(id, label) { return `<button class="nav-item ${active===id?'active':''}" data-go="${id}"><span>${icon(id)}</span><small>${label}</small></button>`; }
function hero() { return `<section class="hero home-hero"><button class="menu-mark" aria-label="Меню">☰</button><button class="account-pill" id="open-auth">${session ? '● CLOUD' : '○ SIGN IN'}</button><div class="hero-moon"></div><div class="hero-castle">♜　♜　♜</div><div class="halo"></div><div class="heroine"><i></i><b></b><em></em></div><div class="hero-copy"><span class="eyebrow">YOUR AI. YOUR WORLD.</span><h1>NOVA <strong>AI ✦</strong></h1><p>Твоя темна муза для слів, образів і руху.</p></div><div class="free-panel"><b>∞</b><strong>Безкоштовно<br>Назавжди</strong><small>✓ Без лімітів<br>✓ Без підписок<br>✓ Без карток</small></div></section>`; }
function home(){return `<section class="screen home-screen">${hero()}<button class="home-prompt" data-go="chat"><span>✦</span><div><b>Що ти хочеш створити?</b><small>Запитай мене або обери розділ...</small></div><i>↑</i></button><div class="home-grid"><button data-go="image"><span>✧</span><b>Image Studio</b><small>Створи зображення</small></button><button data-go="video"><span>▶</span><b>Video Studio</b><small>Створи відео</small></button><button data-go="characters"><span>♙</span><b>Characters</b><small>Твої персонажі</small></button><button data-go="chat"><span>◈</span><b>AI Chat</b><small>Спілкуйся зі мною</small></button><button data-go="library"><span>▣</span><b>My Library</b><small>Твоя бібліотека</small></button><button data-go="adult"><span>18+</span><b>18+ Mode</b><small>Для дорослих</small></button></div></section>`; }
function chat() { return `<section class="screen chat-screen">${activeCharacter?`<div class="active-persona">✧ ${esc(activeCharacter.name)} <button id="clear-persona">×</button></div>`:''}<div class="section-title"><div><span>NEURAL CHANNEL · ${chatBusy ? 'CONNECTING' : 'ONLINE'}</span><h2>Чат з NOVA</h2></div><button class="round" id="clear-chat" aria-label="Очистити чат">↻</button></div><div class="messages">${messages.map(m=>`<div class="message ${m.role}">${esc(m.text)}</div>`).join('')}</div><form class="composer" id="chat-form"><input id="chat-input" maxlength="4000" ${chatBusy?'disabled':''} placeholder="Напиши NOVA..." autocomplete="off"/><button ${chatBusy?'disabled':''} aria-label="Надіслати">${chatBusy?'…':'↑'}</button></form></section>`; }
function imageStudio() { return `<section class="screen"><div class="page-head"><span>01 // VISUAL FORGE</span><h2>Image Studio</h2><p>Створи кінематографічний образ із текстового опису.</p></div><div class="studio-card image-card"><div class="fake-art">✦<small>GENERATION CORE</small></div><label>Твій промпт<textarea id="image-prompt" maxlength="1800" placeholder="Наприклад: готична героїня під неоновим дощем...">${esc(imagePrompt)}</textarea></label><div class="chips"><button type="button" data-prompt-chip="dark gothic cyberpunk">Cyberpunk</button><button type="button" data-prompt-chip="gothic dark fantasy">Gothic</button><button type="button" data-prompt-chip="cinematic portrait">Portrait</button></div><button class="primary" id="generate-image" ${imageBusy?'disabled':''}>${imageBusy?'⟳ Генерую...':'✦ Створити зображення'}</button>${imageError?'<p class="image-error">'+esc(imageError)+'</p>':''}${imageResult?'<div class="generated-image"><img src="'+imageResult+'" alt="Згенероване NOVA зображення"/><button class="secondary" id="save-image-concept">Зберегти опис до Library</button></div>':''}</div><p class="notice">Генерація використовує Cloudflare Workers AI. Доступність залежить від лімітів.</p></section>`; }
function videoStudio() { return `<section class="screen"><div class="page-head"><span>02 // MOTION VOID</span><h2>Video Studio</h2><p>Підготуй сценарій, кадри та промпт без платних сервісів.</p></div><div class="studio-card"><div class="video-preview"><span>▶</span><i>00:${videoDuration.padStart(2,'0')}</i></div><label>Ідея відео<textarea id="video-prompt" maxlength="1800" placeholder="Наприклад: героїня йде крізь неоновий дощ, камера повільно наближається...">${esc(videoPrompt)}</textarea></label><label class="video-field-label">Стиль</label><div class="chips video-styles"><button type="button" data-video-style="dark cinematic" class="${videoStyle==='dark cinematic'?'selected':''}">Cinematic</button><button type="button" data-video-style="gothic fantasy" class="${videoStyle==='gothic fantasy'?'selected':''}">Gothic</button><button type="button" data-video-style="neon cyberpunk" class="${videoStyle==='neon cyberpunk'?'selected':''}">Cyberpunk</button></div><label class="video-field-label">Тривалість</label><div class="options"><button type="button" data-duration="5" class="${videoDuration==='5'?'selected':''}">5 с</button><button type="button" data-duration="8" class="${videoDuration==='8'?'selected':''}">8 с</button><button type="button" data-duration="12" class="${videoDuration==='12'?'selected':''}">12 с</button></div><label class="video-field-label">Формат кадру</label><div class="options"><button type="button" data-ratio="9:16" class="${videoRatio==='9:16'?'selected':''}">9:16</button><button type="button" data-ratio="16:9" class="${videoRatio==='16:9'?'selected':''}">16:9</button><button type="button" data-ratio="1:1" class="${videoRatio==='1:1'?'selected':''}">1:1</button></div><button class="secondary" id="build-video-plan" type="button">✦ Створити розкадрування</button>${videoStoryboard?`<div class="video-storyboard"><b>ТВОЯ РОЗКАДРОВКА</b><p>${esc(videoStoryboard).replace(/\n/g,'<br>')}</p><button class="secondary" id="copy-video-plan" type="button">Копіювати готовий промпт</button></div>`:''}<button class="primary" data-draft="video">▷ Зберегти сценарій до Library</button><button class="primary" id="generate-real-video" type="button" ${videoBusy?"disabled":""}>${videoBusy?"⟳ Генерую відео...":"✦ Генерувати локально (Wan2.1)"}</button><div class="video-job-status" role="status">${esc(videoStatus||videoError)}</div>${videoUrl?'<video class="generated-video" controls playsinline src="'+esc(videoUrl)+'"></video><a href="'+esc(videoUrl)+'" target="_blank" rel="noopener">Відкрити відеофайл</a>':''}</div><p class="notice">Локальний Wan2.1 через ComfyUI · без ключів, лімітів і підписок. Потрібен запущений NOVA Local Video Server.</p></section>`; }
function characters() { const chars=[['NYX','Темна провидиця'],['VEX','Неоновий бунтар'],['LUNA','Синтетична муза']]; return `<section class="screen"><div class="page-head"><span>03 // SOUL ARCHIVE</span><h2>Characters</h2><p>Обери співрозмовника або створи власного.</p></div>${characterNotice?`<p class="notice" role="status">${esc(characterNotice)}</p>`:'' }<div class="character-grid">${chars.map((c,i)=>`<button class="character" data-character="${c[0]}" data-intro="${c[1]}"><div class="avatar a${i}"><span>◉</span></div><b>${c[0]}</b><small>${c[1]}</small></button>`).join('')}${customCharacters.map(c=>`<div class="character" role="button" tabindex="0" data-custom-character="${esc(c.name)}" data-intro="${esc(c.description)}"><div class="avatar"><span>✧</span></div><b>${esc(c.name)}</b><small>${esc(c.description)}</small><button type="button" class="delete-character" aria-label="Видалити персонажа" data-delete-character="${esc(c.id)}">×</button></div>`).join('')}<button class="character new" id="new-character"><div class="avatar">＋</div><b>NEW SOUL</b><small>Новий персонаж</small></button></div><div id="character-create"></div></section>`; }
function libraryView() { return `<section class="screen"><div class="page-head"><span>04 // MEMORY VAULT</span><h2>My Library</h2><p>${session ? 'Збережено на цьому пристрої; синхронізація текстів доступна.' : 'Збереження на цьому пристрої.'}</p></div><div class="library">${library.length?library.map((x,i)=>`<article class="saved">${x.image?'<img class="library-thumb" src="'+x.image+'" alt="Збережене зображення"/>':'<div class="saved-icon">'+(x.type==='image'?'✦':'▷')+'</div>'}<div><small>${x.type==='image'?'IMAGE':'VIDEO IDEA'} · ${x.date}</small><p>${esc(x.text)}</p></div><button data-remove="${i}" aria-label="Видалити">×</button></article>`).join(''):`<div class="empty"><span>▣</span><h3>Тут поки тихо</h3><p>Збережені з Image та Video Studio з’являться тут.</p></div>`}</div></section>`; }
function adultView() { return `<section class="screen adult"><div class="adult-mark">18<span>+</span></div><div class="page-head"><span>05 // PRIVATE CHAMBER</span><h2>18+ Mode</h2><p>${adult?'Приватний режим увімкнено на цьому пристрої.':'Цей простір призначений лише для повнолітніх.'}</p></div>${adult?`<div class="studio-card"><h3>Приватний простір готовий</h3><p>Підключення дорослих AI-функцій потребуватиме окремого безпечного бекенду та перевірок політик.</p><button class="secondary" id="disable-adult">Вимкнути режим</button></div>`:`<div class="studio-card"><h3>Підтвердження віку</h3><p>Підтверджую, що мені виповнилося 18 років.</p><button class="primary" id="enable-adult">Мені 18+</button></div>`}</section>`; }
function content(){ return ({home,chat,image:imageStudio,video:videoStudio,characters,library:libraryView,adult:adultView})[active](); }
function authModal(){return `<div class="modal-backdrop"><section class="auth-modal"><button class="modal-close" id="close-auth">×</button><span class="eyebrow">NOVA IDENTITY</span><h2>${session ? 'Твій профіль' : 'Увійти до NOVA'}</h2>${session?`<p>${esc(session.user.email)}</p><button class="secondary" id="sign-out">Вийти</button>`:isCloudReady?`<p>Увійди або створи акаунт, щоб синхронізувати бібліотеку.</p><form id="auth-form"><input type="email" id="auth-email" placeholder="Email" required/><input type="password" id="auth-password" placeholder="Пароль (мін. 6 символів)" minlength="6" required/><button class="primary">Продовжити</button></form><p class="notice">${authNotice || 'Новий email автоматично отримає посилання для підтвердження.'}</p>`:`<p>Хмарний обліковий запис ще не налаштований для цього deployment.</p><p class="notice">Хмарний вхід запрацює після підключення безкоштовного проєкту Supabase.</p>`}</section></div>`;}
function render(){ const hadAuth=Boolean($('.modal-backdrop')); $('#app').innerHTML=`<main class="app-shell">${content()}<nav>${navItem('home','Home')}${navItem('image','Studio')}${navItem('chat','Chat')}${navItem('library','Library')}${navItem('adult','18+')}</nav></main>`; bind(); if(hadAuth&&!session){$('#app').insertAdjacentHTML('beforeend',authModal());bindAuth();} }
async function generateImage(){
  const prompt=$('#image-prompt')?.value.trim();
  if(!prompt||imageBusy)return;
  imagePrompt=prompt;imageBusy=true;imageError='';imageResult='';render();
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),120000);
  try{
    const res=await fetch(`${import.meta.env.BASE_URL}api/image`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt}),signal:controller.signal
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
async function saveDraft(type, text, image='') { const item={type,text,image,date:new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'short'}).format(new Date())}; library.unshift(item);if(!store.set('nova-library',library)){library.shift();throw new Error('Бібліотека пристрою переповнена. Видали старі записи й повтори.');}if(session&&supabase&&!image){const {data,error}=await supabase.from('library_items').insert({user_id:session.user.id,type,prompt:text}).select('id').single();if(error){item.cloudError=true;store.set('nova-library',library);throw new Error('Запис збережено локально, але синхронізація не вдалася: '+error.message);}if(data?.id){item.cloudId=data.id;store.set('nova-library',library);}}}
async function loadCloudLibrary(){if(!session||!supabase)return;const {data,error}=await supabase.from('library_items').select('id,type,prompt,created_at').order('created_at',{ascending:false});if(error){console.error('Cloud library load failed',error);return;}if(data){const fmt=d=>new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'short'}).format(new Date(d));const localImages=library.filter(x=>x.image);const cloudItems=data.map(x=>({type:x.type,text:x.prompt,date:fmt(x.created_at),cloud:true,cloudId:x.id}));const unsynced=library.filter(x=>!x.image&&!x.cloud&&!data.some(y=>y.prompt===x.text&&y.type===x.type));library=[...localImages,...unsynced,...cloudItems];try{store.set('nova-library',library);}catch(e){console.warn('Library local cache limit',e);}}}
async function generateRealVideo() {
  const prompt = $('#video-prompt')?.value.trim();
  if (!prompt || videoBusy) return;
  videoPrompt = prompt; videoBusy = true; videoStatus = 'Надсилаю запит...'; videoError = ''; videoUrl = ''; render();
  try {
    const res = await fetch(localVideoApi, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({prompt:prompt+' Style: '+videoStyle+'. Cinematic camera movement.',seconds:Math.max(4,Math.min(12,Number(videoDuration)||5)),aspect_ratio:videoRatio}) });
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
function bind(){ $('#generate-real-video')?.addEventListener('click',generateRealVideo); document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{active=b.dataset.go;render();}); $('#chat-form')?.addEventListener('submit',async e=>{e.preventDefault();const input=$('#chat-input'),text=input.value.trim();if(!text||chatBusy)return;messages.push({role:'user',text});if(!store.set('nova-messages',messages)){messages.pop();render();return;}await askNOVA(text);}); $('#clear-chat')?.addEventListener('click',()=>{messages=messages.slice(0,1);store.set('nova-messages',messages);render();}); $('#clear-persona')?.addEventListener('click',()=>{activeCharacter=null;store.set('nova-active-character',null);render();}); document.querySelectorAll('[data-ratio]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-ratio]').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');videoRatio=b.dataset.ratio;}); document.querySelectorAll('[data-duration]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-duration]').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');videoDuration=b.dataset.duration;const preview=$('.video-preview i');if(preview)preview.textContent='00:'+videoDuration.padStart(2,'0');}); document.querySelectorAll('[data-video-style]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-video-style]').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');videoStyle=b.dataset.videoStyle;}); $('#video-prompt')?.addEventListener('input',e=>{videoPrompt=e.target.value;}); $('#build-video-plan')?.addEventListener('click',()=>{videoPrompt=$('#video-prompt')?.value.trim()||'';if(!videoPrompt){$('#video-prompt')?.focus();return;}const d=Number(videoDuration);const cuts=d===5?[[0,2,'Встановчий кадр: покажи місце та атмосферу'],[2,4,'Головна дія: персонаж або об’єкт рухається'],[4,5,'Фінальний акцент: виразний завершальний образ']]:d===12?[[0,3,'Встановчий кадр: повільно відкрий локацію та настрій'],[3,8,'Основна дія: покажи рух персонажа й деталі сцени'],[8,12,'Кульмінація та фінальний кадр: плавне завершення']]:[[0,2,'Встановчий кадр: покажи локацію та атмосферу'],[2,6,'Основна дія: персонаж рухається, камера супроводжує'],[6,8,'Фінальний акцент: завершальний кінематографічний образ']];videoStoryboard=cuts.map((s,i)=>`КАДР ${i+1} · ${s[0]}–${s[1]} с\n${s[2]}`).join('\n\n');render();}); $('#copy-video-plan')?.addEventListener('click',async()=>{const prompt=`Створи відео тривалістю ${videoDuration} секунд, формат ${videoRatio}, стиль ${videoStyle}.\nІдея: ${videoPrompt}\n\nРозкадрування:\n${videoStoryboard}\n\nЗбережи послідовність дії, плавність руху камери, цілісність персонажів та освітлення.`;try{await navigator.clipboard.writeText(prompt);const b=$('#copy-video-plan');if(b)b.textContent='✓ Скопійовано';}catch(e){const b=$('#copy-video-plan');if(b)b.textContent='Не вдалося скопіювати';}}); document.querySelectorAll('[data-draft]').forEach(b=>b.onclick=async()=>{const type=b.dataset.draft;const text=$('#'+type+'-prompt')?.value.trim();if(!text)return;const draftText=type==='video'?['Формат: '+videoRatio+'; Тривалість: '+videoDuration+' с; Стиль: '+videoStyle,'Ідея: '+text,videoStoryboard?'Розкадрування:\n'+videoStoryboard:''].filter(Boolean).join('\n\n'):text;try{await saveDraft(type,draftText);b.textContent='✓ Збережено до Library';}catch(e){b.textContent='⚠ Помилка збереження';console.error(e);}}); $('#image-prompt')?.addEventListener('input',e=>{imagePrompt=e.target.value;}); document.querySelectorAll('[data-prompt-chip]').forEach(b=>b.onclick=()=>{const input=$('#image-prompt');if(input){imagePrompt=(input.value.trim()+' '+b.dataset.promptChip).trim();input.value=imagePrompt;}}); $('#generate-image')?.addEventListener('click',generateImage); $('#save-image-concept')?.addEventListener('click',async()=>{const text=imagePrompt.trim();if(text&&imageResult){try{const compact=await compactImage(imageResult);await saveDraft('image',text,compact);imageError='Зображення та опис збережено до Library.';}catch(e){imageError=e.message;}render();}}); document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{const item=library[+b.dataset.remove];if(item?.cloudId&&session&&supabase){const {error}=await supabase.from('library_items').delete().eq('id',item.cloudId).eq('user_id',session.user.id);if(error){console.error('Cloud delete failed',error);return;}}library.splice(+b.dataset.remove,1);try{store.set('nova-library',library);}catch(e){console.warn(e);}render();}); $('#enable-adult')?.addEventListener('click',()=>{adult=true;store.set('nova-adult',true);render();}); $('#disable-adult')?.addEventListener('click',()=>{adult=false;store.set('nova-adult',false);render();}); document.querySelectorAll('[data-character]').forEach(b=>b.onclick=()=>{activeCharacter={name:b.dataset.character,description:b.dataset.intro};store.set('nova-active-character',activeCharacter);active='chat';messages.push({role:'nova',text:`Зв’язок із ${b.dataset.character} встановлено. ${b.dataset.intro}`});store.set('nova-messages',messages);render();}); document.querySelectorAll('[data-custom-character]').forEach(b=>{const activate=()=>{activeCharacter={name:b.dataset.customCharacter,description:b.dataset.intro};store.set('nova-active-character',activeCharacter);active='chat';messages.push({role:'nova',text:`Зв’язок встановлено. ${b.dataset.customCharacter} готовий до розмови.`});store.set('nova-messages',messages);render();};b.onclick=activate;b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}};}); document.querySelectorAll('[data-delete-character]').forEach(b=>b.onclick=e=>{e.stopPropagation();customCharacters=customCharacters.filter(x=>String(x.id)!==String(b.dataset.deleteCharacter));store.set('nova-characters',customCharacters);render();}); $('#new-character')?.addEventListener('click',()=>{const host=$('#character-create');host.innerHTML=`<form class="studio-card character-form" id="character-form"><h3>Створити персонажа</h3><label>Ім’я<input id="character-name" maxlength="32" placeholder="Ім’я" required></label><label>Характер та вступ<textarea id="character-description" maxlength="1800" placeholder="Хто він/вона і з чого починає розмову..." required></textarea></label><p class="notice" id="character-save-status" role="status"></p><button class="primary" id="create-character" type="submit">Створити</button></form>`;$('#character-form').addEventListener('submit',e=>{e.preventDefault();const name=$('#character-name').value.trim(),description=$('#character-description').value.trim(),status=$('#character-save-status');if(!name||!description){status.textContent='Заповни ім’я та опис персонажа.';return;}const id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;const next=[{id,name,description},...customCharacters];try{localStorage.setItem('nova-characters',JSON.stringify(next));const saved=JSON.parse(localStorage.getItem('nova-characters')||'null');if(!Array.isArray(saved)||!saved.some(item=>item.id===id))throw new Error('Браузер не підтвердив запис.');customCharacters=saved;characterNotice='Персонажа збережено на цьому пристрої.';render();}catch(error){console.error('NOVA character save failed',error);status.textContent='Не вдалося зберегти персонажа. Перевір, чи браузер дозволяє зберігати дані сайту, і звільни місце в сховищі.';}});}); $('#open-auth')?.addEventListener('click',()=>{$('#app').insertAdjacentHTML('beforeend',authModal());bindAuth();}); }
function bindAuth(){ $('#close-auth')?.addEventListener('click',()=>$('.modal-backdrop')?.remove()); $('#sign-out')?.addEventListener('click',async()=>{const {error}=await supabase?.auth.signOut();if(error){authNotice=error.message;return;}session=null;render();}); $('#auth-form')?.addEventListener('submit',async e=>{e.preventDefault();const email=$('#auth-email')?.value.trim(),password=$('#auth-password')?.value;const form=$('#auth-form');const button=form?.querySelector('button');if(button)button.disabled=true;let result=await supabase.auth.signInWithPassword({email,password});if(result.error&&/invalid login credentials|user not found/i.test(result.error.message))result=await supabase.auth.signUp({email,password});if(result.error){authNotice=result.error.message;if(button)button.disabled=false;render();return;}session=result.data.session;if(!session){authNotice='Перевір email: Supabase очікує підтвердження реєстрації.';render();return;}authNotice='';await loadCloudLibrary();render();});}
async function initializeCloud(){if(!supabase)return;const {data}=await supabase.auth.getSession();session=data.session;if(session)await loadCloudLibrary();supabase.auth.onAuthStateChange(async(_event,next)=>{session=next;if(session)await loadCloudLibrary();render();});}
await initializeCloud();
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
