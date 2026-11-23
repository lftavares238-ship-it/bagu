'use strict';
(function () {
  window.calcularDistanciaKm = function (lat1, lng1, lat2, lng2) {
    if ([lat1, lng1, lat2, lng2].some(v => v == null || isNaN(v))) return null;
    const R = 6371, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  window.calcularTaxaDistancia = function (km) {
    if (km == null) return 5.00;
    return +(2.00 + (km * 1.50)).toFixed(2); 
  };

  window.vibrar = function(ms = 50) {
    if (navigator.vibrate) navigator.vibrate(ms);
  };

  window.obterLocalizacaoSegura = async function () {
    const userId = session ? session.id : 'anonimo';
    const chaveLoc = 'loc_user_' + userId;
    const salva = localStorage.getItem(chaveLoc);
    if (salva) { try { const p = JSON.parse(salva); if (p && p.lat) return p; } catch(e){} }
    
    if (navigator.geolocation) {
      try {
        const pos = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { timeout: 8000 }));
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, fonte: 'GPS' };
        localStorage.setItem(chaveLoc, JSON.stringify(loc));
        return loc;
      } catch (e) {}
    }
    return null; 
  };

  document.addEventListener('click', async (e) => {
    const alvo = e.target.closest('[data-loc-gps], .btn-loc-gps');
    if (!alvo) return;
    e.preventDefault();
    window.vibrar();
    if (typeof toast === 'function') toast('Buscando sua localização...');
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, fonte: 'GPS' };
        localStorage.setItem('loc_user_' + (session ? session.id : 'anonimo'), JSON.stringify(loc));
        if (typeof state !== 'undefined') { state.location = loc; if (typeof render === 'function') render(); }
        if (typeof toast === 'function') toast('Localização atualizada!');
      }, () => { if (typeof toast === 'function') toast('Permissão de GPS negada.', 'error'); });
    }
  });
})();