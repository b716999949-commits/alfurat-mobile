'use strict';
// Catalog presentation uses the existing API, cart and admin. No product data is duplicated here.
const adArtwork = {
  furat_m60_plus:'m60-plus', furat_m45s:'m45s',
  furat_m10i:'m10i', furat_romoss_j35:'romoss-j35'
};
const catalogPhoto = p => !!adArtwork[p.id] && p.image_url === `/static/assets/products/${adArtwork[p.id]}.webp`;
const illustration = p => !p.image_url || /\/static\/assets\/products\/[^/]+\.svg$/i.test(p.image_url);
const shortDescription = p => String(p.description||'').split(' | ')[0];
const imageLabel = p => illustration(p) ? `رسم توضيحي لفئة ${p.category}` : `صورة ${p.name}`;

let favorites;
try {
  const saved = JSON.parse(localStorage.getItem('furat_favorites') || '[]');
  favorites = new Set(Array.isArray(saved) ? saved.filter(x=>typeof x === 'string') : []);
} catch { favorites = new Set(); }
state.onlyFavorites = false;
state.catalogView = localStorage.getItem('furat_catalog_view') === 'list' ? 'list' : 'grid';

imageFor = function(p) {
  const fallback = `<div class="product-illustration product-illustration-real image-fallback" ${p.image_url?'hidden':''}>${realisticIcon(p.category)}</div>`;
  return (p.image_url ? `<img class="product-img-real" src="${esc(assetUrl(p.image_url))}" alt="${esc(imageLabel(p))}" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false" />` : '') + fallback;
};

function renderFeatured() {
  const products = state.products.filter(catalogPhoto).slice(0,4);
  $('.featured-section').hidden = !products.length;
  $('#featured-products').innerHTML = products.map((p,i)=>`
    <button class="featured-card featured-card-${i+1}" type="button" data-featured="${esc(p.id)}" aria-label="استعراض ${esc(p.name)}">
      <span class="featured-photo"><img src="${esc(assetUrl(p.image_url))}" alt="${esc(imageLabel(p))}" loading="lazy" decoding="async"></span>
      <span class="featured-copy"><small>${esc(p.category)} · من إعلانات المتجر</small><strong>${esc(p.name)}</strong><span>شاهد الصور والتفاصيل</span></span>
    </button>`).join('');
}

function catalogSort(a,b) {
  if (state.sort === 'price-low' || state.sort === 'price-high') {
    const aMissing = Number(a.price) <= 0, bMissing = Number(b.price) <= 0;
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (!aMissing) return state.sort === 'price-low' ? a.price-b.price : b.price-a.price;
  }
  if (state.sort === 'name') return a.name.localeCompare(b.name,'ar');
  if (state.sort === 'newest') return String(b.created_at||'').localeCompare(String(a.created_at||''));
  return Number(b.featured)-Number(a.featured) || String(b.created_at||'').localeCompare(String(a.created_at||''));
}

renderProducts = function() {
  const term = state.search.trim().toLocaleLowerCase('ar');
  const all = state.products.filter(p =>
    (state.filter === 'الكل' || p.category === state.filter) &&
    (!state.onlyFavorites || favorites.has(p.id)) &&
    (!term || [p.name,p.description,p.category,p.brand,p.model,p.sku,...Object.values(p.specs||{})]
      .join(' ').toLocaleLowerCase('ar').includes(term))
  ).sort(catalogSort);
  const grid = $('#product-grid');
  grid.classList.toggle('list-view',state.catalogView === 'list');
  $('#products-total').textContent = `${all.length} منتج`;
  $('#catalog-summary').textContent = `يعرض ${all.length} من ${state.products.length} منتج · ${allCategories().length} أقسام`;
  $('#favorites-count').textContent = favorites.size;
  $('#favorites-filter').setAttribute('aria-pressed', String(state.onlyFavorites));
  $('#favorites-filter').classList.toggle('selected',state.onlyFavorites);
  for(const v of ['grid','list']) {
    const el = $('#view-'+v), active = state.catalogView === v;
    el.setAttribute('aria-pressed',String(active));el.classList.toggle('view-active',active);
  }
  grid.innerHTML = all.map((p,i)=>{
    const tags = Object.entries(p.specs||{}).filter(([k,v])=>v && ['الشاشة','الذاكرة الداخلية','البطارية','السعة'].includes(k)).slice(0,2);
    const saved = favorites.has(p.id);
    return `<article class="product-card ${illustration(p)?'is-illustration':'is-photo'}" style="animation-delay:${Math.min(i*20,160)}ms">
      <div class="product-image">
        <button type="button" class="product-media" data-quick="${esc(p.id)}" aria-label="عرض صور وتفاصيل ${esc(p.name)}">${imageFor(p)}</button>
        ${p.badge?`<span class="product-badge">${esc(p.badge)}</span>`:''}
        <button type="button" class="favorite-btn ${saved?'is-saved':''}" data-fav="${esc(p.id)}" aria-pressed="${saved}" aria-label="${saved?'إزالة من':'إضافة إلى'} المفضلة: ${esc(p.name)}">${svgIcon('heart')}</button>
        <span class="image-kind">${illustration(p)?'صورة توضيحية':catalogPhoto(p)?'صورة من إعلان المتجر':'صورة المنتج'}</span>
      </div>
      <div class="product-details">
        <div class="product-meta"><span class="product-category">${esc(p.category)}</span><span class="availability ${p.stock===0?'out':''}">${p.stock===0?'غير متوفر':p.stock>0?'متوفر':'التوفر عند الطلب'}</span></div>
        <h3><button type="button" class="product-title" data-quick="${esc(p.id)}">${esc(p.name)}</button></h3>
        <p class="product-description">${esc(shortDescription(p))}</p>
        ${tags.length?`<div class="spec-chips">${tags.map(([k,v])=>`<span>${esc(k)}: ${esc(v)}</span>`).join('')}</div>`:'<div class="spec-chips spec-empty"><span>اسأل عن التفاصيل المتاحة</span></div>'}
        <div class="product-price-line"><div><small>السعر</small><strong class="product-price ${p.price?'':'ask'}">${money(p.price)}</strong>${Number(p.old_price)>Number(p.price)&&Number(p.price)>0?`<span class="old-price">${money(p.old_price)}</span>`:''}</div><button type="button" class="product-add" data-add="${esc(p.id)}" ${p.stock===0?'disabled':''}>${svgIcon('bag')} <span>أضف للسلة</span></button></div>
      </div>
    </article>`;
  }).join('');
  $('#products-empty').hidden = all.length !== 0;
  if (!all.length) $('#products-empty h3').textContent = state.onlyFavorites && !term ? 'لم تضف منتجات للمفضلة بعد' : 'لم نجد منتجات مطابقة';
  renderFeatured();
};

function toggleFavorite(id) {
  if(favorites.has(id)) favorites.delete(id); else favorites.add(id);
  localStorage.setItem('furat_favorites',JSON.stringify([...favorites]));
  renderProducts();
  toast(favorites.has(id) ? 'أُضيف المنتج إلى المفضلة' : 'أُزيل المنتج من المفضلة');
}

function galleryMedia(p, src, alt) {
  if(!src) return imageFor(p);
  return `<img class="product-img-real" src="${esc(assetUrl(src))}" alt="${esc(alt)}" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false" /><div class="product-illustration product-illustration-real image-fallback" hidden>${realisticIcon(p.category)}</div>`;
}

openQuick = function(id) {
  const p = state.products.find(x=>x.id===id);if(!p)return;
  state.currentProduct = id;
  const ad = catalogPhoto(p) ? `/static/assets/ads/${adArtwork[p.id]}.webp` : '';
  const photos = [{src:p.image_url,label:'صورة المنتج',alt:imageLabel(p)},...(ad?[{src:ad,label:'صورة الإعلان',alt:`الإعلان السابق لمنتج ${p.name}`}]:[])];
  const specs = Object.entries(p.specs||{});
  const app = externalUrl(p.product_url), vid = externalUrl(p.video_url);
  $('.quickview-card').classList.remove('zoomed');
  $('#quickview-body').className = 'quickview-body';
  $('#quickview-body').innerHTML = `<div class="gallery-panel">
    <div class="gallery-stage"><button type="button" class="gallery-zoom" aria-label="تكبير الصورة">${galleryMedia(p,p.image_url,imageLabel(p))}<span>اضغط لتكبير الصورة</span></button></div>
    ${photos.length>1?`<div class="gallery-thumbs" role="group" aria-label="صور المنتج">${photos.map((photo,i)=>`<button type="button" data-gallery="${i}" aria-pressed="${i===0}" aria-label="${photo.label}"><img src="${esc(assetUrl(photo.src))}" alt="" loading="lazy"><span>${photo.label}</span></button>`).join('')}</div>`:''}
    <p class="gallery-note">${illustration(p)?'هذه صورة توضيحية للفئة؛ اطلب صورة الموديل الفعلي من المتجر.':catalogPhoto(p)?'الصور من إعلان سابق للمتجر؛ تأكد من الإصدار والتوفر.':'الصورة كما أضافها مدير المتجر.'}</p>
  </div><div class="quickview-info"><span class="kicker">${esc(p.category)}</span><h3>${esc(p.name)}</h3>
    ${p.brand||p.model?`<p class="product-model">${esc([p.brand,p.model].filter(Boolean).join(' • '))}</p>`:''}
    <p>${esc(shortDescription(p)||'لا توجد تفاصيل إضافية.')}</p>
    ${specs.length?`<h4 class="spec-heading">المواصفات المذكورة</h4><dl class="spec-list">${specs.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`:'<p class="spec-pending">المواصفات التفصيلية لم تُضاف بعد؛ استفسر عن الإصدار المطلوب.</p>'}
    ${catalogPhoto(p)?'<p class="spec-pending">المواصفات من إعلان سابق؛ يرجى تأكيدها قبل الشراء.</p>':''}
    <div class="detail-price"><span>السعر</span><strong>${money(p.price)}</strong></div>
    <div class="detail-actions"><button id="quick-add" class="btn btn-primary" ${p.stock===0?'disabled':''}>${svgIcon('bag')} أضف إلى السلة</button><button class="btn btn-soft" id="quick-close">إغلاق</button></div>
    ${app?`<p><a href="${esc(app)}" target="_blank" rel="noopener noreferrer">عرض المنتج في التطبيق</a></p>`:''}
    ${vid?`<p><a href="${esc(vid)}" target="_blank" rel="noopener noreferrer">شاهد فيديو المنتج</a></p>`:''}
    ${p.stock===0?'<p class="stock-label">المنتج غير متوفر حالياً.</p>':''}
  </div>`;
  const stage = $('.gallery-stage');
  function setPhoto(index){const photo=photos[index];stage.innerHTML=`<button type="button" class="gallery-zoom" aria-label="تكبير الصورة">${galleryMedia(p,photo.src,photo.alt)}<span>اضغط لتكبير الصورة</span></button>`;$$('.gallery-thumbs [data-gallery]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.gallery)===index)));}
  $$('.gallery-thumbs [data-gallery]').forEach(b=>b.onclick=()=>setPhoto(Number(b.dataset.gallery)));
  stage.onclick=e=>{if(e.target.closest('.gallery-zoom'))$('.quickview-card').classList.toggle('zoomed');};
  $('#quick-add').onclick=()=>{addCart(p.id);closeModals();openDrawer();};
  $('#quick-close').onclick=closeModals;
  openModal('quickview-modal');
};

$('#product-grid').addEventListener('click',e=>{
  const fav=e.target.closest('[data-fav]');if(fav){toggleFavorite(fav.dataset.fav);return;}
  const quick=e.target.closest('[data-quick]');if(quick){openQuick(quick.dataset.quick);return;}
  const add=e.target.closest('[data-add]');if(add){addCart(add.dataset.add);}
});
$('#featured-products').addEventListener('click',e=>{
  const card=e.target.closest('[data-featured]');if(card)openQuick(card.dataset.featured);
});
$('#favorites-filter').onclick=()=>{state.onlyFavorites=!state.onlyFavorites;renderProducts();};
for(const view of ['grid','list'])$('#view-'+view).onclick=()=>{
  state.catalogView=view;localStorage.setItem('furat_catalog_view',view);renderProducts();
};
if(state.products.length)renderProducts();
