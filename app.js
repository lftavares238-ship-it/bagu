'use strict';

const SUPABASE_URL = 'https://byycxurjjonbhrreoost.supabase.co';
const SUPABASE_KEY = 'sb_publishable_CyvZ6fSv-rnd3tc_KhoVhg_jWxTrWOj';
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const db = { profiles:[], stores:[], menu_items:[], orders:[], categories:[] };
let session = null;
let currentMap = null;
let ownerMap = null;
let state = { route:'home', params:{}, cart:[], location:null, search:'', category:'all', cartOpen:false, adminTable:'stores', ownerTab:'dashboard' };

const DEFAULT_LOC = { lat:-26.2311, lng:-51.0781, label:'Porto União, SC' };
const money = n => 'R$ ' + (Math.round((Number(n)||0)*100)/100).toFixed(2).replace('.', ',');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const loadJSON = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch(e){ return fb; } };

const getLocalOrders = () => loadJSON('local_orders', {}); 
const saveLocalOrder = (id, data) => { const l = getLocalOrders(); l[id] = data; localStorage.setItem('local_orders', JSON.stringify(l)); };
const getLocalReviews = () => loadJSON('local_reviews', []);
const getStoreProfiles = () => loadJSON('local_store_profiles', {});
const saveStoreProfile = (id, data) => { const p = getStoreProfiles(); p[id] = { ...p[id], ...data }; localStorage.setItem('local_store_profiles', JSON.stringify(p)); };

let tempImages = { logo: null, cover: null };
let storeCoords = { lat: -26.2311, lng: -51.0781 };

function haversineKm(a,b){ const R=6371, rad = d => d*Math.PI/180; const dLat = rad(b.lat-a.lat), dLon = rad(b.lng-a.lng); const h = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2; return 2*R*Math.asin(Math.min(1, Math.sqrt(h))); }
const routeKm = (a,b) => haversineKm(a,b) * 1.35;

const TAXA = { kmIncluso: 2, porKm: 1.5, maxKm: 12, preparoMin: 25 };

async function fetchJSON(url){
  const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
  try { const r = await fetch(url, { signal: c.signal }); if(!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
const coordOk = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

function parseGeo(v){
  try {
    let r = null;
    if(v && typeof v === 'object' && Array.isArray(v.coordinates)) r = { lng:Number(v.coordinates[0]), lat:Number(v.coordinates[1]) };
    else if(typeof v === 'string'){
      const m = v.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
      if(m) r = { lng:Number(m[1]), lat:Number(m[2]) };
      else if(/^[0-9a-f]{42,}$/i.test(v)){
        const b = new Uint8Array(v.match(/../g).map(h => parseInt(h, 16))), dv = new DataView(b.buffer), le = b[0] === 1;
        let o = 5; if(dv.getUint32(1, le) & 0x20000000) o += 4;
        r = { lng:dv.getFloat64(o, le), lat:dv.getFloat64(o + 8, le) };
      }
    }
    return r && coordOk(r.lat, r.lng) ? r : null;
  } catch(e){ return null; }
}
function getStoreCoords(s){
  const g = parseGeo(s.location); if(g) return { ...g, exact:true };
  const p = getStoreProfiles()[s.id];
  if(p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) return { lat:p.lat, lng:p.lng, exact:true };
  return { lat:DEFAULT_LOC.lat, lng:DEFAULT_LOC.lng, exact:false };
}
function calcFee(store, km){
  const base = store.delivery_fee == null ? 5 : Number(store.delivery_fee);
  return Math.round((base + Math.max(0, km - TAXA.kmIncluso) * TAXA.porKm) * 100) / 100;
}

function shortLabel(x){
  const a = x.address || {};
  const rua = a.road ? a.road + (a.house_number ? ', ' + a.house_number : '') : '';
  const l = [rua, a.suburb || a.neighbourhood, a.city || a.town || a.village || a.municipality].filter(Boolean).join(' - ');
  return l || String(x.display_name || '').split(',').slice(0, 3).join(',');
}
async function geoSearch(q){
  const d = await fetchJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(q)}`);
  return d.map(x => ({ lat:Number(x.lat), lng:Number(x.lon), label:shortLabel(x) })).filter(x => coordOk(x.lat, x.lng));
}
async function geoReverse(lat, lng){
  const d = await fetchJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=pt-BR&lat=${lat}&lon=${lng}`);
  return shortLabel(d);
}
async function osrmRoute(a, b){
  const d = await fetchJSON(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`);
  if(d.code !== 'Ok' || !d.routes[0]) throw new Error('sem rota');
  const r = d.routes[0];
  return { km:r.distance / 1000, min:Math.max(1, Math.round(r.duration / 60)), coords:r.geometry.coordinates.map(([lng, lat]) => [lat, lng]) };
}

function quoteKey(store){
  const a = getStoreCoords(store), b = state.location;
  return [store.id, a.lat.toFixed(5), a.lng.toFixed(5), Number(b.lat).toFixed(5), Number(b.lng).toFixed(5)].join('|');
}
function ensureQuote(store){
  const key = quoteKey(store);
  if(state.quote && state.quote.key === key) return state.quote;
  state.quote = { key, status:'loading' };
  const a = getStoreCoords(store), b = state.location;
  (async () => {
    let q;
    try { const r = await osrmRoute(a, b); q = { km:r.km, min:r.min, coords:r.coords, source:'rota' }; }
    catch(e){ const km = routeKm(a, b); q = { km, min:Math.round(km * 3), coords:null, source:'estimativa' }; }
    q.km = Math.round(q.km * 10) / 10; q.key = key; q.exact = a.exact;
    q.status = q.km > TAXA.maxKm ? 'out' : 'ok';
    q.fee = calcFee(store, q.km);
    if(state.quote && state.quote.key === key){ state.quote = q; if(state.route === 'checkout') render(); }
  })();
  return state.quote;
}
function cardInfo(s){
  if(!state.location.confirmed) return '30-45 min';
  const km = routeKm(getStoreCoords(s), state.location);
  return km > TAXA.maxKm ? 'Fora da área' : `~${km.toFixed(1).replace('.', ',')} km, ${money(calcFee(s, km))}`;
}
function topProdutosHTML(store){
  const loc = getLocalOrders(), cont = {};
  db.orders.filter(o => o.store_id == store.id && loc[o.id]).forEach(o => (loc[o.id].items || []).forEach(i => { cont[i.menu_item_id] = (cont[i.menu_item_id] || 0) + i.quantity; }));
  const lista = Object.entries(cont).map(([id, q]) => ({ it:db.menu_items.find(m => m.id == id), q })).filter(x => x.it).sort((a, b) => b.q - a.q).slice(0, 5);
  return `<div class="owner-card" style="margin-top:24px; background:#fff; padding:24px; border-radius:16px; box-shadow:0 2px 12px rgba(0,0,0,0.06);"><h3 style="margin-bottom:16px;">Produtos mais vendidos</h3>${lista.length ? lista.map(x => `<div class="fee-row" style="padding:8px 0; display:flex; justify-content:space-between;"><span>${esc(x.it.name)}</span><strong>${x.q} un.</strong></div>`).join('') : '<p class="small muted">Ainda sem vendas registradas neste aparelho.</p>'}</div>`;
}

function parseItemImage(desc) {
  if(!desc) return { text: '', img: null };
  const match = desc.match(/\[IMG:(.*?)\]/);
  if(match) return { text: desc.replace(match[0], '').trim(), img: match[1] };
  return { text: desc, img: null };
}

const ICON = {
  search: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  cart: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
  pin: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  star: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`,
  clock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  x: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  web: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  db: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
  store: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 9.5 5 4h14l2 5.5"/><path d="M4 9.5h16V20H4z"/><path d="M9.5 20v-5h5v5"/></svg>`,
  eye: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
  chart: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`
};
ICON.home = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/></svg>`;
ICON.user = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>`;

const TRADUCOES = { 'Chicken': 'Frango', 'Vegetarian': 'Vegetariano', 'Seafood': 'Frutos do Mar', 'Beef': 'Carne Bovina', 'Pork': 'Carne Suína', 'Pasta': 'Massas', 'Dessert': 'Sobremesas', 'Side': 'Acompanhamentos', 'Starter': 'Entradas', 'Breakfast': 'Café da Manhã', 'Lamb': 'Cordeiro', 'Japanese': 'Japonesa', 'Italian': 'Italiana', 'Mexican': 'Mexicana', 'Indian': 'Indiana', 'Chinese': 'Chinesa', 'French': 'Francesa', 'American': 'Americana', 'British': 'Britânica' };
const traduzir = (texto) => TRADUCOES[texto] || texto;

function toast(msg, type=''){ const box = document.getElementById('toasts'); const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg; box.appendChild(el); setTimeout(()=>el.remove(), 3500); }
function openModal(html){ document.getElementById('modalRoot').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal-box">${html}</div></div>`; document.body.classList.add('no-scroll'); }
function closeModal(){ document.getElementById('modalRoot').innerHTML = ''; document.body.classList.remove('no-scroll'); }

async function refresh(){
  try {
    const tables = ['profiles','stores','menu_items','orders','categories'];
    const results = await Promise.all(tables.map(t => supa.from(t).select('*')));
    tables.forEach((t, i) => { db[t] = results[i].data || []; });
    
    if(!db.categories || !db.categories.length) {
      db.categories = [{id: 1, name:'Lanches'}, {id: 2, name:'Pizzas'}, {id: 3, name:'Japonesa'}, {id: 4, name:'Doces'}];
    }
  } catch(e){ console.error(e); }
  finally { render(); }
}

async function loadProfile(user){
  const { data } = await supa.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if(!data) {
    const meta = user.user_metadata || {};
    const newProfile = { id: user.id, full_name: meta.full_name || user.email.split('@')[0], role: meta.role || 'user' };
    await supa.from('profiles').insert(newProfile);
    session = newProfile;
  } else { session = data; }
  await refresh();
}

async function uploadImage(file, type) {
  if (!file) return null;
  const fileExt = file.name.split('.').pop();
  const fileName = `${Date.now()}_${type}.${fileExt}`;
  try {
    const { data, error } = await supa.storage.from('store-assets').upload(fileName, file);
    if (error) throw error;
    const { data: urlData } = supa.storage.from('store-assets').getPublicUrl(fileName);
    return urlData.publicUrl;
  } catch (err) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }
}

(async () => {
  state.cart = loadJSON('cart_v9', []);
  state.location = loadJSON('loc_v9', DEFAULT_LOC);
  const { data: { session: s } } = await supa.auth.getSession();
  if(s?.user) await loadProfile(s.user); else await refresh();
  supa.auth.onAuthStateChange(async (evt, s2) => {
    if(evt === 'SIGNED_OUT'){ session = null; state.route = 'home'; await refresh(); }
    if(s2?.user) await loadProfile(s2.user);
  });
})();

function navigate(route, params={}){ state.route = route; state.params = params; state.cartOpen = false; window.scrollTo({top:0}); render(); }

function render(){
  document.getElementById('app').innerHTML = `${Header()}<main class="main">${Route()}</main>${CartDrawer()}${state.cartOpen ? '<div class="scrim" onclick="toggleCart()"></div>' : ''}${BottomNav()}`;
  document.body.classList.toggle('on-checkout', state.route === 'checkout');
  if(state.route === 'checkout') setTimeout(initMap, 200);
  if(state.route === 'owner' && state.ownerTab === 'profile') setTimeout(initOwnerMap, 200);
}

function Route(){
  switch(state.route){
    case 'home': return HomeView();
    case 'store': return StoreView(state.params.id);
    case 'checkout': return CheckoutView();
    case 'order': return OrderView(state.params.id);
    case 'owner': return OwnerView();
    case 'admin': return AdminView();
    default: return HomeView();
  }
}

function Header(){
  const loc = state.location.confirmed ? esc(state.location.label) : 'Definir endereço';
  return `<header class="hdr"><div class="hdr-in">
    <a class="brand" onclick="navigate('home')">
      <img src="logo.png" alt="ComidaRápida PU">
    </a>
    <div class="hdr-search">
      <span>${ICON.search}</span>
      <input placeholder="Buscar comidas..." value="${esc(state.search)}" oninput="onSearch(this.value)">
    </div>
    <div class="hdr-actions">
      <button class="loc-chip" onclick="openLocModal()">${ICON.pin}<span class="loc-label">${loc}</span></button>
      ${session && session.role === 'owner' ? `<button class="btn btn-ghost btn-sm desk-only" onclick="navigate('owner')" style="color:var(--primary);">${ICON.store} Painel</button>` : ''}
      ${session && session.role === 'admin' ? `<button class="btn btn-ghost btn-sm desk-only" onclick="navigate('admin')" style="color:var(--primary);">${ICON.db} Admin</button>` : ''}
      <button class="btn-cart" onclick="toggleCart()">${ICON.cart}${state.cart.length ? `<span class="cart-count">${state.cart.reduce((s,c)=>s+c.quantity,0)}</span>` : ''}</button>
      ${session ? `<button class="btn btn-ghost btn-sm desk-only" onclick="supa.auth.signOut()">Sair</button>` : `<button class="btn btn-primary btn-sm desk-only" onclick="openAuth()">Entrar</button>`}
    </div>
  </div></header>`;
}

function BottomNav(){
  const n = state.cart.reduce((s,c)=>s+c.quantity,0);
  return `<nav class="bnav">
    <a class="${state.route==='home'?'on':''}" onclick="navigate('home')">${ICON.home}<span>Início</span></a>
    <a onclick="focusSearch()">${ICON.search}<span>Buscar</span></a>
    <a class="${state.cartOpen?'on':''}" onclick="toggleCart()">${ICON.cart}${n ? `<i class="bn-badge">${n}</i>` : ''}<span>Carrinho</span></a>
    <a onclick="openAccount()">${ICON.user}<span>${session ? 'Conta' : 'Entrar'}</span></a>
  </nav>`;
}

function openAccount(){
  if(!session){ openAuth(); return; }
  const go = r => `closeModal();navigate('${r}')`;
  openModal(`<h3 style="font-size:22px;">Olá, ${esc(session.full_name.split(' ')[0])}</h3>
    <p class="small muted" style="margin-bottom:20px;">${session.role==='owner' ? 'Lojista' : session.role==='admin' ? 'Administrador' : 'Cliente'}</p>
    <div class="sheet-list" style="display:flex; flex-direction:column; gap:8px;">
      <button class="btn btn-ghost" style="justify-content:flex-start;" onclick="closeModal();openLocModal()">${ICON.pin} Meu endereço de entrega</button>
      ${session.role==='owner' ? `<button class="btn btn-ghost" style="justify-content:flex-start;" onclick="${go('minha-loja')}">${ICON.store} Minha Loja</button>` : ''}
      ${session.role==='owner' ? `<button class="btn btn-ghost" style="justify-content:flex-start;" onclick="${go('owner')}">${ICON.chart} Painel do Lojista</button>` : ''}
      ${session.role==='admin' ? `<button class="btn btn-ghost" style="justify-content:flex-start;" onclick="${go('admin')}">${ICON.db} Admin</button>` : ''}
      <button class="btn btn-ghost" style="justify-content:flex-start; color:var(--primary);" onclick="closeModal();supa.auth.signOut()">Sair</button>
    </div>`);
}

function filteredStores(){
  let stores = db.stores;
  if(state.search) { const q = norm(state.search); stores = stores.filter(s => norm(s.name).includes(q)); }
  if(state.category !== 'all') { const catObj = db.categories.find(c => c.name === state.category); if(catObj) stores = stores.filter(s => s.category_id === catObj.id); }
  return stores;
}
const storesHTML = () => { const l = filteredStores(); return l.length ? l.map(StoreCard).join('') : '<p class="muted">Nenhuma loja encontrada.</p>'; };
function setCat(i){ state.category = i < 0 ? 'all' : db.categories[i].name; render(); }
function onSearch(v){
  state.search = v;
  if(state.route !== 'home'){ state.route = 'home'; render(); focusSearch(true); return; }
  const g = document.getElementById('storesGrid'); if(g) g.innerHTML = storesHTML();
}
function focusSearch(keep){
  if(!keep && state.route !== 'home'){ state.route = 'home'; state.cartOpen = false; render(); }
  const i = document.querySelector('.hdr-search input');
  if(i){ i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch(e){} }
  window.scrollTo({ top:0, behavior:'smooth' });
}

function HomeView(){
  return `<div class="hero-banner"><h1>O sabor da nossa região, entregue na sua porta.</h1><p>Escolha um prato. A gente leva até você.</p></div>
  <div class="cats"><div class="cat-pill ${state.category==='all'?'active':''}" onclick="setCat(-1)"><span>✨</span> Todos</div>${db.categories.map((c,i) => `<div class="cat-pill ${state.category===c.name?'active':''}" onclick="setCat(${i})"><span>🍽️</span> ${esc(c.name)}</div>`).join('')}</div>
  <h2 style="margin-bottom:24px; font-size:24px;">Restaurantes em destaque</h2>
  <div class="stores-grid" id="storesGrid">${storesHTML()}</div>`;
}

function StoreCard(s){
  const localRevs = getLocalReviews().filter(r=>r.store_id==s.id);
  const rating = localRevs.length ? (localRevs.reduce((a,b)=>a+b.rating,0)/localRevs.length).toFixed(1) : 'Novo';
  const catObj = db.categories.find(c => c.id === s.category_id);
  const profiles = getStoreProfiles();
  const p = profiles[s.id] || {};
  const logo = p.logo ? `<img src="${p.logo}">` : '🏪';

  return `<div class="store-card" onclick="navigate('store',{id:'${s.id}'})">
    <div class="store-img">${logo}</div>
    <div class="store-info"><h3>${esc(s.name)}</h3><p class="small muted">${esc(catObj ? catObj.name : 'Geral')}</p>
    <div class="store-meta"><span class="rating">${ICON.star} ${rating}</span><span>${ICON.clock} ${cardInfo(s)}</span></div></div>
  </div>`;
}

function StoreView(id){
  const s = db.stores.find(x=>x.id==id); if(!s) return 'Loja não encontrada';
  const items = db.menu_items.filter(m=>m.store_id==s.id);
  const profiles = getStoreProfiles();
  const p = profiles[s.id] || {};
  const logo = p.logo ? `<img src="${p.logo}" style="width:100%;height:100%;object-fit:cover;border-radius:24px;">` : '🏪';

  return `<button class="btn btn-ghost btn-sm" style="margin-bottom:24px" onclick="navigate('home')">← Voltar</button>
  <div class="store-banner" style="background:#fff; padding:32px; border-radius:20px; box-shadow:var(--sh); display:flex; gap:24px; align-items:center; margin-bottom:32px;"><div class="store-logo" style="width:100px; height:100px; border-radius:24px; background:#F0F0F0; display:grid; place-items:center; font-size:48px; overflow:hidden;">${logo}</div><div><h1 style="font-size:28px; margin-bottom:8px; font-family:'Montserrat';">${esc(s.name)}</h1><p class="muted" style="font-weight:500;">${esc(p.description || 'Confira nosso cardápio.')}</p></div></div>
  <div class="prods-grid">${items.map(i => {
      const parsed = parseItemImage(i.description);
      const img = parsed.img || (typeof getImagemComida === 'function' ? getImagemComida(i.id, i.name) : '🍽️');
      return `<div class="card-item" style="cursor:default;">
        <div class="card-img">${img.startsWith('http') ? `<img src="${esc(img)}">` : img}</div>
        <div class="card-info"><h4>${esc(i.name)}</h4><p class="small muted">${esc(parsed.text)}</p>
        <div class="card-footer">
          <strong>${money(i.price)}</strong>
          ${i.is_available !== false ? `<button class="btn btn-primary btn-sm" style="border-radius:99px;" onclick="addToCart('${i.id}')">Adicionar</button>` : `<span class="small muted" style="font-weight:800;">Indisponível</span>`}
        </div>
        </div></div>`;
    }).join('')}</div>`;
}

function addToCart(id){
  const item = db.menu_items.find(m=>m.id==id); if(!item) return;
  if(state.cart.length && state.cart[0].store_id != item.store_id) { if(!confirm('Limpar carrinho anterior?')) return; state.cart=[]; }
  const existing = state.cart.find(c=>c.menu_item_id==id);
  if(existing) existing.quantity++; else state.cart.push({menu_item_id:id, store_id:item.store_id, quantity:1});
  localStorage.setItem('cart_v9', JSON.stringify(state.cart)); toast(item.name + ' adicionado!'); render();
}

function toggleCart(){ state.cartOpen = !state.cartOpen; render(); }

function CartDrawer(){
  const total = state.cart.reduce((s,c)=>{ const it = db.menu_items.find(m=>m.id==c.menu_item_id); return s + (it?it.price*c.quantity:0); },0);
  return `<aside class="drawer ${state.cartOpen?'open':''}">
    <div class="drawer-header"><h3 style="font-size:20px;">Seu Carrinho</h3><button onclick="toggleCart()">${ICON.x}</button></div>
    <div class="drawer-content">${state.cart.length ? state.cart.map(c => { 
      const it = db.menu_items.find(m=>m.id==c.menu_item_id); if(!it) return ''; 
      const parsed = parseItemImage(it.description);
      return `<div class="cart-item" style="display:flex; gap:16px; padding:16px 0; border-bottom:1px solid #eee;"><div class="cart-item-img" style="width:56px; height:56px; border-radius:10px; background:#F0F0F0; display:grid; place-items:center; font-size:28px; overflow:hidden;">${parsed.img ? `<img src="${esc(parsed.img)}">` : '🍽️'}</div><div style="flex:1"><strong>${esc(it.name)}</strong><div class="small muted">${money(it.price)}</div></div><div class="qty-ctrl" style="display:flex; align-items:center; gap:12px; background:#F0F0F0; padding:6px 12px; border-radius:99px; font-weight:800; font-size:14px;"><button onclick="decQty('${it.id}')">-</button>${c.quantity}<button onclick="addToCart('${it.id}')">+</button></div></div>`; 
    }).join('') : '<p class="muted" style="text-align:center;padding:40px 0;font-weight:600;">Carrinho vazio</p>'}</div>
    ${state.cart.length ? `<div class="drawer-footer"><div class="fee-row total" style="display:flex; justify-content:space-between; font-weight:800; font-size:20px;"><span>Subtotal</span><span>${money(total)}</span></div><button class="btn btn-primary btn-block" style="margin-top:20px" onclick="navigate('checkout')">Continuar para Entrega</button></div>` : ''}
  </aside>`;
}

function decQty(id){
  const l = state.cart.find(c=>c.menu_item_id==id);
  if(l) { l.quantity--; if(l.quantity<=0) state.cart = state.cart.filter(c=>c.menu_item_id!=id); localStorage.setItem('cart_v9', JSON.stringify(state.cart)); render(); }
}

function CheckoutView(){
  const store = db.stores.find(s=>s.id==state.cart[0]?.store_id); if(!store) return '<p class="muted">Carrinho vazio</p>';
  const sub = state.cart.reduce((s,c)=>{ const it = db.menu_items.find(m=>m.id==c.menu_item_id); return s + (it?it.price*c.quantity:0); },0);
  const hasLoc = !!state.location.confirmed;
  const q = hasLoc ? ensureQuote(store) : null;
  const ok = !!q && q.status === 'ok';
  const base = store.delivery_fee == null ? 5 : Number(store.delivery_fee);
  const extraKm = ok ? Math.max(0, q.km - TAXA.kmIncluso) : 0;
  const total = ok ? sub + q.fee : null;
  const btn = `onclick="finishOrder('${store.id}')" ${ok ? '' : 'disabled'}`;

  let feeBox;
  if(!hasLoc) feeBox = `<div class="notice" style="background:#FFF3E0; color:#E65100; padding:14px; border-radius:10px; font-weight:700; margin-bottom:12px;">Defina seu endereço para calcular a taxa de entrega.</div><button class="btn btn-primary btn-block" onclick="openLocModal()">Definir endereço</button>`;
  else if(q.status === 'loading') feeBox = `<div class="fee-highlight" style="background:#F0F0F0; text-align:center; padding:24px; border-radius:16px; margin:24px 0;"><span>Taxa de Entrega</span><strong style="font-size:36px;">...</strong><div class="tiny muted" style="margin-top:8px;">Calculando a rota</div></div>`;
  else if(q.status === 'out') feeBox = `<div class="notice err" style="background:#FFEBEE; color:#D32F2F; padding:14px; border-radius:10px; font-weight:700; margin-bottom:12px;">Seu endereço está a ${String(q.km).replace('.',',')} km, fora da área de entrega (máx. ${TAXA.maxKm} km).</div>`;
  else feeBox = `<div class="fee-highlight" style="background:rgba(211,47,47,0.05); border:2px solid var(--primary); text-align:center; padding:24px; border-radius:16px; margin:24px 0;"><span style="display:block; font-size:14px; font-weight:800; color:var(--primary); text-transform:uppercase;">Taxa de Entrega</span><strong style="font-size:36px; color:var(--primary);">${money(q.fee)}</strong><div class="tiny muted" style="margin-top:8px;">Base ${money(base)} (até ${TAXA.kmIncluso} km)${extraKm > 0 ? ` + ${extraKm.toFixed(1).replace('.',',')} km × ${money(TAXA.porKm)}` : ''}</div></div>`;

  return `<h2 style="font-size:28px; margin-bottom:24px;">Finalizar Pedido</h2>
  <div class="checkout-grid" style="display:grid; grid-template-columns:1fr 420px; gap:32px; align-items:start;">
    <div>
      <div class="checkout-card" style="background:#fff; padding:32px; border-radius:20px; box-shadow:var(--sh); margin-bottom:24px;"><h3>${ICON.pin} Endereço de Entrega</h3>
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; background:#F5F5F5; padding:16px; border-radius:12px;">
          <div style="min-width:0;"><strong style="font-size:16px; display:block; margin-bottom:4px; overflow-wrap:anywhere;">${hasLoc ? esc(state.location.label) : 'Nenhum endereço definido'}</strong><span class="small muted">Entregar neste local</span></div>
          <button class="btn btn-ghost btn-sm" onclick="openLocModal()">${hasLoc ? 'Alterar' : 'Definir'}</button>
        </div>
      </div>
      <div class="checkout-card" style="background:#fff; padding:32px; border-radius:20px; box-shadow:var(--sh); margin-bottom:24px;"><h3>Rota até você</h3><div id="map" style="height:260px; border-radius:16px; background:#F0F0F0; margin-bottom:16px;"></div><p class="small muted" style="font-weight:600; margin-top:12px; text-align:center;">Restaurante <strong>${esc(store.name)}</strong> ➔ Sua localização</p>
        ${ok && !q.exact ? '<p class="small" style="color:#E65100; margin-top:8px; text-align:center;">A loja ainda não definiu sua localização exata: distância aproximada.</p>' : ''}
        ${ok && q.source === 'estimativa' ? '<p class="small" style="color:#E65100; margin-top:8px; text-align:center;">Serviço de rotas indisponível: usando distância estimada.</p>' : ''}</div>
      <div class="delivery-stats" style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px;"><div class="stat-box" style="background:#F5F5F5; padding:16px; border-radius:12px; text-align:center;"><div class="label" style="font-size:12px; font-weight:700; color:#666; text-transform:uppercase;">Distância</div><div class="val" style="font-size:18px; font-weight:800;">${ok ? String(q.km).replace('.',',') + ' km' : '—'}</div></div><div class="stat-box" style="background:#F5F5F5; padding:16px; border-radius:12px; text-align:center;"><div class="label" style="font-size:12px; font-weight:700; color:#666; text-transform:uppercase;">Tempo Estimado</div><div class="val" style="font-size:18px; font-weight:800;">${ok ? (TAXA.preparoMin + q.min) + ' min' : '—'}</div></div></div>
      <div class="checkout-card" style="background:#fff; padding:32px; border-radius:20px; box-shadow:var(--sh); margin-bottom:24px;"><h3>Forma de Pagamento</h3><div class="input-group" style="margin:0;"><select id="paySelect" onchange="state.pay=this.value" style="width:100%; padding:14px; border-radius:10px; border:1px solid #ddd; background:#FAFAFA;">${[['pix','Pix (Aprovação imediata)'],['credit','Cartão de Crédito na entrega'],['cash','Dinheiro']].map(([v,l]) => `<option value="${v}" ${(state.pay||'pix')===v?'selected':''}>${l}</option>`).join('')}</select></div></div>
    </div>
    <div>
      <div class="checkout-card" style="position:sticky;top:100px; padding:24px; background:#fff; border-radius:20px; box-shadow:var(--sh);">
        <h3>Resumo do Pedido</h3>
        ${state.cart.map(c=>{const it = db.menu_items.find(m=>m.id==c.menu_item_id); return it ? `<div class="fee-row" style="font-size:14px; padding:8px 0; display:flex; justify-content:space-between;"><span>${c.quantity}x ${esc(it.name)}</span><span>${money(it.price*c.quantity)}</span></div>` : '';}).join('')}
        <div class="fee-row" style="border-top:1px solid #ddd; margin-top:12px; padding-top:16px; display:flex; justify-content:space-between;"><span>Subtotal</span><span>${money(sub)}</span></div>
        ${feeBox}
        <div class="fee-row total" style="border-top:2px dashed #ddd; margin-top:12px; padding-top:20px; font-size:24px; font-weight:800; display:flex; justify-content:space-between;"><span>Total</span><span style="color:var(--primary);">${total != null ? money(total) : '—'}</span></div>
        <button class="btn btn-primary btn-block desk-btn" style="margin-top:24px; font-size:18px; padding:18px;" ${btn}>Confirmar Pedido</button>
      </div>
    </div>
  </div>
  <div class="checkout-bar" style="display:none;"><div><span class="small muted" style="display:block;">Total</span><strong style="font-size:20px;">${total != null ? money(total) : '—'}</strong></div><button class="btn btn-primary" style="flex:1;" ${btn}>Confirmar Pedido</button></div>`;
}

function initMap(){
  if(currentMap) { currentMap.remove(); currentMap = null; }
  const el = document.getElementById('map'); if(!el) return;
  const store = db.stores.find(s=>s.id==state.cart[0]?.store_id); if(!store) return;
  const a = getStoreCoords(store), b = state.location, q = state.quote;
  const center = coordOk(Number(b.lat), Number(b.lng)) ? [b.lat, b.lng] : [a.lat, a.lng];
  currentMap = L.map('map', { zoomControl:false, dragging:!L.Browser.mobile }).setView(center, 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(currentMap);
  L.marker([a.lat, a.lng], {icon:L.divIcon({html:'<div style="font-size:28px;">🏪</div>', className:'', iconSize:[30,30]})}).addTo(currentMap).bindPopup(store.name);
  if(!state.location.confirmed) return;
  L.marker([b.lat, b.lng], {icon:L.divIcon({html:'<div style="font-size:28px;">📍</div>', className:'', iconSize:[30,30]})}).addTo(currentMap).bindPopup('Você');
  const line = q && q.coords ? q.coords : [[a.lat, a.lng], [b.lat, b.lng]];
  L.polyline(line, q && q.coords ? {color:'#D32F2F', weight:5} : {color:'#D32F2F', weight:5, dashArray:'1, 10'}).addTo(currentMap);
  currentMap.fitBounds(line, {padding:[40,40]});
}

async function finishOrder(storeId){
  if(state.ordering) return;
  if(!session) { openAuth(); return; }
  const store = db.stores.find(s => s.id == storeId); if(!store) return;
  if(!state.location.confirmed){ openLocModal(); return; }
  const q = state.quote;
  if(!q || q.status !== 'ok' || q.key !== quoteKey(store)){ toast('Aguarde o cálculo da entrega.', 'error'); return; }

  const fee = calcFee(store, q.km);
  const sub = state.cart.reduce((s,c)=>{ const it = db.menu_items.find(m=>m.id==c.menu_item_id); return s + (it?it.price*c.quantity:0); },0);
  state.ordering = true;
  try {
    const { data: order, error: oErr } = await supa.from('orders').insert({ user_id: session.id, store_id: storeId, total_price: Math.round((sub + fee) * 100) / 100 }).select().single();
    if(oErr) throw oErr;
    saveLocalOrder(order.id, { status:'pending', items:state.cart, store_id:storeId, delivery_address:state.location.label, delivery_lat:state.location.lat, delivery_lng:state.location.lng, distance_km:q.km, delivery_fee:fee, subtotal:sub, payment_method:state.pay || 'pix' });
    state.cart = []; state.quote = null; localStorage.removeItem('cart_v9'); toast('Pedido confirmado!'); navigate('order', {id:order.id});
  } catch(e){ toast('Erro: '+e.message, 'error'); }
  finally { state.ordering = false; }
}

function OrderView(id){
  const o = db.orders.find(x=>x.id==id); if(!o) return 'Pedido não encontrado';
  const local = getLocalOrders()[id] || { status: 'pending', items: [] };
  const steps = [{k:'pending', l:'Pedido Recebido'},{k:'preparing', l:'Em Preparação'},{k:'delivering', l:'Saiu para Entrega'},{k:'delivered', l:'Entregue'}];
  let idx = steps.findIndex(s=>s.k === local.status) > -1 ? steps.findIndex(s=>s.k === local.status) : 0;

  return `<div style="max-width:600px; margin:0 auto;"><div class="checkout-card" style="padding:40px; background:#fff; border-radius:20px; box-shadow:var(--sh);">
    <h2 style="text-align:center; margin-bottom:8px;">Acompanhe seu pedido</h2><p class="small muted" style="text-align:center; margin-bottom:32px;">#${o.id.toString().padStart(4, '0')}</p>
    <div class="timeline" style="display:flex; flex-direction:column; gap:0;">${steps.map((s,i)=>`<div class="tl-step ${i<idx?'done':''} ${i===idx?'current':''}" style="display:flex; gap:20px; padding-bottom:32px; position:relative;"><div class="tl-dot" style="width:36px; height:36px; border-radius:50%; background:${i<idx?'var(--primary)':i===idx?'var(--primary)':'#F0F0F0'}; color:${i<=idx?'#fff':'#666'}; display:grid; place-items:center; font-size:14px; font-weight:800; z-index:1;">${i<idx?'✓':i+1}</div><div><strong style="font-size:16px; display:block;">${s.l}</strong></div></div>`).join('')}</div>
    
    ${local.distance_km != null ? `<div style="margin-top:24px; background:#F5F5F5; border-radius:16px; padding:16px; font-size:14px; font-weight:600;"><div>📍 ${esc(local.delivery_address)}</div><div class="muted" style="margin-top:6px;">${String(local.distance_km).replace('.',',')} km, taxa de entrega ${money(local.delivery_fee)}</div></div>` : ''}
    <div style="text-align:center; margin-top:32px;"><button class="btn btn-ghost" onclick="navigate('home')">Voltar para a Loja</button></div>
  </div></div>`;
}

function OwnerView(){
  if(!session || session.role !== 'owner') return 'Acesso restrito.';
  
  const store = db.stores.find(s => s.owner_id === session.id);
  const profiles = getStoreProfiles();
  const p = store ? (profiles[store.id] || {}) : {};

  if(!store) {
    return `<div class="owner-main" style="max-width:700px; margin:0 auto;">
      <div class="owner-header"><h1>Cadastre sua Loja</h1></div>
      <form id="storeForm">
        <div class="form-section">
          <h3>Informações Básicas</h3>
          <div class="input-group"><label>Nome da Loja *</label><input name="name" required placeholder="Ex: Pizzaria Bella Massa"></div>
          <div class="grid-2">
            <div class="input-group"><label>Categoria *</label>
              <select name="category_id" required>${db.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
            </div>
            <div class="input-group"><label>Taxa de Entrega Base (R$) *</label><input name="delivery_fee" type="number" step="0.01" required value="5.00"></div>
          </div>
        </div>
        <div class="form-section">
          <h3>Contato e Endereço</h3>
          <div class="grid-2">
            <div class="input-group"><label>Telefone</label><input name="phone" placeholder="(00) 00000-0000"></div>
            <div class="input-group"><label>CEP</label><input name="cep" placeholder="00000-000"></div>
          </div>
          <div class="input-group"><label>Endereço Completo</label><input name="address" placeholder="Rua, Número, Bairro"></div>
        </div>
        <button type="submit" class="btn btn-primary btn-block" style="font-size:18px; padding:18px;">Criar Loja</button>
      </form>
    </div>`;
  }

  return `<div class="owner-layout">
    <aside class="owner-sidebar">
      <div style="margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid #eee;">
        <strong style="display:block; font-size:18px;">${esc(store.name)}</strong>
        <span class="small muted">Lojista</span>
      </div>
      <a class="${state.ownerTab==='dashboard'?'active':''}" onclick="state.ownerTab='dashboard';render()">${ICON.chart} Visão Geral</a>
      <a class="${state.ownerTab==='orders'?'active':''}" onclick="state.ownerTab='orders';render()">📦 Pedidos (KDS)</a>
      <a class="${state.ownerTab==='profile'?'active':''}" onclick="state.ownerTab='profile';render()">${ICON.store} Perfil da Loja</a>
      <a class="${state.ownerTab==='products'?'active':''}" onclick="state.ownerTab='products';render()">🍽️ Cardápio</a>
      <hr style="border:none; border-top:1px solid #eee; margin:12px 0;">
      <a onclick="openClientPreview('${store.id}')" style="color:var(--primary);">${ICON.eye} Visualizar Loja</a>
    </aside>

    <div class="owner-main">
      ${state.ownerTab === 'dashboard' ? renderOwnerDashboard(store) : ''}
      ${state.ownerTab === 'orders' ? renderOwnerOrders(store) : ''}
      ${state.ownerTab === 'profile' ? renderStoreProfileForm(store, p) : ''}
      ${state.ownerTab === 'products' ? renderOwnerProducts(store) : ''}
    </div>
  </div>`;
}

function renderOwnerDashboard(store) {
  const storeOrders = db.orders.filter(o => o.store_id === store.id);
  const totalRevenue = storeOrders.reduce((s,o) => s + Number(o.total_price), 0);
  const totalOrders = storeOrders.length;
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  return `<div class="owner-header">
    <h1>Visão Geral</h1>
    <span class="${isStoreOpen(store.id) ? 'badge-open' : 'badge-closed'}" style="padding:6px 12px; border-radius:99px; font-weight:800; font-size:12px; background:${isStoreOpen(store.id)?'#E8F5E9':'#FFEBEE'}; color:${isStoreOpen(store.id)?'#059669':'#D32F2F'};">
      ${isStoreOpen(store.id) ? '🟢 Loja Aberta Agora' : '🔴 Loja Fechada'}
    </span>
  </div>

  <div class="kpi-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:16px; margin-bottom:24px;">
    <div class="kpi-card" style="background:#F5F5F5; padding:24px; border-radius:16px; border:1px solid #eee; text-align:left;">
      <h4 style="font-size:12px; color:#666; text-transform:uppercase; margin-bottom:8px; font-weight:700;">Faturamento Total</h4>
      <div class="val" style="font-size:28px; font-weight:800; color:#059669;">${money(totalRevenue)}</div>
    </div>
    <div class="kpi-card" style="background:#F5F5F5; padding:24px; border-radius:16px; border:1px solid #eee; text-align:left;">
      <h4 style="font-size:12px; color:#666; text-transform:uppercase; margin-bottom:8px; font-weight:700;">Total de Pedidos</h4>
      <div class="val" style="font-size:28px; font-weight:800; color:#212121;">${totalOrders}</div>
    </div>
    <div class="kpi-card" style="background:#F5F5F5; padding:24px; border-radius:16px; border:1px solid #eee; text-align:left;">
      <h4 style="font-size:12px; color:#666; text-transform:uppercase; margin-bottom:8px; font-weight:700;">Ticket Médio</h4>
      <div class="val" style="font-size:28px; font-weight:800; color:#212121;">${money(avgTicket)}</div>
    </div>
  </div>

  ${topProdutosHTML(store)}`;
}

function isStoreOpen(storeId) {
  const profiles = getStoreProfiles();
  const p = profiles[storeId] || {};
  if(p.status === 'closed') return false;
  
  if(p.hours) {
    const now = new Date();
    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const today = dayNames[now.getDay()];
    const schedule = p.hours[today];
    
    if(schedule && schedule.active) {
      const currentTime = now.getHours() * 60 + now.getMinutes();
      const [openH, openM] = schedule.open.split(':').map(Number);
      const [closeH, closeM] = schedule.close.split(':').map(Number);
      const openTime = openH * 60 + openM;
      const closeTime = closeH * 60 + closeM;
      
      if (currentTime >= openTime && currentTime <= closeTime) return true;
      return false;
    }
  }
  return true;
}

function renderOwnerOrders(store) {
  const orders = db.orders.filter(o => o.store_id == store.id).reverse();
  
  return `<div class="owner-header"><h1>Painel de Cozinha (KDS)</h1></div>
  ${orders.length ? orders.map(o => {
    const local = getLocalOrders()[o.id] || { status: 'pending' };
    const st = local.status;
    
    let badgeColor = '#FFF8E1', textColor = '#D97706';
    if(st === 'preparing') { badgeColor = '#2563EB'; textColor = '#fff'; }
    if(st === 'delivering') { badgeColor = 'rgba(211,47,47,0.1)'; textColor = '#D32F2F'; }
    if(st === 'delivered') { badgeColor = '#E8F5E9'; textColor = '#059669'; }

    let actions = '';
    if(st === 'pending') {
      actions = `<div class="order-actions" style="display:flex; gap:8px; margin-top:12px;">
        <button class="btn-accept" style="background:#059669; color:#fff; padding:10px; border-radius:10px; font-weight:bold; flex:1;" onclick="updateOrderStatus('${o.id}', 'preparing')">✓ Aceitar Pedido</button>
        <button class="btn-reject" style="background:#FFEBEE; color:#D32F2F; padding:10px; border-radius:10px; font-weight:bold; flex:1;" onclick="updateOrderStatus('${o.id}', 'canceled')">✕ Recusar</button>
      </div>`;
    } else if(st === 'preparing') {
      actions = `<div class="order-actions" style="display:flex; gap:8px; margin-top:12px;"><button class="btn-dispatch" style="background:#2563EB; color:#fff; padding:10px; border-radius:10px; font-weight:bold; flex:1;" onclick="updateOrderStatus('${o.id}', 'delivering')">🛵 Despachar para Entrega</button></div>`;
    } else if(st === 'delivering') {
      actions = `<div class="order-actions" style="display:flex; gap:8px; margin-top:12px;"><button class="btn-accept" style="background:#059669; color:#fff; padding:10px; border-radius:10px; font-weight:bold; flex:1;" onclick="updateOrderStatus('${o.id}', 'delivered')">✓ Marcar como Entregue</button></div>`;
    }

    return `<div class="order-card" style="background:#fff; border-radius:16px; padding:16px; margin-bottom:16px; border:1px solid #eee; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
      <div class="order-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #eee; padding-bottom:8px;">
        <strong style="font-size:18px;">Pedido #${o.id.toString().padStart(4, '0')}</strong>
        <span style="background:${badgeColor}; color:${textColor}; padding:6px 12px; border-radius:6px; font-weight:800; font-size:12px;">${st.toUpperCase()}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <span class="small muted">Horário:</span>
        <strong class="small">${new Date(o.created_at).toLocaleTimeString('pt-BR')}</strong>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span class="small muted">Total:</span>
        <strong>${money(o.total_price)}</strong>
      </div>
      ${local.delivery_address ? `<div class="small muted" style="margin-top:10px;">📍 ${esc(local.delivery_address)}${local.distance_km != null ? ' (' + String(local.distance_km).replace('.',',') + ' km)' : ''}</div>` : ''}
      ${actions}
    </div>`;
  }).join('') : '<p class="small muted">Nenhum pedido recebido ainda.</p>'}`;
}

function updateOrderStatus(orderId, newStatus) {
  const local = getLocalOrders();
  if(!local[orderId]) local[orderId] = { items: [] };
  local[orderId].status = newStatus;
  localStorage.setItem('local_orders', JSON.stringify(local));
  toast('Status do pedido atualizado!');
  render();
}

function renderStoreProfileForm(store, p) {
  const isOpen = p.status === 'open';
  const days = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  const hours = p.hours || {};
  
  return `<div class="owner-header">
    <h1>Perfil do Estabelecimento</h1>
    <span class="${isOpen ? 'badge-open' : 'badge-closed'}" style="padding:6px 12px; border-radius:99px; font-weight:800; font-size:12px; background:${isOpen?'#E8F5E9':'#FFEBEE'}; color:${isOpen?'#059669':'#D32F2F'};">${isOpen ? '🟢 Forçar Aberto' : '🔴 Forçar Fechado'}</span>
  </div>

  <form id="editStoreForm" data-id="${store.id}">
    <div class="form-section">
      <h3>Informações Básicas</h3>
      <div class="input-group"><label>Nome da Loja *</label><input name="name" required value="${esc(store.name)}"></div>
      <div class="grid-2" style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="input-group"><label>Categoria *</label>
          <select name="category_id" required>${db.categories.map(c => `<option value="${c.id}" ${c.id===store.category_id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
        </div>
        <div class="input-group"><label>Taxa de Entrega Base (R$) *</label><input name="delivery_fee" type="number" step="0.01" required value="${store.delivery_fee || 5}"></div>
      </div>
      <div class="input-group"><label>Descrição</label><textarea name="description" rows="3">${esc(p.description || '')}</textarea></div>
    </div>

    <div class="form-section">
      <h3>Imagens</h3>
      <div class="grid-2" style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div>
          <label class="small muted" style="display:block; margin-bottom:8px; font-weight:700;">Logotipo</label>
          <div class="image-upload ${p.logo ? 'has-img' : ''}" id="logoPreviewBox" style="border:2px dashed #ddd; border-radius:16px; padding:24px; text-align:center; cursor:pointer; position:relative; overflow:hidden; background:#F5F5F5; min-height:120px; display:flex; flex-direction:column; align-items:center; justify-content:center;">
            ${p.logo ? `<img src="${p.logo}" id="logoImg" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">` : `<span style="font-size:24px; margin-bottom:8px;">📸</span><span class="small">Clique para trocar</span>`}
            <input type="file" accept="image/*" onchange="handleImageUpload(this, 'logo')" style="position:absolute;inset:0;opacity:0;cursor:pointer;">
          </div>
        </div>
        <div>
          <label class="small muted" style="display:block; margin-bottom:8px; font-weight:700;">Imagem de Capa</label>
          <div class="image-upload ${p.cover ? 'has-img' : ''}" id="coverPreviewBox" style="border:2px dashed #ddd; border-radius:16px; padding:24px; text-align:center; cursor:pointer; position:relative; overflow:hidden; background:#F5F5F5; min-height:120px; display:flex; flex-direction:column; align-items:center; justify-content:center;">
            ${p.cover ? `<img src="${p.cover}" id="coverImg" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">` : `<span style="font-size:24px; margin-bottom:8px;">🖼️</span><span class="small">Clique para trocar</span>`}
            <input type="file" accept="image/*" onchange="handleImageUpload(this, 'cover')" style="position:absolute;inset:0;opacity:0;cursor:pointer;">
          </div>
        </div>
      </div>
    </div>

    <div class="form-section">
      <h3>Contato e Endereço</h3>
      <div class="grid-2" style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="input-group"><label>Telefone / WhatsApp</label><input name="phone" value="${esc(p.phone || '')}"></div>
        <div class="input-group">
          <label>CEP (Busca Automática)</label>
          <input name="cep" id="cepInput" value="${esc(p.cep || '')}" oninput="maskCEP(this)" onblur="buscarCEP(this.value)">
        </div>
      </div>
      <div class="input-group"><label>Endereço Completo</label><input name="address" id="addressInput" value="${esc(p.address || '')}"></div>
      <div class="grid-3" style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px;">
        <div class="input-group"><label>Cidade</label><input name="city" id="cityInput" value="${esc(p.city || 'Porto União')}"></div>
        <div class="input-group"><label>Estado</label><input name="state" id="stateInput" value="${esc(p.state || 'SC')}" maxlength="2"></div>
        <div class="input-group"><label>Preparo Médio (min)</label><input name="prep_time" type="number" value="${p.prep_time || 30}"></div>
      </div>
      <div class="input-group">
        <label>Localização no Mapa (Clique para ajustar)</label>
        <div id="ownerMap" style="height:200px; border-radius:16px; border:1px solid #ddd; z-index:1; margin-top:12px;"></div>
        <input type="hidden" name="lat" id="storeLat" value="${p.lat || storeCoords.lat}">
        <input type="hidden" name="lng" id="storeLng" value="${p.lng || storeCoords.lng}">
      </div>
    </div>

    <div class="form-section">
      <h3>Horário de Funcionamento</h3>
      <div style="display:grid; gap:8px;">
        ${days.map(d => {
          const h = hours[d] || { open: '18:00', close: '23:00', active: false };
          return `<div class="hours-grid" style="display:grid; grid-template-columns:100px 1fr 1fr; gap:12px; align-items:center; margin-bottom:8px;">
            <label><input type="checkbox" name="active_${d}" ${h.active?'checked':''}> ${d}</label>
            <input type="time" name="open_${d}" value="${h.open}">
            <input type="time" name="close_${d}" value="${h.close}">
          </div>`;
        }).join('')}
      </div>
      <div class="input-group" style="margin-top:16px;">
        <label>Status Manual (Forçar Fechamento)</label>
        <select name="status">
          <option value="open" ${p.status==='open'?'selected':''}>Automático (Aberto)</option>
          <option value="closed" ${p.status==='closed'?'selected':''}>Forçar Fechado</option>
        </select>
      </div>
    </div>

    <button type="submit" class="btn btn-primary btn-block" style="font-size:18px; padding:18px;">Salvar Alterações</button>
  </form>`;
}

function initOwnerMap() {
  if(ownerMap) { ownerMap.remove(); ownerMap = null; }
  const el = document.getElementById('ownerMap'); if(!el) return;
  
  const lat = Number(document.getElementById('storeLat').value) || DEFAULT_LOC.lat;
  const lng = Number(document.getElementById('storeLng').value) || DEFAULT_LOC.lng;
  
  ownerMap = L.map('ownerMap').setView([lat, lng], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(ownerMap);
  
  const marker = L.marker([lat, lng], {draggable: true}).addTo(ownerMap);
  
  marker.on('dragend', function(e) {
    const pos = marker.getLatLng();
    document.getElementById('storeLat').value = pos.lat;
    document.getElementById('storeLng').value = pos.lng;
  });

  ownerMap.on('click', function(e) {
    marker.setLatLng(e.latlng);
    document.getElementById('storeLat').value = e.latlng.lat;
    document.getElementById('storeLng').value = e.latlng.lng;
  });
}

function renderOwnerProducts(store) {
  const items = db.menu_items.filter(m => m.store_id == store.id);
  return `<div class="owner-header"><h1>Cardápio</h1><button class="btn btn-primary btn-sm" onclick="openImportModal()">${ICON.web} Importar Receita</button></div>
  <div class="prods-grid" style="grid-template-columns:1fr; gap:12px;">
    ${items.length ? items.map(i => {
      const parsed = parseItemImage(i.description);
      return `<div class="prod-card" style="padding:12px; background:#fff; border-radius:16px; box-shadow:0 2px 8px rgba(0,0,0,0.05); display:flex; gap:16px;">
        <div class="prod-img" style="width:60px; height:60px; font-size:24px; border-radius:12px; background:#F0F0F0; overflow:hidden;">${parsed.img ? `<img src="${esc(parsed.img)}" style="width:100%;height:100%;object-fit:cover;">` : '🍽️'}</div>
        <div class="prod-info" style="flex:1;"><h4>${esc(i.name)}</h4><div class="prod-footer" style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;"><strong>${money(i.price)}</strong><span class="badge" style="background:var(--primary); color:#fff; padding:4px 8px; border-radius:4px; font-size:10px;">Ativo</span></div></div>
      </div>`;
    }).join('') : '<p class="small muted">Nenhum produto cadastrado.</p>'}
  </div>`;
}

function maskCEP(input) {
  let v = input.value.replace(/\D/g, '');
  if (v.length > 8) v = v.slice(0, 8);
  if (v.length > 5) v = v.replace(/^(\d{5})(\d{1,3}).*/, '$1-$2');
  input.value = v;
}

async function buscarCEP(cep) {
  cep = cep.replace(/\D/g, '');
  if(cep.length !== 8) return;
  toast('Buscando CEP...');
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = await res.json();
    if(data.erro) { toast('CEP não encontrado.', 'error'); return; }
    
    document.getElementById('addressInput').value = `${data.logradouro}, ${data.bairro}`;
    document.getElementById('cityInput').value = data.localidade;
    document.getElementById('stateInput').value = data.uf;
    toast('Endereço preenchido!');
  } catch(e) { toast('Erro ao buscar CEP.', 'error'); }
}

function handleImageUpload(input, type) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 2 * 1024 * 1024) { toast('Imagem muito grande. Máximo 2MB.', 'error'); return; }
  
  toast('Enviando imagem...');
  uploadImage(file, type).then(url => {
    tempImages[type] = url;
    const box = document.getElementById(`${type}PreviewBox`);
    box.classList.add('has-img');
    box.innerHTML = `<img src="${url}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;"><input type="file" accept="image/*" onchange="handleImageUpload(this, '${type}')" style="position:absolute;inset:0;opacity:0;cursor:pointer;">`;
    toast('Imagem carregada! Salve o formulário.', 'warn');
  });
}

function openClientPreview(storeId) {
  const s = db.stores.find(x=>x.id==storeId); if(!s) return;
  const profiles = getStoreProfiles();
  const p = profiles[s.id] || {};
  const items = db.menu_items.filter(m=>m.store_id==s.id);
  
  const coverImg = p.cover ? `<img src="${p.cover}" style="width:100%; height:200px; object-fit:cover;">` : `<div style="height:200px; background:var(--primary);"></div>`;
  const logoImg = p.logo ? `<img src="${p.logo}" style="width:100px; height:100px; object-fit:cover; border-radius:50%; border:4px solid white; margin-top:-50px; position:relative; z-index:2;">` : `<div style="width:100px; height:100px; border-radius:50%; background:#fff; border:4px solid white; display:grid; place-items:center; font-size:40px; margin-top:-50px; position:relative; z-index:2;">🏪</div>`;

  document.getElementById('modalRoot').innerHTML = `
    <div class="preview-modal" onclick="if(event.target===this)closeModal()" style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:200;display:grid;place-items:center;padding:20px;backdrop-filter:blur(4px);">
      <div class="preview-content" style="background:#fff;border-radius:24px;width:min(600px,100%);max-height:90vh;overflow-y:auto;position:relative;">
        <button class="preview-close" onclick="closeModal()" style="position:absolute;top:16px;right:16px;z-index:10;width:36px;height:36px;border-radius:50%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.1);display:grid;place-items:center;font-weight:bold;">✕</button>
        ${coverImg}
        <div style="padding: 0 32px 32px; text-align:center;">
          ${logoImg}
          <h1 style="margin-top:16px; font-size:28px; font-family:'Montserrat';">${esc(s.name)}</h1>
          <p class="muted" style="margin-top:4px;">${esc(db.categories.find(c=>c.id===s.category_id)?.name || 'Geral')}</p>
          <p style="margin-top:16px; font-size:15px; color:#666;">${esc(p.description || 'Bem-vindo à nossa loja!')}</p>
          
          <div style="display:flex; justify-content:center; gap:24px; margin-top:24px; font-size:14px; color:#666; border-top:1px solid #eee; border-bottom:1px solid #eee; padding:16px 0;">
            <span>${ICON.pin} ${esc(p.address || 'Endereço não informado')}</span>
          </div>

          <div style="display:grid; gap:12px; margin-top:32px; text-align:left;">
            ${items.length ? items.map(i => {
              const parsed = parseItemImage(i.description);
              return `<div class="prod-card" style="background:#fff; border-radius:16px; box-shadow:0 2px 8px rgba(0,0,0,0.05); display:flex; gap:16px; padding:12px;">
                <div class="prod-img" style="width:60px;height:60px;border-radius:12px;background:#F0F0F0;display:grid;place-items:center;font-size:24px;overflow:hidden;">${parsed.img ? `<img src="${esc(parsed.img)}" style="width:100%;height:100%;object-fit:cover;">` : '🍽️'}</div>
                <div class="prod-info" style="flex:1;"><h4>${esc(i.name)}</h4><p class="small muted">${esc(parsed.text)}</p>
                <div class="prod-footer" style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;"><strong>${money(i.price)}</strong></div></div>
              </div>`;
            }).join('') : '<p class="muted" style="text-align:center;">Cardápio vazio.</p>'}
          </div>
        </div>
      </div>
    </div>`;
  document.body.classList.add('no-scroll');
}

document.addEventListener('submit', async (e) => {
  if(e.target.id === 'storeForm' || e.target.id === 'editStoreForm') {
    e.preventDefault();
    const f = new FormData(e.target);
    const isEdit = e.target.id === 'editStoreForm';
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Salvando...';

    const lat = f.get('lat') || DEFAULT_LOC.lat;
    const lng = f.get('lng') || DEFAULT_LOC.lng;
    const locString = `POINT(${lng} ${lat})`;

    const hours = {};
    ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].forEach(d => {
      hours[d] = {
        active: f.get(`active_${d}`) === 'on',
        open: f.get(`open_${d}`) || '18:00',
        close: f.get(`close_${d}`) || '23:00'
      };
    });

    try {
      let storeId = e.target.dataset.id;
      
      if(isEdit) {
        const { error } = await supa.from('stores').update({
          name: f.get('name'),
          category_id: Number(f.get('category_id')),
          delivery_fee: Number(f.get('delivery_fee')),
          location: locString
        }).eq('id', storeId);
        if(error) throw error;
      } else {
        const { data: newStore, error } = await supa.from('stores').insert({
          owner_id: session.id,
          name: f.get('name'),
          category_id: Number(f.get('category_id')),
          delivery_fee: Number(f.get('delivery_fee')),
          location: locString
        }).select().single();
        if(error) throw error;
        storeId = newStore.id;
      }

      const extraData = {
        description: f.get('description') || '',
        phone: f.get('phone') || '',
        cep: f.get('cep') || '',
        address: f.get('address') || '',
        city: f.get('city') || '',
        state: f.get('state') || '',
        prep_time: Number(f.get('prep_time')) || 30,
        status: f.get('status') || 'open',
        hours: hours,
        lat: Number(lat),
        lng: Number(lng)
      };
      if (tempImages.logo) extraData.logo = tempImages.logo;
      if (tempImages.cover) extraData.cover = tempImages.cover;

      saveStoreProfile(storeId, extraData);
      tempImages = { logo: null, cover: null };
      
      toast(isEdit ? 'Alterações salvas!' : 'Loja criada com sucesso!');
      await refresh();
    } catch(err) {
      toast('Erro: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Salvar';
    }
  }
});

function AdminView(){
  if(!session || session.role !== 'admin') return 'Acesso restrito.';
  const totalRevenue = db.orders.reduce((s,o) => s + Number(o.total_price), 0);
  const tables = ['profiles','stores','menu_items','orders','categories'];
  const tableData = db[state.adminTable] || [];

  return `<div class="kpi-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:16px; margin-bottom:24px;">
    <div class="kpi-card" style="background:#F5F5F5; padding:24px; border-radius:16px; border:1px solid #eee; text-align:left;"><h4 style="font-size:12px; color:#666; text-transform:uppercase; margin-bottom:8px; font-weight:700;">Usuários</h4><div class="val" style="font-size:28px; font-weight:800; color:#212121;">${db.profiles.length}</div></div>
    <div class="kpi-card" style="background:#F5F5F5; padding:24px; border-radius:16px; border:1px solid #eee; text-align:left;"><h4 style="font-size:12px; color:#666; text-transform:uppercase; margin-bottom:8px; font-weight:700;">Lojas</h4><div class="val" style="font-size:28px; font-weight:800; color:#212121;">${db.stores.length}</div></div>
    <div class="kpi-card" style="background:#F5F5F5; padding:24px; border-radius:16px; border:1px solid #eee; text-align:left;"><h4 style="font-size:12px; color:#666; text-transform:uppercase; margin-bottom:8px; font-weight:700;">Pedidos</h4><div class="val" style="font-size:28px; font-weight:800; color:#212121;">${db.orders.length}</div></div>
    <div class="kpi-card" style="background:#F5F5F5; padding:24px; border-radius:16px; border:1px solid #eee; text-align:left;"><h4 style="font-size:12px; color:#666; text-transform:uppercase; margin-bottom:8px; font-weight:700;">Faturamento</h4><div class="val" style="font-size:28px; font-weight:800; color:#059669;">${money(totalRevenue)}</div></div>
  </div>
  <div class="checkout-card" style="background:#fff; padding:32px; border-radius:20px; box-shadow:var(--sh);">
    <h2 style="margin-bottom:8px;">Inspetor de Banco de Dados</h2>
    <div class="db-tabs" style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">${tables.map(t=>`<button class="db-tab ${state.adminTable===t?'active':''}" style="padding:8px 12px; border-radius:6px; background:${state.adminTable===t?'var(--primary)':'#fff'}; color:${state.adminTable===t?'#fff':'#333'}; border:1px solid #ddd; font-weight:600; font-size:12px; cursor:pointer;" onclick="state.adminTable='${t}';render()">${t}</button>`).join('')}</div>
    <div class="db-table-container" style="overflow-x:auto; background:#fff; border-radius:12px; border:1px solid #ddd; margin-top:16px;">
      <table class="db-table" style="width:100%; border-collapse:collapse; font-size:12px; font-family:monospace;"><thead><tr>${tableData.length ? Object.keys(tableData[0]).map(k=>`<th style="text-align:left; padding:10px; background:#F5F5F5; border-bottom:1px solid #ddd; color:var(--primary);">${k}</th>`).join('') : '<th>Vazio</th>'}</tr></thead><tbody>${tableData.length ? tableData.map(row => `<tr>${Object.values(row).map(v=>`<td style="padding:8px 10px; border-bottom:1px solid #eee; color:#666; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${v === null ? '<span style="color:#999">null</span>' : String(v).substring(0,50)}</td>`).join('')}</tr>`).join('') : ''}</tbody></table>
    </div>
  </div>`;
}

function openAuth(){
  openModal(`
    <div style="display:flex; gap:16px; margin-bottom:24px; border-bottom:1px solid #ddd;">
      <button id="tabLogin" class="btn btn-ghost" style="flex:1; border:none; border-bottom:2px solid var(--primary); color:var(--primary); border-radius:0;" onclick="switchAuth('login')">Entrar</button>
      <button id="tabSignup" class="btn btn-ghost" style="flex:1; border:none; border-radius:0;" onclick="switchAuth('signup')">Criar Conta</button>
    </div>
    <form id="formLogin" onsubmit="doLogin(event)">
      <div class="input-group"><label>E-mail</label><input name="email" type="email" required></div>
      <div class="input-group"><label>Senha</label><input name="password" type="password" required></div>
      <button class="btn btn-primary btn-block">Entrar</button>
    </form>
    <form id="formSignup" style="display:none;" onsubmit="doSignup(event)">
      <div class="input-group"><label>Nome Completo</label><input name="name" required></div>
      <div class="input-group"><label>E-mail</label><input name="email" type="email" required></div>
      <div class="input-group"><label>Senha</label><input name="password" type="password" required minlength="6"></div>
      <div class="input-group"><label>Tipo de Conta</label><select name="role"><option value="user">Cliente (Quero fazer pedidos)</option><option value="owner">Lojista (Quero vender)</option></select></div>
      <button class="btn btn-primary btn-block">Cadastrar</button>
    </form>
  `);
}

function switchAuth(mode) {
  document.getElementById('formLogin').style.display = mode === 'login' ? 'block' : 'none';
  document.getElementById('formSignup').style.display = mode === 'signup' ? 'block' : 'none';
  const tabL = document.getElementById('tabLogin'), tabS = document.getElementById('tabSignup');
  if(mode === 'login') { tabL.style.borderBottom = '2px solid var(--primary)'; tabL.style.color = 'var(--primary)'; tabS.style.borderBottom = 'none'; tabS.style.color = 'var(--text)'; }
  else { tabS.style.borderBottom = '2px solid var(--primary)'; tabS.style.color = 'var(--primary)'; tabL.style.borderBottom = 'none'; tabL.style.color = 'var(--text)'; }
}

async function doLogin(e){
  e.preventDefault(); const f = new FormData(e.target);
  const { error } = await supa.auth.signInWithPassword({ email:f.get('email'), password:f.get('password') });
  if(error) toast(error.message, 'error'); else { closeModal(); toast('Bem-vindo de volta!'); }
}

async function doSignup(e){
  e.preventDefault(); const f = new FormData(e.target);
  const { data, error } = await supa.auth.signUp({ email: f.get('email'), password: f.get('password'), options: { data: { full_name: f.get('name'), role: f.get('role') } } });
  if(error) { toast(error.message, 'error'); return; }
  if(data.user) await supa.from('profiles').insert({ id: data.user.id, full_name: f.get('name'), role: f.get('role') });
  closeModal(); toast('Conta criada com sucesso!');
}

let locDraft = null, locResults = [], locTimer = null;

function openLocModal(){
  locDraft = state.location.confirmed ? { ...state.location, picked:true } : null; locResults = [];
  openModal(`<h3 style="margin-bottom:20px; font-size:24px;">Onde entregamos?</h3>
    <div class="input-group"><label>Buscar endereço</label><input id="locInput" placeholder="Rua, número, bairro, cidade" autocomplete="off" oninput="locSearchDebounced(this.value)" value="${state.location.confirmed ? esc(state.location.label) : ''}"></div>
    <div id="locResults"></div>
    <button class="btn btn-ghost btn-block" onclick="getGeo()" style="margin-bottom:12px;">📍 Usar minha localização atual</button>
    <p id="locSel" class="small muted" style="margin-bottom:16px;">${locDraft ? '✓ ' + esc(locDraft.label) : 'Escolha um endereço da lista ou use o GPS.'}</p>
    <button class="btn btn-primary btn-block" onclick="saveLoc()">Confirmar endereço</button>`);
}

function locSearchDebounced(v){
  clearTimeout(locTimer);
  const box = document.getElementById('locResults'); if(!box) return;
  if(v.trim().length < 4){ box.innerHTML = ''; return; }
  box.innerHTML = '<p class="small muted" style="margin-bottom:12px;">Buscando...</p>';
  locTimer = setTimeout(async () => {
    try {
      locResults = await geoSearch(v);
      box.innerHTML = locResults.length ? locResults.map((r,i) => `<button class="loc-opt" onclick="pickLoc(${i})" style="display:flex; gap:10px; align-items:flex-start; width:100%; text-align:left; padding:14px; border-radius:10px; border:1px solid #ddd; margin-bottom:8px; background:#fff; font-weight:600; font-size:14px;">${ICON.pin}<span>${esc(r.label)}</span></button>`).join('') : '<p class="small muted" style="margin-bottom:12px;">Nenhum endereço encontrado. Inclua a cidade na busca.</p>';
    } catch(e){ box.innerHTML = '<p class="small" style="color:var(--primary); margin-bottom:12px;">Busca indisponível agora. Use o GPS.</p>'; }
  }, 600);
}

function setDraft(d){
  locDraft = { ...d, picked:true };
  const i = document.getElementById('locInput'), s = document.getElementById('locSel'), r = document.getElementById('locResults');
  if(i) i.value = d.label; if(r) r.innerHTML = ''; if(s) s.textContent = '✓ ' + d.label;
}
function pickLoc(i){ if(locResults[i]) setDraft(locResults[i]); }

function getGeo(){
  if(!navigator.geolocation){ toast('GPS indisponível neste aparelho.', 'error'); return; }
  toast('Obtendo sua localização...');
  navigator.geolocation.getCurrentPosition(async p => {
    const lat = p.coords.latitude, lng = p.coords.longitude; let label = 'Minha localização atual';
    try { label = (await geoReverse(lat, lng)) || label; } catch(e){}
    setDraft({ lat, lng, label });
  }, () => toast('GPS negado. Busque pelo endereço.', 'error'), { enableHighAccuracy:true, timeout:10000 });
}

function saveLoc(){
  if(!locDraft || !locDraft.picked){ toast('Escolha um endereço da lista ou use o GPS.', 'error'); return; }
  state.location = { lat:locDraft.lat, lng:locDraft.lng, label:locDraft.label, confirmed:true };
  state.quote = null;
  localStorage.setItem('loc_v9', JSON.stringify(state.location));
  closeModal(); render(); toast('Endereço atualizado');
}

function openImportModal(){
  openModal(`<h3 style="margin-bottom:8px; font-size:22px;">Importar Receita</h3>
    <div class="input-group" style="display:flex; gap:8px; margin-top:16px;">
      <input id="apiSearchInput" placeholder="Ex: Chicken, Pasta, Pizza..." style="flex:1;">
      <button class="btn btn-primary" onclick="buscarNaAPI()">Buscar</button>
    </div>
    <div id="apiResults" style="margin-top:24px;"></div>
  `);
}

async function buscarNaAPI(){
  const termo = document.getElementById('apiSearchInput').value.trim(); if(!termo) return;
  const resultsDiv = document.getElementById('apiResults');
  resultsDiv.innerHTML = '<p class="small muted" style="text-align:center; padding:20px;">Buscando...</p>';

  try {
    const res = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${termo}`);
    const data = await res.json();
    if(!data.meals){ resultsDiv.innerHTML = '<p class="small muted" style="text-align:center; padding:20px;">Nenhuma receita encontrada.</p>'; return; }

    resultsDiv.innerHTML = data.meals.map(meal => {
      const cat = traduzir(meal.strCategory), area = traduzir(meal.strArea);
      let ings = []; for(let i=1; i<=5; i++) { if(meal[`strIngredient${i}`]) ings.push(meal[`strIngredient${i}`]); }
      return `<div class="import-card" style="display:flex; gap:12px; margin-bottom:16px; border-bottom:1px solid #eee; padding-bottom:16px;">
        <img src="${meal.strMealThumb}" class="import-img" style="width:80px; height:80px; border-radius:12px; object-fit:cover;">
        <div class="import-info" style="flex:1;">
          <h4 style="font-size:16px; margin-bottom:4px;">${esc(meal.strMeal)}</h4><p class="small muted" style="margin-bottom:4px;"><strong>Cat:</strong> ${esc(cat)}</p>
          <div class="ing-list small muted" style="margin-bottom:8px;"><strong>Ingredientes:</strong> ${ings.join(', ')}...</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="number" id="price_${meal.idMeal}" placeholder="Preço" style="width:80px; padding:6px; border-radius:6px; border:1px solid #ddd; font-size:12px;">
            <button class="btn btn-outline btn-sm" onclick="salvarProdutoAPI('${meal.idMeal}')">Salvar</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch(e) { resultsDiv.innerHTML = '<p class="small" style="color:var(--primary); text-align:center;">Erro na API.</p>'; }
}

async function salvarProdutoAPI(idMeal){
  const precoInput = document.getElementById(`price_${idMeal}`).value;
  if(!precoInput || isNaN(precoInput)) { toast('Digite um preço válido.', 'error'); return; }
  const preco = parseFloat(precoInput);

  try {
    const res = await fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${idMeal}`);
    const data = await res.json();
    const meal = data.meals[0]; if(!meal) return;

    const store = db.stores.find(s => s.owner_id === session.id);
    const { error } = await supa.from('menu_items').insert({
      store_id: store.id, name: meal.strMeal,
      description: `[IMG:${meal.strMealThumb}] Prato típico ${traduzir(meal.strArea)}. Ingredientes: ${meal.strIngredient1}, ${meal.strIngredient2}.`,
      price: preco, is_available: true
    });
    if(error) throw error;
    toast('Produto importado!'); closeModal(); await refresh();
  } catch(e) { toast('Erro: ' + e.message, 'error'); }
}