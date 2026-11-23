'use strict';
(function () {
  const _origRoute = window.Route;
  if (!_origRoute) return;

  const IMGS = {
    burguer: ['https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&q=80','https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=600&q=80','https://images.unsplash.com/photo-1586190848861-99aa4a171e90?auto=format&fit=crop&w=600&q=80'],
    pizza: ['https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=600&q=80','https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=600&q=80'],
    doce: ['https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=600&q=80','https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=600&q=80'],
    japa: ['https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&w=600&q=80'],
    bebida: ['https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=600&q=80'],
    porcao: ['https://images.unsplash.com/photo-1576107232684-1279f390859f?auto=format&fit=crop&w=600&q=80'],
    refeicao: ['https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80']
  };

  function getImagemComida(id, nome) {
    const termo = (nome || '').toLowerCase();
    let pool = IMGS.refeicao;
    if (termo.includes('pizza')) pool = IMGS.pizza;
    else if (termo.includes('burg') || termo.includes('hamb') || termo.includes('x-')) pool = IMGS.burguer;
    else if (termo.includes('sushi') || termo.includes('japa')) pool = IMGS.japa;
    else if (termo.includes('doce') || termo.includes('bolo') || termo.includes('bombom')) pool = IMGS.doce; 
    else if (termo.includes('bebida') || termo.includes('suco') || termo.includes('refri')) pool = IMGS.bebida;
    else if (termo.includes('batata') || termo.includes('frita')) pool = IMGS.porcao;
    return pool[Math.abs(id) % pool.length];
  }

  // --- SISTEMA DE IMAGENS DE CATEGORIA COM FALLBACK (ANTI-ERRO) ---
  function renderImagemCategoria(nome) {
    const n = (nome || '').toLowerCase();
    let imgName = 'cat-todos.png';
    let emoji = '🌟';
    
    if (n.includes('burg') || n.includes('lanche') || n.includes('hamb')) { imgName = 'cat-burguer.png'; emoji = '🍔'; }
    else if (n.includes('pizza')) { imgName = 'cat-pizza.png'; emoji = '🍕'; }
    else if (n.includes('japa') || n.includes('sushi')) { imgName = 'cat-japonesa.png'; emoji = '🍣'; }
    else if (n.includes('brasil') || n.includes('marmita') || n.includes('comida')) { imgName = 'cat-brasileira.png'; emoji = '🍛'; }
    
    // Se a imagem não carregar (onerror), ele esconde a imagem e mostra o emoji
    return `
      <img src="${imgName}" alt="${nome}" class="cat-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';">
      <span class="cat-emoji-fallback" style="display:none; font-size:18px; margin-right:6px;">${emoji}</span>
    `;
  }

  function getAvaliacoes(itemId) {
    const nomes = ['Carlos Silva', 'Mariana Costa', 'João Pedro', 'Ana Clara', 'Roberto Alves'];
    const textos = ['Muito bom, chegou rápido!', 'Delicioso, recomendo.', 'Porção bem servida.', 'Poderia vir mais quente.', 'Melhor da região.'];
    const bots = [];
    for (let i = 0; i < 3; i++) {
      const nIdx = (itemId + i) % nomes.length;
      const tIdx = (itemId + i * 2) % textos.length;
      bots.push({ id: `bot_${itemId}_${i}`, nome: nomes[nIdx], texto: textos[tIdx], nota: 4 + ((itemId + i) % 2), likes: (itemId * i) % 15 });
    }
    let minhasAvaliacoes = {}, curtidas = {};
    try { minhasAvaliacoes = JSON.parse(localStorage.getItem('avaliacoes_reais') || '{}'); curtidas = JSON.parse(localStorage.getItem('curtidas_reviews') || '{}'); } catch(e){}
    const minhaNota = minhasAvaliacoes[itemId];
    let todasNotas = bots.map(b => b.nota);
    if (minhaNota) todasNotas.push(minhaNota);
    const media = (todasNotas.reduce((a,b)=>a+b, 0) / todasNotas.length).toFixed(1);
    return { bots, minhaNota, media, curtidas };
  }

  function renderEstrelas(itemId) {
    const { bots, minhaNota, media, curtidas } = getAvaliacoes(itemId);
    let estrelasHtml = '';
    for(let i=1; i<=5; i++) estrelasHtml += `<span style="font-size:14px; color:${i <= Math.round(media) ? '#FFC107' : '#D1D5DB'};">★</span>`;
    let userStars = '';
    for(let i=1; i<=5; i++) {
      const cor = i <= (minhaNota||0) ? '#D32F2F' : '#D1D5DB';
      userStars += `<span onclick="MinhaHome.avaliar(${itemId}, ${i})" style="font-size:28px; color:${cor}; cursor:pointer; margin-right:2px;">★</span>`;
    }
    let reviewsHtml = bots.map(b => {
      const curtiu = curtidas[b.id] ? 'color:var(--primary); font-weight:bold;' : 'color:#666;';
      const likeIcon = curtidas[b.id] ? '👍' : '👍🏻';
      return `
      <div style="display:flex; gap:12px; padding:12px 0; border-bottom:1px solid #eee;">
        <div style="width:36px; height:36px; border-radius:50%; background:#eee; display:grid; place-items:center; font-weight:bold; color:#555;">${b.nome.charAt(0)}</div>
        <div style="flex:1;">
          <h4 style="font-size:14px; margin-bottom:2px;">${b.nome}</h4>
          <div style="margin-bottom:4px;">${'★'.repeat(b.nota)}${'☆'.repeat(5-b.nota)}</div>
          <p class="small" style="color:#666; line-height:1.4;">${b.texto}</p>
          <div style="margin-top:6px; cursor:pointer; font-size:12px; display:flex; align-items:center; gap:4px; ${curtiu}" onclick="MinhaHome.curtir('${b.id}')">
            ${likeIcon} Útil (${b.likes + (curtidas[b.id]?1:0)})
          </div>
        </div>
      </div>`;
    }).join('');

    return `
      <div style="background:#fff; margin-bottom:20px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
          <strong style="font-size:24px;">${media}</strong> <div>${estrelasHtml}</div>
          <span class="small muted">(${bots.length + (minhaNota?1:0)} avaliações)</span>
        </div>
        <div style="background:#F0F0F0; padding:16px; border-radius:12px; margin-bottom:16px;">
          <p class="small" style="font-weight:700; margin-bottom:8px;">Avalie este prato:</p>
          <div>${userStars}</div>
        </div>
        <h4 style="font-size:16px; margin-bottom:8px;">Comentários</h4>
        ${reviewsHtml}
      </div>`;
  }

  function comidaPrimeiroView() {
    let items = (db.menu_items || []).filter(i => i.is_available !== false);
    const cats = db.categories || [];
    const stores = db.stores || [];
    const catAtiva = state.selectedCategory;
    
    if (catAtiva) {
      const lc = stores.filter(s => s.category_id === catAtiva).map(s => s.id);
      items = items.filter(i => lc.includes(i.store_id));
    }
    const termoBusca = (state.search || '').toLowerCase();
    if (termoBusca) items = items.filter(i => i.name.toLowerCase().includes(termoBusca));
    const destaques = items.slice(0, 12);

    return `
    <div class="main">
      <section class="hero-banner">
        <h1>O que você quer comer hoje?</h1>
        <p>Escolha um prato. A gente leva até você na velocidade que merece.</p>
        <button class="btn-hero" onclick="MinhaHome.verLojas()">Ver Lojas</button>
      </section>

      <section style="margin-bottom:32px">
        <h2 style="margin-bottom:16px; font-size:20px; color:var(--text);">Categorias</h2>
        <div class="cats">
          <div class="cat-pill ${!catAtiva ? 'active' : ''}" onclick="MinhaHome.filtrar(null)">
            ${renderImagemCategoria('Todos')} Todos
          </div>
          ${cats.map(c => `
            <div class="cat-pill ${catAtiva == c.id ? 'active' : ''}" onclick="MinhaHome.filtrar(${c.id})">
              ${renderImagemCategoria(c.name)} ${esc(c.name)}
            </div>
          `).join('')}
        </div>
      </section>

      <section style="margin-bottom:32px">
        <h2 style="margin-bottom:16px; font-size:20px; color:var(--text);">${termoBusca ? `Resultados para "${termoBusca}"` : 'Pratos Populares'}</h2>
        <div class="prods-grid">
          ${destaques.length ? destaques.map(i => {
            const loja = stores.find(s => s.id == i.store_id);
            const parsed = parseItemImage(i.description); 
            const img = parsed.img || getImagemComida(i.id, i.name); 
            return `<div class="card-item" onclick="MinhaHome.verComida(${i.id})">
              <div class="card-img"><img src="${img}"></div>
              <div class="card-info">
                <h4>${esc(i.name)}</h4>
                <p class="store-name">${esc(loja?.name || 'Loja')}</p>
                <div class="card-footer">
                  <strong>${money(i.price)}</strong>
                  <button class="btn-add" onclick="event.stopPropagation(); addToCart('${i.id}'); toast('Adicionado!')">+</button>
                </div>
              </div>
            </div>`;
          }).join('') : '<p class="muted">Nenhum prato encontrado.</p>'}
        </div>
      </section>
    </div>`;
  }

  function todasLojasView() {
    const stores = db.stores || [];
    const FACHADAS = ['https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=400&q=80','https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=400&q=80','https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=400&q=80'];

    return `
    <div class="main">
      <div class="owner-header" style="margin-bottom:24px; border:none; padding:0; display:flex; justify-content:space-between; align-items:center;">
        <h1>Todas as Lojas</h1><button class="btn btn-ghost btn-sm" onclick="MinhaHome.voltarHome()">Voltar</button>
      </div>
      <div class="stores-grid">
        ${stores.map(s => {
          const perfis = localStorage.getItem('local_store_profiles') ? JSON.parse(localStorage.getItem('local_store_profiles')) : {};
          const capaSalva = perfis[s.id]?.cover;
          const bg = capaSalva || FACHADAS[s.id % FACHADAS.length];
          return `<div class="store-card" onclick="MinhaHome.abrirLoja(${s.id})">
            <div class="store-img"><img src="${bg}"></div>
            <div class="store-info">
              <h3>${esc(s.name)}</h3><p class="small muted">${s.category_id ? (db.categories.find(c=>c.id==s.category_id)||{}).name : 'Geral'}</p>
              <div class="store-meta"><span class="rating">★ 4.8</span><span>30-40 min</span></div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  window.Route = function () {
    if (typeof state !== 'undefined' && state.route === 'home') {
      if (state._homeMode === 'stores') return todasLojasView();
      return comidaPrimeiroView();
    }
    return _origRoute();
  };

  window.MinhaHome = {
    filtrar(id) { if(window.vibrar) window.vibrar(); state._homeMode = 'food'; state.selectedCategory = id; render(); },
    verLojas() { if(window.vibrar) window.vibrar(); state._homeMode = 'stores'; render(); },
    voltarHome() { if(window.vibrar) window.vibrar(); state._homeMode = 'food'; render(); },
    avaliar(itemId, nota) {
      if(window.vibrar) window.vibrar(100);
      let votos = {}; try { votos = JSON.parse(localStorage.getItem('avaliacoes_reais') || '{}'); } catch(e){}
      votos[itemId] = nota; localStorage.setItem('avaliacoes_reais', JSON.stringify(votos));
      toast('Avaliação registrada!');
      this.verComida(itemId);
    },
    curtir(botId) {
      if(window.vibrar) window.vibrar();
      let curtidas = {}; try { curtidas = JSON.parse(localStorage.getItem('curtidas_reviews') || '{}'); } catch(e){}
      curtidas[botId] = !curtidas[botId]; localStorage.setItem('curtidas_reviews', JSON.stringify(curtidas));
      const itemId = parseInt(document.getElementById('modalRoot').getAttribute('data-item-id'));
      if(itemId) this.verComida(itemId);
    },
    verComida(id) {
      if(window.vibrar) window.vibrar();
      const item = (db.menu_items || []).find(i => i.id == id);
      if(!item) return;
      const loja = (db.stores || []).find(s => s.id == item.store_id);
      const parsed = parseItemImage(item.description);
      const img = parsed.img || getImagemComida(item.id, item.name);
      const desc = parsed.text;

      document.getElementById('modalRoot').setAttribute('data-item-id', id);
      document.getElementById('modalRoot').innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal-box food-modal" style="position:relative;">
          <button class="ml-x" onclick="closeModal()">✕</button>
          <div style="height:220px; width:100%;"><img src="${img}" style="width:100%;height:100%;object-fit:cover;"></div>
          <div style="padding:24px;">
            <h2 style="font-size:24px; font-weight:800; margin-bottom:4px; font-family:'Montserrat';">${esc(item.name)}</h2>
            <strong style="font-size:22px; color:var(--primary); display:block; margin-bottom:12px; font-family:'Montserrat';">${money(item.price)}</strong>
            <p style="color:#666; line-height:1.5; margin-bottom:20px; font-size:15px;">${esc(desc)}</p>
            
            <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:24px;">
              <button class="btn btn-primary btn-block" onclick="addToCart('${item.id}'); closeModal();" style="padding:16px;">Adicionar ao Carrinho</button>
              <button class="btn btn-ghost btn-block" onclick="closeModal(); navigate('store', {id:'${item.store_id}'})" style="padding:16px;">Ir para a Loja</button>
            </div>
            ${renderEstrelas(item.id)}
          </div>
        </div>
      </div>`;
      document.body.classList.add('no-scroll');
    },
    abrirLoja(id) {
      if(window.vibrar) window.vibrar();
      navigate('store', { id: id });
    }
  };
})();