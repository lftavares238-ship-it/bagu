'use strict';
const MINHA_LOJA_CONFIG = {
  MODO: 'supabase',         
  PERFIL_NO_BANCO: false,   
  TABELA: 'stores',
  BUCKET: 'store-assets',
  CHAVE_TESTE: 'ml_teste_stores'
};

const MinhaLoja = (() => {
  const C = MINHA_LOJA_CONFIG;
  const DIAS = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  const TIPOS = ['image/jpeg','image/png','image/webp','image/jpg','image/heic','image/heif']; 
  const m = { owner:null, store:null, mode:'loading', draft:null, pending:{logo:null,cover:null}, preview:{logo:null,cover:null}, saving:false, map:null, marker:null, savedAt:null };
  const isTest = () => C.MODO !== 'supabase';
  const digits = v => String(v||'').replace(/\D/g,'');

  const lerTeste = () => { try { return JSON.parse(localStorage.getItem(C.CHAVE_TESTE) || '[]'); } catch(e){ return []; } };
  const gravarTeste = a => { try { localStorage.setItem(C.CHAVE_TESTE, JSON.stringify(a)); } catch(e){ throw new Error('Armazenamento cheio.'); } };
  function paraDataURL(file){ return new Promise((ok,no)=>{ const im=new Image(); im.onload=()=>{ const k=Math.min(1,900/Math.max(im.width,im.height)); const c=document.createElement('canvas'); c.width=im.width*k; c.height=im.height*k; c.getContext('2d').drawImage(im,0,0,c.width,c.height); URL.revokeObjectURL(im.src); ok(c.toDataURL('image/jpeg',.8)); }; im.onerror=()=>no(new Error('Imagem inválida.')); im.src=URL.createObjectURL(file); }); }

  const parseLoc = (loc) => {
    if (!loc) return { lat:null, lng:null };
    if (typeof loc === 'object' && loc.coordinates) return { lat: loc.coordinates[1], lng: loc.coordinates[0] };
    if (typeof loc === 'string') {
      const match = loc.match(/POINT\(([^ ]+) ([^)]+)\)/);
      if (match) return { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
    }
    return { lat:null, lng:null };
  };

  const dePerfil = (row, pf) => { 
    pf = pf || {}; 
    const dbStore = (db.stores || []).find(s => s.id == row.id);
    const parsed = parseLoc(row.location);
    const lat = pf.lat || parsed.lat || (dbStore && dbStore.lat) || null;
    const lng = pf.lng || parsed.lng || (dbStore && dbStore.lng) || null;
    return { ...pf, ...row, lat, lng, logo_url:pf.logo || row.logo_url || null, cover_url:pf.cover || row.cover_url || null }; 
  };

  const paraPerfil = p => { const { logo_url, cover_url, ...r } = p; return { ...r, logo:logo_url, cover:cover_url }; };
  
  async function enviarImagem(file, tipo){
    try {
      let ext = file.name ? file.name.split('.').pop().toLowerCase() : 'jpg';
      if (ext === 'heic' || ext === 'heif') ext = 'jpg';
      const path = `${session.id}/${Date.now()}_${tipo}.${ext}`;
      const { error } = await supa.storage.from(C.BUCKET).upload(path, file, { contentType:file.type });
      if(error) throw error;
      return supa.storage.from(C.BUCKET).getPublicUrl(path).data.publicUrl;
    } catch(e){ return paraDataURL(file); }
  }

  const colunasBanco = p => ({ name:p.name, category_id:p.category_id, delivery_fee:p.delivery_fee, location:`POINT(${p.lng} ${p.lat})`, ...(C.PERFIL_NO_BANCO ? paraPerfil(p) : {}) });

  const Repo = {
    async get(ownerId){
      if(isTest()) return lerTeste().find(s => s.owner_id === ownerId) || null;
      const { data, error } = await supa.from(C.TABELA).select('*').eq('owner_id', ownerId).limit(1).maybeSingle();
      if(error) throw error; return data ? dePerfil(data, getStoreProfiles()[data.id]) : null;
    },
    async insert(p){
      if(isTest()){ const all = lerTeste(); const row = { ...p, id:'teste_'+Date.now(), owner_id:session.id }; all.push(row); gravarTeste(all); return row; }
      const { data, error } = await supa.from(C.TABELA).insert({ ...colunasBanco(p), owner_id:session.id }).select().single();
      if(error) throw error;
      saveStoreProfile(data.id, paraPerfil(p)); return dePerfil(data, paraPerfil(p));
    },
    async update(id, p){
      if(isTest()){ const all = lerTeste(); const i = all.findIndex(s => s.id===id && s.owner_id===session.id); if(i<0) throw new Error('Loja não encontrada.'); all[i] = { ...all[i], ...p }; gravarTeste(all); return all[i]; }
      const { data, error } = await supa.from(C.TABELA).update(colunasBanco(p)).eq('id', id).eq('owner_id', session.id).select().single();
      if(error) throw error;
      saveStoreProfile(id, paraPerfil(p)); return dePerfil(data, paraPerfil(p));
    },
    upload: (file, tipo) => isTest() ? paraDataURL(file) : enviarImagem(file, tipo)
  };

  function situacao(s){
    if(s.is_active === false) return { ok:false, txt:'Loja desativada' };
    if(s.status === 'closed') return { ok:false, txt:'Fechada' };
    return { ok:true, txt:'Aberta agora' };
  }

  function validar(d){
    if(!d.name || d.name.length < 3) return 'Informe o nome da loja (mín. 3 letras).';
    if(!d.category_id) return 'Selecione a categoria.';
    if(!d.description || d.description.length < 10) return 'Escreva uma descrição com pelo menos 10 caracteres.';
    if(![10,11].includes(digits(d.phone).length)) return 'Telefone inválido.';
    if(digits(d.cep).length !== 8) return 'CEP inválido.';
    if(!d.address || d.address.length < 5) return 'Informe o endereço completo.';
    if(!d.city || d.city.length < 2) return 'Informe a cidade.';
    if(!/^[A-Z]{2}$/.test(d.state)) return 'Estado deve ter 2 letras.';
    if(d.lat==null || d.lng==null || isNaN(d.lat) || isNaN(d.lng)) return 'Clique no mapa para definir a localização.';
    if(!(d.prep_time >= 5 && d.prep_time <= 240)) return 'Tempo de preparo deve ser entre 5 e 240 min.';
    if(!(d.delivery_fee >= 0 && d.delivery_fee <= 50)) return 'Taxa de entrega inválida.';
    const ativos = DIAS.filter(x => d.hours[x].active);
    if(!ativos.length) return 'Marque ao menos um dia de funcionamento.';
    const ruim = ativos.find(x => !d.hours[x].open || !d.hours[x].close || d.hours[x].open >= d.hours[x].close);
    if(ruim) return `Horário inválido em ${ruim}: a abertura deve ser antes do fechamento.`;
    return null;
  }

  function coletar(f){
    const g = n => f.elements[n] ? f.elements[n].value : '';
    const hours = {}; DIAS.forEach(d => hours[d] = { active:f.elements['a_'+d].checked, open:g('o_'+d), close:g('c_'+d) });
    return { 
      name:(g('name') || '').trim(), category_id:Number(g('category_id'))||null, description:(g('description') || '').trim(), phone:g('phone'), cep:g('cep'),
      address:(g('address') || '').trim(), city:(g('city') || '').trim(), state:(g('state') || '').trim().toUpperCase(),
      lat:g('lat')==='' ? null : Number(g('lat')), lng:g('lng')==='' ? null : Number(g('lng')),
      prep_time:Number(g('prep_time')), delivery_fee:Number(g('delivery_fee')), status:g('status'), is_active:f.elements.is_active.checked, hours 
    };
  }

  async function carregar(){
    m.owner = session.id; m.mode = 'loading'; m.draft = null; m.savedAt = null; m.store = null;
    try { m.store = await Repo.get(session.id); m.mode = m.store ? 'view' : 'create'; }
    catch(e){ toast('Erro ao carregar: '+e.message, 'error'); m.mode = 'create'; }
    render();
  }

  const nomeCat = id => (db.categories.find(c => c.id === id) || {}).name || 'Geral';

  function cartao(s){
    const st = situacao(s), h = s.hours || {};
    return `<div class="ml-card">
      <div class="ml-cover" style="background:#f0f0f0;">${s.cover_url ? `<img src="${esc(s.cover_url)}" alt="">` : ''}</div>
      <div class="ml-body">
        <div class="ml-logo" style="background:#fff; display:grid; place-items:center;">
          ${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>'}
        </div>
        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
          <h2>${esc(s.name)}</h2>
          <span class="${st.ok?'badge-open':'badge-closed'}">${st.txt}</span>
        </div>
        <p class="muted small" style="margin-top:4px;">${esc(nomeCat(s.category_id))} • Preparo: ${esc(s.prep_time)} min</p>
        <p style="margin:16px 0; color:var(--gray-600); line-height:1.6;">${esc(s.description)}</p>
        <p class="small"><strong>Endereço:</strong> ${esc(s.address)}, ${esc(s.city)}/${esc(s.state)}</p>
        <p class="small" style="margin-top:4px;"><strong>Telefone:</strong> ${esc(s.phone)}</p>
        <div class="ml-hours">${DIAS.map(d => `<div><strong>${d}</strong><span>${h[d] && h[d].active ? `${h[d].open} - ${h[d].close}` : 'Fechado'}</span></div>`).join('')}</div>
      </div></div>`;
  }

  function sidebar(){
    return `<aside class="owner-sidebar">
      <div style="margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid #eee;"><strong style="display:block; font-size:18px;">${esc(m.store ? m.store.name : 'Nova loja')}</strong><span class="small muted">Lojista</span></div>
      <a class="active" style="color:var(--primary); background:rgba(211,47,47,0.1);">Minha Loja</a>
      <a onclick="navigate('owner')">Painel do lojista</a>
    </aside>`;
  }
  const faixaTeste = () => `<div class="ml-banner">${isTest() ? 'Modo teste: dados salvos no navegador.' : 'Conectado ao banco de dados.'}</div>`;

  function view(){
    if(!session || session.role !== 'owner') return 'Acesso restrito.';
    if(m.owner !== session.id){ carregar(); }
    let corpo;
    if(m.mode === 'loading') corpo = '<p class="muted">Carregando...</p>';
    else if(m.mode === 'view'){
      corpo = `<div class="owner-header"><h1>Minha Loja</h1><div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" onclick="MinhaLoja.cliente()">Visualizar</button>
          <button class="btn btn-primary btn-sm" onclick="MinhaLoja.editar()">Editar loja</button></div></div>
        ${m.savedAt ? `<div class="ml-ok">Alterações salvas às ${m.savedAt}</div>` : ''}${faixaTeste()}${cartao(m.store)}`;
    } else corpo = form();
    return `<div class="owner-layout">${sidebar()}<div class="owner-main">${corpo}</div></div>`;
  }

  function form(){
    const s = m.draft || m.store || { is_active:true, status:'open', hours:{} };
    const h = s.hours || {}, novo = !m.store;
    
    const box = (t, rot) => { const src = m.preview[t] || (m.store && m.store[t+'_url']);
      return `<div><label class="small muted" style="display:block; margin-bottom:8px; font-weight:700;">${rot}</label>
        <div class="image-upload ${src?'has-img':''}" id="ml_${t}">
          ${src ? `<img src="${esc(src)}" alt="">` : `
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2" style="margin-bottom:8px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span class="small">Toque para enviar foto</span>`}
          <input type="file" accept="image/*" onchange="MinhaLoja.img(this,'${t}')">
        </div></div>`; };
    
    return `<div class="owner-header"><h1>${novo ? 'Cadastrar minha loja' : 'Editar loja'}</h1></div>${faixaTeste()}
    <form id="mlForm" onsubmit="MinhaLoja.salvar(event)" oninput="MinhaLoja.rascunho(this)" onchange="MinhaLoja.rascunho(this)" novalidate>
      <div class="form-section"><h3>Informações Básicas</h3>
        <div class="input-group"><label>Nome da loja *</label><input name="name" maxlength="80" value="${esc(s.name)}" placeholder="Ex: Lanches do João"></div>
        <div class="grid-2">
          <div class="input-group"><label>Categoria *</label><select name="category_id"><option value="">Selecione</option>${db.categories.map(c => `<option value="${c.id}" ${c.id===s.category_id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div class="input-group"><label>Tempo de preparo (min) *</label><input name="prep_time" type="number" min="5" max="240" value="${esc(s.prep_time)}" placeholder="Ex: 30"></div>
        </div>
        <div class="input-group">
          <label>Taxa Base de Entrega (R$) *</label>
          <input name="delivery_fee" type="number" step="0.01" min="0" max="50" inputmode="decimal" value="${esc(s.delivery_fee)}" placeholder="Ex: 5.00">
          <p class="small muted" style="margin-top:6px; color:var(--primary); font-weight:600;">Nota: O sistema calcula automaticamente a distância até o cliente e adiciona uma taxa por KM.</p>
        </div>
        <div class="input-group"><label>Descrição *</label><textarea name="description" rows="3" maxlength="300" placeholder="O que sua loja vende?">${esc(s.description)}</textarea></div>
      </div>
      <div class="form-section"><h3>Imagens</h3><div class="grid-2">${box('logo','Logotipo')}${box('cover','Capa')}</div></div>
      <div class="form-section"><h3>Contato e Endereço</h3>
        <div class="grid-2">
          <div class="input-group"><label>Telefone *</label><input name="phone" inputmode="tel" placeholder="(00) 00000-0000" oninput="MinhaLoja.mask(this,'tel')" value="${esc(s.phone)}"></div>
          <div class="input-group"><label>CEP *</label><input name="cep" inputmode="numeric" placeholder="00000-000" oninput="MinhaLoja.mask(this,'cep')" onblur="MinhaLoja.cep(this.value)" value="${esc(s.cep)}"></div>
        </div>
        <div class="input-group"><label>Endereço completo *</label><input name="address" id="ml_address" value="${esc(s.address)}"></div>
        <div class="grid-2">
          <div class="input-group"><label>Cidade *</label><input name="city" id="ml_city" value="${esc(s.city)}"></div>
          <div class="input-group"><label>Estado *</label><input name="state" id="ml_state" maxlength="2" value="${esc(s.state)}"></div>
        </div>
      </div>
      <div class="form-section"><h3>Localização</h3>
        <p class="small muted" style="margin-bottom:8px;">Toque no mapa para marcar sua loja.</p>
        <div id="mlMap"></div>
        <div class="grid-2" style="margin-top:12px; display:none;">
          <input name="lat" id="ml_lat" type="number" step="any" value="${s.lat ?? ''}">
          <input name="lng" id="ml_lng" type="number" step="any" value="${s.lng ?? ''}">
        </div>
        <button type="button" class="btn btn-outline btn-block" onclick="MinhaLoja.gps()" style="margin-top:12px;">Usar minha localização atual</button>
      </div>
      <div class="form-section"><h3>Horário de Funcionamento</h3>
        ${DIAS.map(d => { const x = h[d] || { active:false, open:'18:00', close:'23:00' };
          return `<div class="hours-grid"><label><input type="checkbox" name="a_${d}" ${x.active?'checked':''}> ${d}</label><input type="time" name="o_${d}" value="${x.open}"><input type="time" name="c_${d}" value="${x.close}"></div>`; }).join('')}
      </div>
      <div class="form-section"><h3>Status</h3>
        <div class="grid-2">
          <div class="input-group"><label>Situação</label><select name="status"><option value="open" ${s.status!=='closed'?'selected':''}>Aberta</option><option value="closed" ${s.status==='closed'?'selected':''}>Fechada</option></select></div>
          <div class="input-group"><label>Visibilidade</label><label style="display:flex; gap:8px; align-items:center; font-weight:600; padding:16px 0;"><input type="checkbox" name="is_active" style="width:auto;" ${s.is_active!==false?'checked':''}> Loja ativa</label></div>
        </div>
      </div>
      <div class="ml-actions">
        <button type="button" class="btn btn-ghost" onclick="MinhaLoja.cancelar()">Cancelar</button>
        <button type="submit" id="mlSalvar" class="btn btn-primary">${novo ? 'Cadastrar' : 'Salvar alterações'}</button>
      </div>
    </form>`;
  }

  function editar(){ m.mode='edit'; m.draft=null; m.savedAt=null; render(); }
  function cancelar(){ m.draft=null; m.pending={logo:null,cover:null}; m.preview={logo:null,cover:null}; if(m.store){ m.mode='view'; render(); } else navigate('home'); }
  function rascunho(f){ m.draft = { ...(m.draft || m.store || {}), ...coletar(f) }; }

  function img(input, tipo){
    const f = input.files[0]; if(!f) return;
    if(!f.type.startsWith('image/')){ toast('Selecione uma imagem.', 'error'); input.value=''; return; }
    if(f.size > 5*1024*1024){ toast('Imagem muito grande (máx 5MB).', 'error'); input.value=''; return; }
    m.pending[tipo] = f; m.preview[tipo] = URL.createObjectURL(f);
    const b = document.getElementById('ml_'+tipo); b.classList.add('has-img');
    b.innerHTML = `<img src="${m.preview[tipo]}" alt=""><input type="file" accept="image/*" onchange="MinhaLoja.img(this,'${tipo}')">`;
  }

  function mask(el, tipo){
    let v = digits(el.value);
    if(tipo === 'cep') v = v.slice(0,8).replace(/^(\d{5})(\d)/, '$1-$2');
    else { v = v.slice(0,11); v = v.length > 10 ? v.replace(/^(\d{2})(\d{5})(\d)/, '($1) $2-$3') : v.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3'); }
    el.value = v;
  }

  async function cep(valor){
    const c = digits(valor); if(c.length !== 8) return;
    try {
      const d = await (await fetch(`https://viacep.com.br/ws/${c}/json/`)).json();
      if(d.erro){ toast('CEP não encontrado.', 'error'); return; }
      document.getElementById('ml_address').value = [d.logradouro, d.bairro].filter(Boolean).join(', ');
      document.getElementById('ml_city').value = d.localidade; document.getElementById('ml_state').value = d.uf;
      rascunho(document.getElementById('mlForm'));
    } catch(e){ toast('Erro ao buscar CEP.', 'error'); }
  }

  function ligarMarcador(){ m.marker.on('dragend', () => { const p = m.marker.getLatLng(); definirPos(p.lat, p.lng); }); }
  function definirPos(lat, lng){
    document.getElementById('ml_lat').value = lat.toFixed(6); document.getElementById('ml_lng').value = lng.toFixed(6);
    if(!m.marker){ m.marker = L.marker([lat,lng], { draggable:true }).addTo(m.map); ligarMarcador(); } else m.marker.setLatLng([lat,lng]);
    m.map.setView([lat,lng], Math.max(m.map.getZoom(), 15));
    rascunho(document.getElementById('mlForm'));
  }
  function mover(){ const a = parseFloat(document.getElementById('ml_lat').value), b = parseFloat(document.getElementById('ml_lng').value); if(m.map && !isNaN(a) && !isNaN(b)) definirPos(a, b); }
  function gps(){ navigator.geolocation.getCurrentPosition(p => definirPos(p.coords.latitude, p.coords.longitude), () => toast('GPS negado.', 'error')); }
  
  function afterRender(){
    if(m.map){ m.map.remove(); m.map = null; m.marker = null; }
    const el = document.getElementById('mlMap'); if(!el || typeof L === 'undefined') return;
    let a = parseFloat(document.getElementById('ml_lat').value), b = parseFloat(document.getElementById('ml_lng').value), tem = !isNaN(a) && !isNaN(b);
    if (!tem) {
      a = state.location ? state.location.lat : DEFAULT_LOC.lat;
      b = state.location ? state.location.lng : DEFAULT_LOC.lng;
      document.getElementById('ml_lat').value = a.toFixed(6);
      document.getElementById('ml_lng').value = b.toFixed(6);
      tem = true; 
    }
    m.map = L.map(el).setView([a,b], tem ? 16 : 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(m.map);
    m.marker = L.marker([a,b], { draggable:true }).addTo(m.map);
    ligarMarcador();
    m.map.on('click', e => definirPos(e.latlng.lat, e.latlng.lng));
  }

  async function salvar(e){
    e.preventDefault();
    if(m.saving) return;
    if(!session || session.role !== 'owner'){ toast('Sem permissão.', 'error'); return; }
    const d = coletar(e.target), erro = validar(d);
    if(erro){ toast(erro, 'error'); return; }
    
    m.saving = true; const btn = document.getElementById('mlSalvar'); btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      const p = { ...d, logo_url:m.store && m.store.logo_url || null, cover_url:m.store && m.store.cover_url || null };
      if(m.pending.logo) p.logo_url = await Repo.upload(m.pending.logo, 'logo');
      if(m.pending.cover) p.cover_url = await Repo.upload(m.pending.cover, 'cover');
      
      m.store = m.store ? await Repo.update(m.store.id, p) : await Repo.insert(p);
      m.draft = null; m.pending = { logo:null, cover:null }; m.preview = { logo:null, cover:null };
      m.mode = 'view'; m.savedAt = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
      toast('Loja salva com sucesso!');
      
      if(!isTest()) { await refresh(); } else render();
    } catch(err){ 
      toast('Erro ao salvar: '+err.message, 'error'); 
      btn.disabled = false; 
      btn.textContent = m.store ? 'Salvar alterações' : 'Cadastrar';
    }
    finally { m.saving = false; }
  }

  function cliente(){
    const itens = db.menu_items.filter(i => i.store_id == m.store.id);
    document.getElementById('modalRoot').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="ml-preview">
      <button class="ml-x" onclick="closeModal()">✕</button>${cartao(m.store)}
      <div style="padding:0 32px 32px;"><h3 style="margin-bottom:12px;">Cardápio</h3>
      ${itens.length ? itens.map(i => { const q = parseItemImage(i.description); return `<div class="prod-card" style="margin-bottom:10px;"><div class="prod-img">${q.img ? `<img src="${esc(q.img)}" alt="">` : '🍽️'}</div><div class="prod-info"><h4>${esc(i.name)}</h4><p>${esc(q.text)}</p><div class="prod-footer"><strong>${money(i.price)}</strong></div></div></div>`; }).join('') : '<p class="muted small">Nenhum produto cadastrado.</p>'}</div>
    </div></div>`;
    document.body.classList.add('no-scroll');
  }

  return { view, afterRender, editar, cancelar, rascunho, img, mask, cep, mover, gps, salvar, cliente };
})();

(function instalar(){
  const rota = Route, desenhar = render, cabecalho = Header;
  window.Route = () => state.route === 'minha-loja' ? MinhaLoja.view() : rota();
  window.render = () => { desenhar(); if(state.route === 'minha-loja') setTimeout(MinhaLoja.afterRender, 150); };
  window.Header = () => {
    const h = cabecalho();
    if(!session || session.role !== 'owner') return h;
    const b = `<button class="btn btn-ghost btn-sm desk-only" onclick="navigate('minha-loja')" style="color:var(--primary); border-color:var(--primary);">Minha Loja</button>`;
    return h.replace('<button class="btn-cart"', b + '<button class="btn-cart"');
  };
})();