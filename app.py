"""Alfurat Mobile - Arabic-first mobile store, admin & orders.
Run: python -m pip install -r requirements.txt && python app.py
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from PIL import Image, UnidentifiedImageError

from PIL import Image, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / 'static' if (ROOT / 'static').is_dir() else ROOT

# When deployed with a Railway Volume, store mutable files on persistent storage.
# The bundled catalog/social seed JSON files remain in ROOT/data.
VOLUME = os.environ.get('RAILWAY_VOLUME_MOUNT_PATH', '').strip()
STORAGE = Path(VOLUME) if VOLUME else ROOT
UPLOADS = Path(os.environ.get('STORE_UPLOAD_DIR', str(STORAGE / 'uploads')))
DB = Path(os.environ.get('STORE_DB_PATH', str(STORAGE / ('store.sqlite3' if VOLUME else 'data/store.sqlite3'))))
UPLOADS.mkdir(parents=True, exist_ok=True)
DB.parent.mkdir(parents=True, exist_ok=True)
COOKIE = 'alfurat_admin_session'
SESSION_AGE = 7 * 24 * 3600
MAX_UPLOAD_BYTES = 4 * 1024 * 1024

app = FastAPI(title='الفرات موبايل', docs_url=None, redoc_url=None)
app.mount('/static', StaticFiles(directory=STATIC), name='static')
app.mount('/uploads', StaticFiles(directory=UPLOADS), name='uploads')


def conn():
    db = sqlite3.connect(DB, timeout=15, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA busy_timeout=15000')
    return db


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def hash_password(password: str, salt: bytes | None = None):
    salt = salt or os.urandom(16)
    hashed = hashlib.pbkdf2_hmac('sha256', password.encode('utf8'), salt, 270000)
    return f'{salt.hex()}:{hashed.hex()}'


def check_password(password: str, value: str):
    try:
        salt, expected = value.split(':')
        calculated = hash_password(password, bytes.fromhex(salt)).split(':')[1]
        return secrets.compare_digest(calculated, expected)
    except (ValueError, TypeError):
        return False


def make_id(prefix: str):
    return f'{prefix}_{uuid.uuid4().hex[:12]}'


def init_db():
    db = conn()
    db.executescript('''
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', price REAL NOT NULL DEFAULT 0,
        old_price REAL NOT NULL DEFAULT 0, image_url TEXT NOT NULL DEFAULT '',
        badge TEXT NOT NULL DEFAULT '', featured INTEGER NOT NULL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT -1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', thumbnail_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS social_posts (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        post_type TEXT NOT NULL DEFAULT 'advert', source TEXT NOT NULL DEFAULT 'facebook',
        url TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
        city TEXT NOT NULL, address TEXT NOT NULL, note TEXT NOT NULL,
        payment_method TEXT NOT NULL, items_json TEXT NOT NULL, total REAL NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL);
    ''')
    defaults = {
        'store_name': 'الفرات موبايل',
        'store_subtitle': 'عالم التقنية بين يديك',
        'hero_title': 'تقنيتك تبدأ من هنا',
        'hero_description': 'اكتشف الهواتف الذكية والسماعات والإكسسوارات ومستلزمات الجوال في تجربة تسوق أنيقة وسهلة.',
        'announcement': 'الفرات موبايل — هواتف ذكية وإكسسوارات بتصميم جديد وألوان الشعار',
        'whatsapp': '', 'phone': '', 'address': 'صنعاء - شميلة - مول غزة',
        'currency': 'ر.ي', 'logo_url': '',
        'instagram': '', 'facebook': 'https://www.facebook.com/share/1EAKxFBzAi/', 'facebook_page_url': '', 'tiktok': '', 'youtube': '',
        'telegram': '', 'snapchat': '', 'x': '', 'app_url': '',
        'delivery_text': 'استفسر عن خيارات التوصيل عند تأكيد الطلب',
        'payment_text': 'الدفع عند الاستلام أو التحويل بعد تأكيد الطلب',
    }
    # Existing installations are migrated in-place, keeping products, orders and admin credentials.
    desired_columns = {
        'brand': "TEXT NOT NULL DEFAULT ''", 'model': "TEXT NOT NULL DEFAULT ''",
        'sku': "TEXT NOT NULL DEFAULT ''", 'specs_json': "TEXT NOT NULL DEFAULT '{}'",
        'product_url': "TEXT NOT NULL DEFAULT ''", 'video_url': "TEXT NOT NULL DEFAULT ''",
        'external_id': "TEXT NOT NULL DEFAULT ''", 'source': "TEXT NOT NULL DEFAULT 'manual'"
    }
    existing_columns = {row['name'] for row in db.execute('PRAGMA table_info(products)')}
    for field, definition in desired_columns.items():
        if field not in existing_columns:
            db.execute(f'ALTER TABLE products ADD COLUMN {field} {definition}')
    db.execute('CREATE INDEX IF NOT EXISTS idx_products_external_id ON products(external_id)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)')
    db.executemany('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)', defaults.items())
    # Facebook share link provided by store owner; this is NOT a canonical embeddable page URL.
    db.execute("UPDATE settings SET value=? WHERE key='facebook' AND value=''", ('https://www.facebook.com/share/1EAKxFBzAi/',))
    # Official app listing URL supplied by the shop owner. This is NOT an API endpoint.
    app_link = 'https://play.google.com/store/apps/details?id=com.forat.storeapp'
    db.execute("UPDATE settings SET value=? WHERE key='app_url' AND value=''", (app_link,))
    # Seed owner-provided advertisement designs once, without claiming they were fetched from Facebook.
    social_seed = ROOT / 'data' / 'social_seed.json'
    if social_seed.exists() and not db.execute("SELECT 1 FROM settings WHERE key='social_seed_version'").fetchone():
        for item in json.loads(social_seed.read_text(encoding='utf8')):
            db.execute('''INSERT OR IGNORE INTO social_posts
              (id,title,description,post_type,source,url,image_url,created_at)
              VALUES (:id,:title,:description,:post_type,:source,:url,:image_url,:created_at)''', item)
        db.execute("INSERT OR IGNORE INTO settings (key,value) VALUES ('social_seed_version','2026-11-22-facebook-v1')")
    # Update the initial placeholder examples safely, preserving edited or added products.
    seed_path = ROOT / 'data' / 'catalog_seed.json'
    if seed_path.exists() and not db.execute("SELECT 1 FROM settings WHERE key='catalog_seed_version'").fetchone():
        original_examples = {
            'هاتف ذكي فئة برو': 'تصميم أنيق وشاشة واضحة وكاميرا متطورة. منتج للعرض التجريبي؛ عدّل البيانات من لوحة التحكم.',
            'هاتف ذكي اقتصادي': 'خيار مناسب للاستخدام اليومي. صورة وسعر ووصف قابل للتعديل.',
            'سماعات لاسلكية': 'صوت نقي وعلبة شحن عملية. منتج توضيحي.',
            'سماعة رأس عصرية': 'مظهر عصري وراحة في الاستخدام. بيانات تجريبية.',
            'ساعة ذكية': 'لمسة تقنية لمعصمك؛ أضف مواصفاتها وصورتها وسعرها.',
            'شاحن سريع': 'ملحق عملي لأجهزتك. تحقق من توافقه قبل الشراء.',
            'كابل شحن وبيانات': 'خيارات متنوعة للكابلات والتوصيلات.',
            'حافظة هاتف أنيقة': 'حماية وأناقة لهاتفك بتصاميم متعددة.',
        }
        for name, description in original_examples.items():
            db.execute("DELETE FROM products WHERE name=? AND description=? AND image_url='' AND price=0", (name, description))
        for product in json.loads(seed_path.read_text(encoding='utf8')):
            db.execute("INSERT OR IGNORE INTO products (id,name,category,description,price,old_price,image_url,badge,featured,stock,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              tuple(product[k] for k in ('id','name','category','description','price','old_price','image_url','badge','featured','stock','created_at')))
        db.execute("INSERT OR IGNORE INTO settings (key,value) VALUES ('catalog_seed_version','2026-11-22-lime')")
    # Attach advertised specs to first-time installs, one time only.
    if seed_path.exists() and not db.execute("SELECT 1 FROM settings WHERE key='advertised_specs_version'").fetchone():
        for product in json.loads(seed_path.read_text(encoding='utf8')):
            if product.get('specs'):
                db.execute("UPDATE products SET specs_json=?,brand=?,model=?,source=?,description=? WHERE id=? AND (specs_json='{}' OR specs_json='')",(
                    json.dumps(product['specs'],ensure_ascii=False),product.get('brand',''),
                    product.get('model',''),product.get('source','initial-display'),
                    product.get('description',''),product['id']))
        db.execute("INSERT OR IGNORE INTO settings (key,value) VALUES ('advertised_specs_version','2026-11-22-advertised-v1')")
    if not db.execute('SELECT 1 FROM admins LIMIT 1').fetchone():
        configured_password = os.environ.get('ADMIN_PASSWORD')
        if configured_password and len(configured_password) < 12:
            raise RuntimeError('ADMIN_PASSWORD must have at least 12 characters')
        if os.environ.get('RAILWAY_ENVIRONMENT') and not configured_password:
            raise RuntimeError('Set a secure ADMIN_PASSWORD in Railway Variables before first deployment')
        pwd = configured_password or secrets.token_urlsafe(14)
        db.execute('INSERT INTO admins (password_hash) VALUES (?)', (hash_password(pwd),))
        print('\n'+'='*64)
        print('الفرات موبايل | تم إنشاء حساب المدير لأول مرة')
        print('لوحة التحكم: http://localhost:8000/admin')
        if configured_password:
            print('تم إعداد كلمة مرور المدير عبر متغير بيئة آمن، ولم تُكتب في السجلات.')
        else:
            print('كلمة المرور الأولية (احتفظ بها بأمان): '+pwd)
            print('غيّرها قبل النشر العام عبر متغير ADMIN_PASSWORD عند إنشاء قاعدة جديدة.')
        print('='*64+'\n', flush=True)
    db.execute('DELETE FROM sessions WHERE expires < ?', (int(time.time()),))
    db.close()


init_db()


def settings(db):
    return {r['key']: r['value'] for r in db.execute('SELECT key,value FROM settings')}


def product_rows(db):
    products = [dict(x) for x in db.execute('SELECT * FROM products ORDER BY featured DESC, created_at DESC')]
    for item in products:
        try:
            item['specs'] = json.loads(item.pop('specs_json'))
        except (TypeError, ValueError):
            item['specs'] = {}
    return products


def video_rows(db):
    return [dict(x) for x in db.execute('SELECT * FROM videos ORDER BY created_at DESC')]


def social_rows(db):
    return [dict(x) for x in db.execute('SELECT * FROM social_posts ORDER BY created_at DESC, id DESC')]


def valid_link(s: str, allow_internal=False):
    if not s:
        return ''
    if allow_internal and s.startswith('/uploads/') and re.fullmatch(r'/uploads/[A-Za-z0-9_.-]+', s):
        return s
    if allow_internal and re.fullmatch(r'/static/assets/products/[a-z0-9-]+\.(?:webp|svg)', s):
        return s
    if allow_internal and re.fullmatch(r'/static/assets/ads/[a-z0-9-]+\.webp',s):
        return s
    p = urlparse(s)
    if p.scheme not in ('http', 'https') or not p.hostname:
        raise HTTPException(422, 'استخدم رابطاً يبدأ بـ https:// أو http://')
    if p.username or p.password:
        raise HTTPException(422, 'الرابط غير صالح')
    return s


class LoginIn(BaseModel):
    password: str = Field(min_length=1, max_length=300)


class ProductIn(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    category: str = Field(min_length=2, max_length=65)
    description: str = Field(default='', max_length=3000)
    price: float = Field(default=0, ge=0, le=1_000_000_000_000)
    old_price: float = Field(default=0, ge=0, le=1_000_000_000_000)
    image_url: str = Field(default='', max_length=1500)
    badge: str = Field(default='', max_length=40)
    featured: bool = False
    stock: int = Field(default=-1, ge=-1, le=1_000_000)
    brand: str = Field(default='', max_length=100)
    model: str = Field(default='', max_length=100)
    sku: str = Field(default='', max_length=100)
    specs: dict[str, str] = Field(default_factory=dict)
    product_url: str = Field(default='', max_length=1500)
    video_url: str = Field(default='', max_length=1500)
    external_id: str = Field(default='', max_length=150)
    source: str = Field(default='manual', max_length=70)

    @field_validator('specs')
    @classmethod
    def clean_specs(cls, v):
        if len(v) > 36 or any(len(str(k)) > 95 or len(str(value)) > 500 for k,value in v.items()):
            raise ValueError('تجاوزت المواصفات الحد المسموح')
        return {str(k).strip(): str(value).strip() for k,value in v.items() if str(k).strip()}

    @field_validator('product_url','video_url')
    @classmethod
    def valid_product_link(cls, v):
        return valid_link(v)

    @field_validator('image_url')
    @classmethod
    def image_link(cls, v):
        return valid_link(v, True)


class VideoIn(BaseModel):
    title: str = Field(min_length=2, max_length=140)
    url: str = Field(min_length=5, max_length=1500)
    description: str = Field(default='', max_length=1500)
    thumbnail_url: str = Field(default='', max_length=1500)

    @field_validator('url','thumbnail_url')
    @classmethod
    def url_valid(cls, v):
        return valid_link(v)


class SocialPostIn(BaseModel):
    title: str = Field(min_length=2, max_length=140)
    description: str = Field(default='', max_length=1500)
    post_type: str = Field(default='advert', pattern='^(advert|video|post)$')
    source: str = Field(default='facebook', pattern='^(facebook|store_creative)$')
    url: str = Field(default='', max_length=1500)
    image_url: str = Field(default='', max_length=1500)

    @field_validator('url')
    @classmethod
    def link_valid(cls,v):
        return valid_link(v)

    @field_validator('image_url')
    @classmethod
    def image_valid(cls,v):
        return valid_link(v, True)


SETTING_KEYS = {
 'store_name', 'store_subtitle', 'hero_title', 'hero_description',
 'announcement', 'whatsapp', 'phone', 'address', 'currency', 'logo_url',
 'instagram', 'facebook', 'facebook_page_url', 'tiktok', 'youtube', 'telegram',
 'snapchat', 'x', 'app_url', 'delivery_text', 'payment_text'
}
URL_SETTINGS = {'logo_url','instagram','facebook','facebook_page_url','tiktok','youtube','telegram','snapchat','x','app_url'}


class OrderItem(BaseModel):
    id: str = Field(min_length=1, max_length=70)
    quantity: int = Field(ge=1, le=99)


class OrderIn(BaseModel):
    customer_name: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=6, max_length=35)
    city: str = Field(min_length=2, max_length=100)
    address: str = Field(min_length=3, max_length=300)
    note: str = Field(default='', max_length=1000)
    payment_method: str = Field(default='عند الاستلام', max_length=70)
    items: list[OrderItem] = Field(min_length=1, max_length=30)


class OrderStatus(BaseModel):
    status: str


@app.get('/')
def home():
    return FileResponse(STATIC/'index.html')


@app.get('/health')
def health():
    with conn() as db:
        db.execute('SELECT 1').fetchone()
    return {'status': 'ok'}


@app.get('/admin')
def admin():
    return FileResponse(STATIC/'admin.html')


@app.get('/manifest.webmanifest')
def manifest():
    return FileResponse(STATIC/'manifest.webmanifest')


@app.get('/sw.js')
def sw():
    return FileResponse(STATIC/'sw.js')


@app.get('/api/catalog')
def get_catalog():
    with conn() as db:
        return {'settings':settings(db), 'products':product_rows(db), 'videos':video_rows(db), 'social_posts':social_rows(db), 'demo': any((not x['image_url'] or x['image_url'].endswith('.svg')) for x in product_rows(db)) or all(float(x['price']) == 0 for x in product_rows(db))}


LOGIN_ATTEMPTS: dict[str, list[float]] = {}


@app.post('/api/admin/login')
def login(data: LoginIn, request: Request, response: Response):
    ip = request.client.host if request.client else 'unknown'
    now = time.time()
    attempts = [t for t in LOGIN_ATTEMPTS.get(ip, []) if now-t < 600]
    if len(attempts) >= 12:
        raise HTTPException(429, 'محاولات كثيرة، حاول لاحقاً')
    with conn() as db:
        row = db.execute('SELECT password_hash FROM admins LIMIT 1').fetchone()
        if not row or not check_password(data.password, row['password_hash']):
            attempts.append(now)
            LOGIN_ATTEMPTS[ip] = attempts
            raise HTTPException(401, 'كلمة المرور غير صحيحة')
        LOGIN_ATTEMPTS.pop(ip, None)
        token = secrets.token_urlsafe(36)
        csrf = secrets.token_urlsafe(30)
        expires = int(now) + SESSION_AGE
        db.execute('INSERT INTO sessions VALUES (?,?,?)', (hashlib.sha256(token.encode()).hexdigest(),csrf,expires))
    response.set_cookie(COOKIE, token, max_age=SESSION_AGE, httponly=True, samesite='strict', secure=(request.url.scheme == 'https' or os.environ.get('FORCE_SECURE_COOKIE') == '1'), path='/')
    return {'ok': True, 'csrf': csrf}


def require_admin(request: Request):
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, 'يرجى تسجيل الدخول')
    with conn() as db:
        session = db.execute('SELECT csrf,expires FROM sessions WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
    if not session or session['expires'] < int(time.time()):
        raise HTTPException(401, 'انتهت الجلسة')
    if request.method not in ('GET','HEAD') and request.headers.get('x-csrf-token') != session['csrf']:
        raise HTTPException(403, 'رمز الأمان غير صالح')
    return {'csrf':session['csrf']}


@app.get('/api/admin/me')
def me(admin=Depends(require_admin)):
    return {'ok':True,'csrf':admin['csrf']}


@app.post('/api/admin/logout')
def logout(request: Request, response: Response, admin=Depends(require_admin)):
    token = request.cookies.get(COOKIE)
    with conn() as db:
        db.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),))
    response.delete_cookie(COOKIE, path='/')
    return {'ok':True}


@app.post('/api/admin/change-password')
def change_password(data: dict[str, str], request: Request, admin=Depends(require_admin)):
    current = data.get('current','')
    new = data.get('new','')
    if len(new) < 12 or len(new) > 300:
        raise HTTPException(422, 'كلمة المرور الجديدة يجب أن تتكون من 12 حرفاً على الأقل')
    with conn() as db:
        row = db.execute('SELECT password_hash FROM admins LIMIT 1').fetchone()
        if not check_password(current, row['password_hash']):
            raise HTTPException(401, 'كلمة المرور الحالية غير صحيحة')
        db.execute('UPDATE admins SET password_hash=?', (hash_password(new),))
        db.execute('DELETE FROM sessions WHERE token_hash != ?', (hashlib.sha256(request.cookies[COOKIE].encode()).hexdigest(),))
    return {'ok':True}


@app.get('/api/admin/data')
def admin_data(admin=Depends(require_admin)):
    with conn() as db:
        orders = [dict(x) for x in db.execute('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500')]
        for x in orders:
            x['items'] = json.loads(x.pop('items_json'))
        return {'settings':settings(db),'products':product_rows(db),'videos':video_rows(db),'social_posts':social_rows(db),'orders':orders}


@app.put('/api/admin/settings')
def save_settings(payload: dict[str, Any], admin=Depends(require_admin)):
    clean = {}
    for k, v in payload.items():
        if k not in SETTING_KEYS:
            continue
        if not isinstance(v,str) or len(v) > 1600:
            raise HTTPException(422, f'قيمة غير صالحة: {k}')
        if k in URL_SETTINGS:
            valid_link(v, k == 'logo_url')
        clean[k] = v.strip()
    with conn() as db:
        db.executemany('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', clean.items())
    return {'ok':True}


@app.post('/api/admin/products')
def create_product(p: ProductIn, admin=Depends(require_admin)):
    item = p.model_dump()
    item['id'] = make_id('prd')
    item['created_at'] = utc_now()
    item['featured'] = int(item['featured'])
    item['specs_json'] = json.dumps(item.pop('specs'), ensure_ascii=False)
    with conn() as db:
        db.execute('''INSERT INTO products (id,name,category,description,price,old_price,image_url,badge,featured,stock,created_at,brand,model,sku,specs_json,product_url,video_url,external_id,source)
        VALUES (:id,:name,:category,:description,:price,:old_price,:image_url,:badge,:featured,:stock,:created_at,:brand,:model,:sku,:specs_json,:product_url,:video_url,:external_id,:source)''',item)
    return {'ok':True,'id':item['id']}


@app.put('/api/admin/products/{id}')
def edit_product(id: str, p: ProductIn, admin=Depends(require_admin)):
    item = p.model_dump()
    item['id'] = id
    item['featured'] = int(item['featured'])
    item['specs_json'] = json.dumps(item.pop('specs'), ensure_ascii=False)
    with conn() as db:
        cur = db.execute('''UPDATE products SET name=:name,category=:category,description=:description,price=:price,
         old_price=:old_price,image_url=:image_url,badge=:badge,featured=:featured,stock=:stock,
         brand=:brand,model=:model,sku=:sku,specs_json=:specs_json,product_url=:product_url,
         video_url=:video_url,external_id=:external_id,source=:source WHERE id=:id''',item)
        if not cur.rowcount:
            raise HTTPException(404, 'المنتج غير موجود')
    return {'ok':True}


@app.delete('/api/admin/products/{id}')
def delete_product(id: str, admin=Depends(require_admin)):
    with conn() as db:
        cur=db.execute('DELETE FROM products WHERE id=?',(id,))
        if not cur.rowcount:
            raise HTTPException(404,'المنتج غير موجود')
    return {'ok':True}


@app.post('/api/admin/videos')
def create_video(p: VideoIn, admin=Depends(require_admin)):
    item=p.model_dump()
    item['id']=make_id('vid')
    item['created_at']=utc_now()
    with conn() as db:
        db.execute('INSERT INTO videos (id,title,url,description,thumbnail_url,created_at) VALUES (:id,:title,:url,:description,:thumbnail_url,:created_at)',item)
    return {'ok':True,'id':item['id']}


@app.put('/api/admin/videos/{id}')
def edit_video(id: str, p: VideoIn, admin=Depends(require_admin)):
    item=p.model_dump()
    item['id']=id
    with conn() as db:
        cur=db.execute('UPDATE videos SET title=:title,url=:url,description=:description,thumbnail_url=:thumbnail_url WHERE id=:id',item)
        if not cur.rowcount:
            raise HTTPException(404,'الفيديو غير موجود')
    return {'ok':True}


@app.delete('/api/admin/videos/{id}')
def delete_video(id: str, admin=Depends(require_admin)):
    with conn() as db:
        cur=db.execute('DELETE FROM videos WHERE id=?',(id,))
        if not cur.rowcount:
            raise HTTPException(404,'الفيديو غير موجود')
    return {'ok':True}


@app.post('/api/admin/social-posts')
def create_social_post(p: SocialPostIn, admin=Depends(require_admin)):
    item=p.model_dump();item['id']=make_id('social');item['created_at']=utc_now()
    with conn() as db:
        db.execute('''INSERT INTO social_posts
          (id,title,description,post_type,source,url,image_url,created_at)
          VALUES (:id,:title,:description,:post_type,:source,:url,:image_url,:created_at)''', item)
    return {'ok':True,'id':item['id']}


@app.put('/api/admin/social-posts/{id}')
def update_social_post(id: str, p: SocialPostIn, admin=Depends(require_admin)):
    item=p.model_dump();item['id']=id
    with conn() as db:
        cur=db.execute('''UPDATE social_posts SET title=:title,description=:description,
          post_type=:post_type,source=:source,url=:url,image_url=:image_url
          WHERE id=:id''',item)
        if not cur.rowcount: raise HTTPException(404,'المنشور غير موجود')
    return {'ok':True}


@app.delete('/api/admin/social-posts/{id}')
def delete_social_post(id: str,admin=Depends(require_admin)):
    with conn() as db:
        cur=db.execute('DELETE FROM social_posts WHERE id=?',(id,))
        if not cur.rowcount: raise HTTPException(404,'المنشور غير موجود')
    return {'ok':True}


@app.post('/api/admin/upload')
def upload_image(payload: dict[str,str], admin=Depends(require_admin)):
    raw=payload.get('data','')
    if not raw or len(raw) > MAX_UPLOAD_BYTES * 2:
        raise HTTPException(422,'حجم الصورة كبير جداً')
    try:
        if raw.startswith('data:'):
            raw=raw.split(',',1)[1]
        content=base64.b64decode(raw, validate=True)
        if len(content)>MAX_UPLOAD_BYTES:
            raise ValueError()
        im=Image.open(io.BytesIO(content))
        if im.format not in ('JPEG','PNG','WEBP'):
            raise ValueError()
        im.verify()
        im=Image.open(io.BytesIO(content))
        im.thumbnail((1600,1600))
        if im.mode not in ('RGB','RGBA'):
            im=im.convert('RGB')
        filename=f'{uuid.uuid4().hex}.webp'
        im.save(UPLOADS/filename,'WEBP',quality=85,method=5)
        return {'url':'/uploads/'+filename}
    except (ValueError,UnidentifiedImageError,OSError,base64.binascii.Error,IndexError):
        raise HTTPException(422,'الصورة غير صالحة؛ استخدم JPEG أو PNG أو WEBP بحجم أقل من 4MB')


@app.post('/api/admin/import')
def import_products(payload: dict[str,Any], admin=Depends(require_admin)):
    # The listing on Google Play does not disclose a catalog. This endpoint only
    # imports catalog data explicitly provided by an authorized store manager.
    records=payload.get('products')
    if not isinstance(records,list) or not records or len(records)>1000:
        raise HTTPException(422,'اختر ملف JSON أو CSV صالحاً (من 1 إلى 1000 منتج لكل دفعة)')
    mode=payload.get('mode','merge')
    if mode not in ('merge','append'):
        raise HTTPException(422,'وضع الاستيراد غير صالح')
    items=[]
    for n,raw in enumerate(records,1):
        try:
            item=ProductIn.model_validate(raw).model_dump()
        except Exception:
            raise HTTPException(422,f'بيانات المنتج رقم {n} غير صالحة؛ تحقق من الاسم والقسم والمواصفات')
        item['id']=make_id('prd')
        item['created_at']=utc_now()
        item['featured']=int(item['featured'])
        item['specs_json']=json.dumps(item.pop('specs'),ensure_ascii=False)
        if item['source']=='manual': item['source']='import'
        items.append(item)
    insert_sql='''INSERT INTO products
        (id,name,category,description,price,old_price,image_url,badge,featured,stock,created_at,brand,model,sku,specs_json,product_url,video_url,external_id,source)
        VALUES (:id,:name,:category,:description,:price,:old_price,:image_url,:badge,:featured,:stock,:created_at,:brand,:model,:sku,:specs_json,:product_url,:video_url,:external_id,:source)'''
    update_sql='''UPDATE products SET name=:name,category=:category,description=:description,price=:price,
        old_price=:old_price,image_url=:image_url,badge=:badge,featured=:featured,stock=:stock,
        brand=:brand,model=:model,sku=:sku,specs_json=:specs_json,product_url=:product_url,
        video_url=:video_url,external_id=:external_id,source=:source WHERE id=:id'''
    added=0; updated=0
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        try:
            for item in items:
                prior=None
                if mode=='merge' and item['external_id']:
                    prior=db.execute('SELECT id FROM products WHERE external_id=? LIMIT 1',(item['external_id'],)).fetchone()
                if mode=='merge' and not prior and item['sku']:
                    prior=db.execute('SELECT id FROM products WHERE sku=? LIMIT 1',(item['sku'],)).fetchone()
                if prior:
                    item['id']=prior['id']; db.execute(update_sql,item); updated+=1
                else:
                    db.execute(insert_sql,item); added+=1
            db.commit()
        except Exception:
            db.rollback()
            raise
    return {'ok':True,'added':added,'updated':updated,'total':len(items)}


@app.post('/api/orders')
def place_order(data: OrderIn):
    ids=[x.id for x in data.items]
    if len(set(ids)) != len(ids):
        raise HTTPException(422,'منتجات مكررة في الطلب')
    if data.payment_method not in ('عند الاستلام','تحويل بنكي / محفظة','الاتفاق مع المتجر'):
        raise HTTPException(422,'طريقة دفع غير صالحة')
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        try:
            found={p['id']:dict(p) for p in db.execute('SELECT * FROM products WHERE id IN ('+','.join('?' for _ in ids)+')', ids)}
            if len(found)!=len(ids):
                raise HTTPException(422,'أحد المنتجات لم يعد متاحاً')
            items=[]
            total=0.0
            for requested in data.items:
                p=found[requested.id]
                if p['stock']==0 or (p['stock']!=-1 and requested.quantity>p['stock']):
                    raise HTTPException(422,f'الكمية المطلوبة غير متوفرة: {p["name"]}')
                subtotal=round(p['price'] * requested.quantity,2)
                total=round(total+subtotal,2)
                items.append({'id':p['id'],'name':p['name'],'quantity':requested.quantity,'price':p['price'],'subtotal':subtotal})
            order_id='FUR-'+datetime.now().strftime('%y%m%d')+'-'+secrets.token_hex(3).upper()
            db.execute('''INSERT INTO orders
                (id,customer_name,phone,city,address,note,payment_method,items_json,total,status,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)''',(
                order_id,data.customer_name.strip(),data.phone.strip(),data.city.strip(),
                data.address.strip(),data.note.strip(),data.payment_method,
                json.dumps(items,ensure_ascii=False),total,'جديد',utc_now()
            ))
            db.commit()
            return {'ok':True,'order_id':order_id,'total':total,'items':items}
        except Exception:
            db.rollback()
            raise


@app.patch('/api/admin/orders/{id}')
def update_order(id: str, p: OrderStatus, admin=Depends(require_admin)):
    if p.status not in ('جديد','قيد التجهيز','تم الشحن','مكتمل','ملغي'):
        raise HTTPException(422,'حالة غير صالحة')
    with conn() as db:
        cur=db.execute('UPDATE orders SET status=? WHERE id=?',(p.status,id))
        if not cur.rowcount:
            raise HTTPException(404,'الطلب غير موجود')
    return {'ok':True}


if __name__=='__main__':
    import uvicorn
    print('الموقع: http://localhost:8000', flush=True)
    uvicorn.run(app,host=os.environ.get('HOST','127.0.0.1'),port=int(os.environ.get('PORT','8000')))
