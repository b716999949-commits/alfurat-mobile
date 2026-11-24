import productSeed from '../data/catalog_seed.json';
import socialSeed from '../data/social_seed.json';
import settingsSeed from '../data/settings_seed.json';

type Db = D1Database;
type Env = Cloudflare.Env;
type RecordRow = Record<string, any>;
const settingsKeys = Object.keys(settingsSeed);
const statuses = ['جديد','قيد التجهيز','تم الشحن','مكتمل','ملغي'];
const payments = ['عند الاستلام','تحويل بنكي / محفظة','الاتفاق مع المتجر'];
const columns = 'id,name,category,description,price,old_price,image_url,badge,featured,stock,created_at,brand,model,sku,specs_json,product_url,video_url,external_id,source';
const insertSql = `INSERT INTO products (${columns}) VALUES (${Array(19).fill('?').join(',')})`;
const updateSql = 'UPDATE products SET name=?,category=?,description=?,price=?,old_price=?,image_url=?,badge=?,featured=?,stock=?,brand=?,model=?,sku=?,specs_json=?,product_url=?,video_url=?,external_id=?,source=? WHERE id=?';
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-','').slice(0,12)}`;
const now = () => new Date().toISOString();
const json = (data: unknown,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const fail = (detail: string,status=422) => json({detail},status);
const object = (x: unknown): x is RecordRow => x !== null && typeof x === 'object' && !Array.isArray(x);
const string = (x: unknown,min=0,max=1500) => typeof x === 'string' && x.trim().length>=min && x.length<=max;
const number = (x: unknown,min:number,max:number) => typeof x === 'number' && Number.isFinite(x) && x>=min && x<=max;
const idSafe = (x:string) => /^[A-Za-z0-9_-]{1,100}$/.test(x);
function safeLink(x: unknown,internal=false) {
  if(x==='')return true;
  if(!string(x,1,1500))return false;
  if(internal && /^\/uploads\/[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(x as string))return true;
  if(internal && /^\/static\/assets\/(?:products|ads)\/[a-z0-9-]+\.(?:svg|webp)$/.test(x as string))return true;
  try {const u=new URL(x as string);return (u.protocol==='https:'||u.protocol==='http:')&&!u.username&&!u.password;}catch{return false;}
}
async function all(db:Db,sql:string,...args:unknown[]):Promise<RecordRow[]> {return (await db.prepare(sql).bind(...args).all()).results as RecordRow[];}
async function one(db:Db,sql:string,...args:unknown[]):Promise<RecordRow|null> {return db.prepare(sql).bind(...args).first() as Promise<RecordRow|null>;}
function seedValues(p:RecordRow) {return [p.id,p.name,p.category,p.description||'',p.price||0,p.old_price||0,p.image_url||'',p.badge||'',p.featured?1:0,p.stock??-1,p.created_at||now(),p.brand||'',p.model||'',p.sku||'',JSON.stringify(p.specs||{}),p.product_url||'',p.video_url||'',p.external_id||'',p.source||'initial-display'];}
async function ensureSeed(db:Db) {
  if(await one(db,"SELECT value FROM settings WHERE key='store_seed_version'"))return;
  const statements:D1PreparedStatement[]=[];
  for(const [key,value] of Object.entries(settingsSeed))statements.push(db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').bind(key,value));
  for(const p of productSeed)statements.push(db.prepare(insertSql.replace('INSERT INTO','INSERT OR IGNORE INTO')).bind(...seedValues(p)));
  for(const p of socialSeed)statements.push(db.prepare('INSERT OR IGNORE INTO social_posts (id,title,description,post_type,source,url,image_url,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(p.id,p.title,p.description,p.post_type,p.source,p.url,p.image_url,p.created_at));
  statements.push(db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('store_seed_version','2026-11-22-v1')"));
  await db.batch(statements);
}
async function readSettings(db:Db) {const result:Record<string,string>={};for(const p of await all(db,'SELECT key,value FROM settings'))if(settingsKeys.includes(p.key))result[p.key]=p.value;return result;}
async function readProducts(db:Db) {return (await all(db,'SELECT * FROM products ORDER BY featured DESC, created_at DESC')).map(p=>{const {specs_json,...rest}=p;let specs={};try{specs=JSON.parse(specs_json||'{}')}catch{}return {...rest,specs} as RecordRow;});}
const readVideos=(db:Db)=>all(db,'SELECT * FROM videos ORDER BY created_at DESC');
const readSocial=(db:Db)=>all(db,'SELECT * FROM social_posts ORDER BY created_at DESC,id DESC');
function identity(request:Request){const id=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');return id&&email?{id,email}:null;}
function sameOrigin(request:Request){const origin=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site');return (!origin||origin===new URL(request.url).origin)&&site!=='cross-site'&&request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json');}
async function authorize(request:Request,env:Env) {
  const userId=request.headers.get('oai-authenticated-user-id');if(!userId)return fail('يرجى تسجيل الدخول',401);
  const email=request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  const adminEmails=[env.ADMIN_EMAIL,env.ADMIN_OWNER_EMAIL].filter(Boolean).map(value=>value!.trim().toLowerCase());
  if(!email||!adminEmails.includes(email))return fail('هذه اللوحة مخصصة لصاحب المتجر',403);
  if(!['GET','HEAD'].includes(request.method)){
    const origin=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site');
    if((origin&&origin!==new URL(request.url).origin)||site==='cross-site')return fail('مصدر الطلب غير مسموح',403);
    if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return fail('نوع البيانات غير صالح',415);
  }
  return null;
}
async function body(request:Request):Promise<RecordRow|null> {try{const x=await request.json();return object(x)?x:null;}catch{return null;}}
function product(raw:RecordRow) {
  const p=raw,price=p.price??0,old=p.old_price??0,stock=p.stock??-1,specs=p.specs??{};
  if(!string(p.name,2,140)||!string(p.category,2,65)||!string(p.description??'',0,3000)||!string(p.badge??'',0,40))return null;
  if(!number(price,0,1e12)||!number(old,0,1e12)||!Number.isInteger(stock)||!number(stock,-1,1e6))return null;
  for(const key of ['brand','model','sku','external_id','source'])if(!string(p[key]??'',0,key==='external_id'?150:100))return null;
  for(const key of ['image_url','product_url','video_url'])if(!safeLink(p[key]??'',key==='image_url'))return null;
  if(!object(specs)||Object.keys(specs).length>36||Object.entries(specs).some(([k,v])=>k.length>95||!string(v,0,500)))return null;
  return {name:p.name.trim(),category:p.category.trim(),description:String(p.description??'').trim(),price,old_price:old,image_url:p.image_url??'',badge:String(p.badge??'').trim(),featured:p.featured?1:0,stock,brand:String(p.brand??'').trim(),model:String(p.model??'').trim(),sku:String(p.sku??'').trim(),specs_json:JSON.stringify(specs),product_url:p.product_url??'',video_url:p.video_url??'',external_id:String(p.external_id??'').trim(),source:String(p.source??'manual')};
}
function values(p:RecordRow,id:string,created:string){return [id,p.name,p.category,p.description,p.price,p.old_price,p.image_url,p.badge,p.featured,p.stock,created,p.brand,p.model,p.sku,p.specs_json,p.product_url,p.video_url,p.external_id,p.source];}
function updateValues(p:RecordRow,id:string){const v=values(p,id,'');return [...v.slice(1,10),...v.slice(11),id];}
function video(p:RecordRow){return string(p.title,2,140)&&string(p.description??'',0,1500)&&safeLink(p.url)&&p.url&&safeLink(p.thumbnail_url??'')?{title:p.title.trim(),url:p.url,description:p.description??'',thumbnail_url:p.thumbnail_url??''}:null;}
function social(p:RecordRow){return string(p.title,2,140)&&string(p.description??'',0,1500)&&['advert','video','post'].includes(p.post_type??'advert')&&['facebook','store_creative'].includes(p.source??'facebook')&&safeLink(p.url??'')&&safeLink(p.image_url??'',true)?{title:p.title.trim(),description:p.description??'',post_type:p.post_type??'advert',source:p.source??'facebook',url:p.url??'',image_url:p.image_url??''}:null;}
async function upload(p:RecordRow,env:Env) {
  if(!string(p.data,1,6_000_000))return fail('حجم الصورة كبير جداً');
  try {
    const matched=String(p.data).match(/^data:image\/(png|jpeg|webp);base64,([\s\S]*)$/);if(!matched)return fail('الصورة غير صالحة');
    const binary=atob(matched[2]);if(binary.length>4*1024*1024)return fail('الصورة أكبر من 4MB');
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
    const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
    if(!(jpeg||png||webp))return fail('استخدم JPEG أو PNG أو WEBP');
    if(!env.BUCKET)return fail('حفظ الصور غير متاح',503);
    const ext=jpeg?'jpg':png?'png':'webp',type=jpeg?'image/jpeg':png?'image/png':'image/webp',key=crypto.randomUUID().replaceAll('-','')+'.'+ext;
    await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type}});return json({url:'/uploads/'+key});
  }catch{return fail('الصورة غير صالحة');}
}
export async function uploadedImage(request:Request,env:Env) {
  const key=new URL(request.url).pathname.replace(/^\/uploads\//,'');
  if(!env.BUCKET||!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(key))return new Response('Not found',{status:404});
  const file=await env.BUCKET.get(key);if(!file)return new Response('Not found',{status:404});
  return new Response(file.body,{headers:{'Content-Type':file.httpMetadata?.contentType||'image/webp','Cache-Control':'public, max-age=86400'}});
}
export async function handleApi(request:Request,env:Env) {
  const db=env.DB;if(!db)return fail('قاعدة البيانات غير متاحة',503);
  const path=new URL(request.url).pathname,method=request.method;
  try {
    await ensureSeed(db);
    if(path==='/api/catalog'&&method==='GET'){
      const products=await readProducts(db);
      return json({settings:await readSettings(db),products,videos:await readVideos(db),social_posts:await readSocial(db),demo:products.some(p=>!p.image_url||p.image_url.endsWith('.svg'))||products.every(p=>!Number(p.price))});
    }
    if(path==='/api/account'&&method==='GET'){
      const user=identity(request);if(!user)return fail('يرجى تسجيل الدخول',401);
      const profile=await one(db,'SELECT email,name,phone,city,address,created_at FROM customers WHERE id=?',user.id);
      const orders=(await all(db,'SELECT id,total,status,created_at,items_json FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 100',user.id)).map(o=>{let items=[];try{items=JSON.parse(o.items_json)}catch{}return {id:o.id,total:o.total,status:o.status,created_at:o.created_at,items};});
      return json({profile:profile||{email:user.email,name:'',phone:'',city:'',address:''},orders});
    }
    if(path==='/api/account'&&method==='PUT'){
      const user=identity(request);if(!user)return fail('يرجى تسجيل الدخول',401);
      if(!sameOrigin(request))return fail('طلب غير مسموح',403);
      const p=await body(request);if(!p||!string(p.name,2,100)||!string(p.phone,6,35)||!string(p.city,2,100)||!string(p.address,3,300))return fail('أكمل بيانات الحساب المطلوبة');
      await db.prepare('INSERT INTO customers (id,email,name,phone,city,address,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,phone=excluded.phone,city=excluded.city,address=excluded.address,updated_at=excluded.updated_at').bind(user.id,user.email,p.name.trim(),p.phone.trim(),p.city.trim(),p.address.trim(),now(),now()).run();return json({ok:true});
    }
    if(path==='/api/orders'&&method==='POST'){
      if(!sameOrigin(request))return fail('طلب غير مسموح',403);
      const p=await body(request);
      if(!p||!string(p.customer_name,2,100)||!string(p.phone,6,35)||!string(p.city,2,100)||!string(p.address,3,300)||!string(p.note??'',0,1000)||!payments.includes(p.payment_method??'عند الاستلام')||!Array.isArray(p.items)||p.items.length<1||p.items.length>30)return fail('بيانات الطلب غير مكتملة');
      if(p.items.some((x:unknown)=>!object(x)||!string(x.id,1,70)||!Number.isInteger(x.quantity)||!number(x.quantity,1,99)))return fail('المنتجات أو الكميات غير صالحة');
      const ids=p.items.map((x:RecordRow)=>x.id);if(new Set(ids).size!==ids.length)return fail('منتجات مكررة في الطلب');
      const selected=await Promise.all(ids.map((id:string)=>one(db,'SELECT id,name,price,stock FROM products WHERE id=?',id)));
      if(selected.some(x=>!x))return fail('أحد المنتجات لم يعد متاحاً');
      let total=0;const items=[];
      for(let i=0;i<selected.length;i++){const item=selected[i]!,quantity=p.items[i].quantity;if(item.stock===0||(item.stock!==-1&&quantity>item.stock))return fail('الكمية المطلوبة غير متوفرة: '+item.name);const subtotal=Math.round(item.price*quantity*100)/100;total=Math.round((total+subtotal)*100)/100;items.push({id:item.id,name:item.name,price:item.price,quantity,subtotal});}
      const orderId='FUR-'+now().slice(2,10).replaceAll('-','')+'-'+crypto.randomUUID().slice(0,6).toUpperCase();
      const customer=identity(request);
      await db.prepare('INSERT INTO orders (id,customer_name,phone,city,address,note,payment_method,items_json,total,status,created_at,customer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(orderId,p.customer_name.trim(),p.phone.trim(),p.city.trim(),p.address.trim(),String(p.note??'').trim(),p.payment_method??'عند الاستلام',JSON.stringify(items),total,'جديد',now(),customer?.id??null).run();
      return json({ok:true,order_id:orderId,total,items});
    }
    if(!path.startsWith('/api/admin/'))return fail('غير موجود',404);
    const denied=await authorize(request,env);if(denied)return denied;
    if(path==='/api/admin/me'&&method==='GET')return json({ok:true,csrf:'site-identity'});
    if(path==='/api/admin/data'&&method==='GET'){
      const orders=(await all(db,'SELECT * FROM orders ORDER BY created_at DESC LIMIT 500')).map(o=>{const {items_json,...rest}=o;let items=[];try{items=JSON.parse(items_json)}catch{}return {...rest,items};});
      const customers=await all(db,'SELECT c.id,c.email,c.name,c.phone,c.city,c.created_at,COUNT(o.id) AS order_count FROM customers c LEFT JOIN orders o ON o.customer_id=c.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 500');
      return json({settings:await readSettings(db),products:await readProducts(db),videos:await readVideos(db),social_posts:await readSocial(db),orders,customers});
    }
    if(path==='/api/admin/settings'&&method==='PUT'){
      const p=await body(request);if(!p)return fail('بيانات غير صالحة');const statements:D1PreparedStatement[]=[];
      for(const [key,value] of Object.entries(p)){if(!settingsKeys.includes(key))continue;if(!string(value,0,1600)||(/^(logo_url|instagram|facebook|facebook_page_url|tiktok|youtube|telegram|snapchat|x|app_url)$/.test(key)&&!safeLink(value,key==='logo_url')))return fail('قيمة غير صالحة: '+key);statements.push(db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,String(value).trim()));}
      if(statements.length)await db.batch(statements);return json({ok:true});
    }
    const productPath=path.match(/^\/api\/admin\/products(?:\/([^/]+))?$/);
    if(productPath){const id=productPath[1]?decodeURIComponent(productPath[1]):'';if(id&&!idSafe(id))return fail('معرّف غير صالح');
      if(method==='DELETE'&&id){const r=await db.prepare('DELETE FROM products WHERE id=?').bind(id).run();return r.meta.changes?json({ok:true}):fail('المنتج غير موجود',404);}
      if((method==='POST'&&!id)||(method==='PUT'&&id)){const raw=await body(request),p=raw&&product(raw);if(!p)return fail('بيانات المنتج غير صالحة');if(method==='POST'){const newId=uid('prd');await db.prepare(insertSql).bind(...values(p,newId,now())).run();return json({ok:true,id:newId});}const r=await db.prepare(updateSql).bind(...updateValues(p,id)).run();return r.meta.changes?json({ok:true}):fail('المنتج غير موجود',404);}
    }
    const videoPath=path.match(/^\/api\/admin\/videos(?:\/([^/]+))?$/);
    if(videoPath){const id=videoPath[1]?decodeURIComponent(videoPath[1]):'';if(id&&!idSafe(id))return fail('معرّف غير صالح');
      if(method==='DELETE'&&id){const r=await db.prepare('DELETE FROM videos WHERE id=?').bind(id).run();return r.meta.changes?json({ok:true}):fail('الفيديو غير موجود',404);}
      if((method==='POST'&&!id)||(method==='PUT'&&id)){const raw=await body(request),p=raw&&video(raw);if(!p)return fail('بيانات الفيديو غير صالحة');if(method==='POST'){const newId=uid('vid');await db.prepare('INSERT INTO videos (id,title,url,description,thumbnail_url,created_at) VALUES (?,?,?,?,?,?)').bind(newId,p.title,p.url,p.description,p.thumbnail_url,now()).run();return json({ok:true,id:newId});}const r=await db.prepare('UPDATE videos SET title=?,url=?,description=?,thumbnail_url=? WHERE id=?').bind(p.title,p.url,p.description,p.thumbnail_url,id).run();return r.meta.changes?json({ok:true}):fail('الفيديو غير موجود',404);}
    }
    const socialPath=path.match(/^\/api\/admin\/social-posts(?:\/([^/]+))?$/);
    if(socialPath){const id=socialPath[1]?decodeURIComponent(socialPath[1]):'';if(id&&!idSafe(id))return fail('معرّف غير صالح');
      if(method==='DELETE'&&id){const r=await db.prepare('DELETE FROM social_posts WHERE id=?').bind(id).run();return r.meta.changes?json({ok:true}):fail('المنشور غير موجود',404);}
      if((method==='POST'&&!id)||(method==='PUT'&&id)){const raw=await body(request),p=raw&&social(raw);if(!p)return fail('بيانات المنشور غير صالحة');if(method==='POST'){const newId=uid('social');await db.prepare('INSERT INTO social_posts (id,title,description,post_type,source,url,image_url,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(newId,p.title,p.description,p.post_type,p.source,p.url,p.image_url,now()).run();return json({ok:true,id:newId});}const r=await db.prepare('UPDATE social_posts SET title=?,description=?,post_type=?,source=?,url=?,image_url=? WHERE id=?').bind(p.title,p.description,p.post_type,p.source,p.url,p.image_url,id).run();return r.meta.changes?json({ok:true}):fail('المنشور غير موجود',404);}
    }
    if(path==='/api/admin/upload'&&method==='POST'){const p=await body(request);return p?upload(p,env):fail('الصورة غير صالحة');}
    if(path==='/api/admin/import'&&method==='POST'){
      const p=await body(request),records=p?.products;
      if(!Array.isArray(records)||records.length<1||records.length>1000||!['merge','append'].includes(p?.mode??'merge'))return fail('ملف استيراد غير صالح');
      const validated=records.map((x:unknown)=>object(x)?product(x):null);if(validated.some((x:unknown)=>!x))return fail('بيانات أحد المنتجات غير صالحة');
      const existing=await all(db,'SELECT id,external_id,sku FROM products'),byExternal=new Map(existing.filter(x=>x.external_id).map(x=>[x.external_id,x.id])),bySku=new Map(existing.filter(x=>x.sku).map(x=>[x.sku,x.id]));
      const statements:D1PreparedStatement[]=[];let added=0,updated=0;
      for(const item of validated){const x=item!,match=p?.mode==='append'?null:(x.external_id&&byExternal.get(x.external_id))||(x.sku&&bySku.get(x.sku));if(match){statements.push(db.prepare(updateSql).bind(...updateValues(x,match)));updated++;}else{const id=uid('prd');statements.push(db.prepare(insertSql).bind(...values({...x,source:x.source==='manual'?'import':x.source},id,now())));if(x.external_id)byExternal.set(x.external_id,id);if(x.sku)bySku.set(x.sku,id);added++;}}
      await db.batch(statements);return json({ok:true,added,updated,total:validated.length});
    }
    const orderPath=path.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if(orderPath&&method==='PATCH'){const id=decodeURIComponent(orderPath[1]),p=await body(request);if(!idSafe(id)||!p||!statuses.includes(p.status))return fail('حالة غير صالحة');const r=await db.prepare('UPDATE orders SET status=? WHERE id=?').bind(p.status,id).run();return r.meta.changes?json({ok:true}):fail('الطلب غير موجود',404);}
    return fail('غير موجود',404);
  }catch(error){console.error('Store API error',error);return fail('تعذر إكمال العملية، حاول مرة أخرى',500);}
}
