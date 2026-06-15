# Ebook Kataloğu

Kişisel ebook kitaplığı yönetim sistemi.

## Yapı

```
ebook-catalog/
├── scanner/        ← PC'de çalışan Python tarayıcı
│   ├── scan.py
│   ├── metadata.py
│   ├── cover.py
│   ├── api.py
│   ├── uploader.py
│   ├── requirements.txt
│   ├── .env.example
│   └── .env        ← GitHub'a push etme, kendi oluştur
└── web/            ← Vercel'e deploy edilen web arayüzü
    ├── index.html
    ├── style.css
    ├── app.js
    └── appwrite.js
```

## Scanner Kurulum

```bash
cd scanner
pip install -r requirements.txt

# .env dosyası oluştur
cp .env.example .env
# .env içine Appwrite bilgilerini gir
```

## .env İçeriği

```
APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=senin_project_id
APPWRITE_API_KEY=standard_xxxxxxxxxxxxxxxx
APPWRITE_DATABASE_ID=ebook_catalog
APPWRITE_TABLE_ID=books
APPWRITE_BUCKET_ID=covers
APPWRITE_USER_ID=senin_user_id
```

## Scanner Kullanım

```bash
# Klasörü tara (alt klasörler dahil)
python scan.py "D:\Kitaplar\Fantastik"

# Sadece üst klasörü tara
python scan.py "D:\Kitaplar" --no-recursive
```

## Appwrite Kurulum

1. appwrite.io'da proje aç
2. Database → `ebook_catalog` oluştur → `books` tablosu ekle
3. Storage → `covers` bucket aç
4. Auth → kullanıcı oluştur
5. Settings → API key al (scanner için)
6. `books` tablosunda `file_path` alanına index ekle

## Web Kurulum

`web/appwrite.js` içindeki `APPWRITE_PROJECT_ID` değerini kendi proje ID'nle güncelle.

## Vercel Deploy

1. GitHub'a push et
2. Vercel'de yeni proje → GitHub reposunu bağla
3. Publish directory: `web` olarak ayarla
4. Deploy
