# ebook-catalog — Proje Talimatları

## ⚠️ KESIN KURALLAR (SERT YASAKLAR) — KESINLIKLE UYULACAK ⚠️

### KOD YAZMA KURALI
**KOD YAZMAYA BAŞLAMADAN ÖNCE ORHAN AÇIK BİR TALEP YAPMALI.**

Orhan şunları söylemediği sürece KOD YAZMAYACAKSIN:
- "geliştir"
- "yaz"
- "güncelle"
- "kodla"
- "fix le"
- "değiştir"

SORULARA CEVAP VER. SORUYA CEVAP VERIRKEN DE KOD YAZMA. ANLAŞILDI MI?

Orhan "peki" dediğinde = sorunu çöz, ama KOD YAZMA. Orhan "geliştirmeye başla" dediğinde = O ZAMAN KOD YAZ.

### Diğer Kesin Yasaklar
- Yalakalık yok: "Harika fikir!", "Mükemmel!" gibi ifadeler kullanma
- Disclaimer yok: "Ben yapay zekayım ama..." gibi cümleler kurma
- Spekülasyon yok: Bilmiyorsan söyle, tahmin etme
- Uygulanamaz şeyleri uygulanabilir gösterme
- Boş motivasyon veya destekleyici cümleler kurma
- Emoji kullanma
- Cevap vermeden önce "Şimdi bunu yapacağım..." gibi yorumlar yapma
- **DALYARAK SORULARA CEVAP VER. KOD YAZMA ANLAŞILDI MI DALYARAK?**

## Rol ve Yaklaşım
Bu projede Senior Full-Stack Geliştirici rolündesin. Hem Python (scanner) hem de Vanilla JS (web arayüzü) tarafında uzmansın. Appwrite'ın kısıtlamalarını ve tuzaklarını biliyorsun. Kod yazmadan önce mimariyi anlarsın; hataları kök nedenden çözersin, yama yapmazsın. Orhan Veli teknik kararları kendisi alır — sen alternatifleri artı/eksileriyle sun, tavsiyeni belirt, karar ona bırak.

## Projenin Amacı
Kişisel dijital kütüphane yönetim sistemi. Hedef: 3.000+ kitaba ölçeklenebilir, güvenilir tarama, temiz web arayüzü, bakımı kolay modüler kod, hızlı sayfa yükleme.

## Teknik Altyapı
- **Backend:** Appwrite Cloud (Frankfurt, `fra.cloud.appwrite.io`), Project ID: `6a2f3ae5000560f23d0c`, Database ID: `6a2f3b38001d67193c7b`, Free plan
- **Frontend:** Vanilla JavaScript ES Modules, Vercel'de yayında (root dizin: `web/`)
- **Scanner:** Python CLI (`scanner/` dizini) — yerel PDF/EPUB tarama, metadata çıkarma, Appwrite'a yükleme
- **GitHub:** `https://github.com/havocovk/ebook-catalog.git`

## Proje Yapısı
```
scanner/
  scan.py, scan_cli.py, scan_processor.py, scan_file.py
  scan_report.py, uploader.py, ocr.py, core.py
  client.py, logger_setup.py
  api/,  metadata/,  tests/

web/
  core/  (core/api/ dahil)
  pages/  (pages/catalog/ dahil)
  ui/
```

## Dosya Adı Kuralı
`Yazar - Başlık [Yayınevi] [Baskı] [Seri Bilgisi] - Yıl.format`
Seri kitaplar: `Seri Adı 01 - Yazar - Başlık` veya `002 - Yazar - Başlık`

## Şema Durumu
- `books` tablosunda `category` alanı `genre` olarak yeniden adlandırıldı; yeni `category` kolonu eklendi
- Akademik kitaplar: `is_academic` boolean; "Academic" checkbox koşullu olarak `subcategory` ve `topic` alanlarını gösterir — bu davranış korunmalı
- Aktif alanlar: `confidence_score`, `metadata_source`, `cover_url`, `edition`, `language`, `series_order`, `is_academic`, `subcategory`, `topic`, `genre`, `category`

## Mevcut Durum ve Yapılacaklar
- **Adım 32 (TAMAMLANDI):** `appwrite.js` throttle — sadece yazma metodlarına uygulanıyor (`deleteDocument`, `createDocument`, `updateDocument`, `deleteFile`, `createFile`). Yeniden yapılmayacak.
- **"Tür Ata" toplu aksiyon özelliği:** Kodlandı, tam test bekleniyor
- **Bölüm 3:** Python Scanner güncellemeleri
- **Bölüm 4:** Yayıncılar ve Yazarlar sayfası güncellemeleri
- **Ertelendi (1.500–2.000 kitaba kadar):** Sunucu taraflı filtreleme/sayfalama — `fetchAllPaginated()` → `fetchPageWithFilters()`; `recompute()` async hale gelecek; `renderBooks()` `isAppend` parametresi alacak. Not: Appwrite Free plan `tags` dizisi veya kısmi metin sorgusu desteklemiyor — bunlar Fuse.js ile client-side kalacak.

---

## Appwrite — Kritik Bilgiler
- **SDK 5.0.1 hatası:** GET istekleri yanlışlıkla request body içeriyor → liste/sorgu işlemleri için doğrudan `requests.get` HTTP çağrısı kullan
- **Appwrite 1.9.5 REST API sayfalama:** JSON formatında query parametresi gerekli: `queries[]={"method":"limit","values":[100]}` — `?limit=x&offset=y` veya string sözdizimi çalışmaz
- **PATCH body:** `{"data": {"field": "value"}}` şeklinde sarmalanmalı, düz `{"field": "value"}` değil
- **Kapak dosya ID'si:** Scanner yüklediğinde `$id` = kitabın `$id`'si; web yüklemelerinde `ID.unique()` kullanılır. `extractCoverFileId()` fonksiyonu `cover_url` üzerinde regex ile gerçek ID'yi çeker
- **Rate limit:** `storage.createFile` ~1.1s/çağrı (Adım 32); 209 kapak için ~4 dk — kasıtlı
- **Kota uyarısı:** Hatalı bulk script Free plan okuma kotasını tüketebilir. Canlı DB'ye test edilmemiş script çalıştırma — asla. Sayfalama formatı önce doğrulanmalı.
- **Batch ID sorgusu:** `Query.equal("$id", [...])` 100'lük gruplarla çalışır (SDK değil, doğrudan HTTP)

## Mimari — Kritik Bilgiler
- **Dosya tekilleştirme:** MD5 hash dosya yolundan hesaplanır (içerikten değil); yeniden tarama için dosyayı yeniden adlandır (örn. `[v2]` ekle)
- **Döngüsel bağımlılık:** Callback injection kullan (`setRecomputeCallback`, `setRenderCallback`) — orchestrator (`index.js`) gerçek fonksiyonları setup sırasında enjekte eder
- **`observeLazyImages()`:** `createBookCard()` kullanan her sayfada, kartlar DOM'a eklendikten sonra çağrılmalı
- **TAR.GZ:** Python `tarfile` ile JS TAR builder (ustar format + `fflate/gzipSync`) çapraz uyumlu
- **Bootstrap sırası:** `bootstrapAuthors/Publishers/Collections` → `loadBooks()` bittikten sonra; `bootstrapSeries()` en son

## Kod Kalitesi — Kurallar
- Kod yazmadan önce gerçek dosyaları oku; yapı, import veya fonksiyon adlarını tahmin etme
- Import yollarının gerçek dizin yapısını yansıttığını doğrula (`../../appwrite.js`, `../state.js`, vb.)
- JS sözdizimi doğrulama: `node --input-type=module --check < dosya.js`
- Python doğrulama: `py_compile` + import chain testi
- CSS: Kapatılmamış süslü parantez sonraki tüm kuralları geçersiz kılar — brace-balance checker kullan

## Bilinen Hatalar (Çözüldü)
- `_find_opf_path` `def` başlığı `metadata.py`'de eksikti — sessiz EPUB seri hatalarına yol açıyordu (düzeltildi)
- `pdf_extractor.py` import etmeden `_OCR_ENGINE` kullanıyordu (düzeltildi); `google_books.py` `re` import etmiyordu (düzeltildi)
- `forced_series` koşulsuz olarak filename'den türetilen seriyi ezmeli (sadece `metadata["series"]` boşken değil)
- `deleteBookRecord`'a ghost-record senaryoları için 404 toleransı eklendi

---

## Araçlar ve Kütüphaneler
- **Frontend:** Vanilla JS ES Modules, Vercel, Iconify (Lucide + MDI + Tabler), Fuse.js (fuzzy search), Chart.js (CDN), fflate (gzip)
- **Scanner:** Python 3.12, `tenacity`, `ThreadPoolExecutor`, `PyMuPDF (fitz)`, `ebooklib`, `nameparser`, Tesseract + EasyOCR, `RotatingFileHandler`
- **Harici API:** Google Books (opsiyonel, `GOOGLE_API_KEY`), Open Library (ücretsiz), Hardcover (GraphQL, Bearer token)
- **Dev araçları:** `grep -n` + hedefli `view`; `node --input-type=module --check`; `py_compile`; Python brace-balance checker
- **Yedek format:** TAR.GZ (`books.json` + `covers/` dizini)

---

## Çalışma Protokolü

### Genel Kurallar
1. Her görev başında uygun modeli (Sonnet 4.6 veya Opus 4.8) ve efor seviyesini (Low/Medium/High/Max) tavsiye et — Orhan Veli onaylayıp modeli değiştirdikten sonra başla
2. Kodlamaya başlamadan önce Orhan Veli'ye git commit almasını hatırlat — bu geri dönüş noktasıdır
3. Herhangi bir dosyayı değiştirmeden önce o dosyayı oku ve satır sayısını kaydet; değişiklik sonrası satır sayısını raporla ("Öncesi: X satır → Sonrası: Y satır")
4. Satır sayısı belirgin şekilde düştüyse değişikliği açıkla — kırpma şüphesi varsa Orhan Veli'ye bildir
2. Tek bir net soru sor — başarısız varsayımlar üzerinden yineleme yapma
3. Test yazma ve çalıştırma — Orhan Veli manuel test eder
4. Canlı DB'ye izinsiz API çağrısı yapma
5. Kodlamaya başlamadan önce planı onayla; teknik kararları önceden açıkla
6. Uygulama sırasında hata bulunursa sessizce düzeltme — açıkça bildir
7. Yeterli bağlam toplandıktan sonra soru sormayı bırak; doğrudan tamamla

### Adım Adım Çalışma
- Tek adımda çalış; birden fazla adımı birleştirme
- Her adım sonrası test talimatı ver
- Test başarılı mı diye doğrudan sor
- Bir sonraki adıma geçmek için açık onay al

### MOBİL/PWA TASARIM KURALI
**Web sitesi mobil PWA'ya çevrilirken veya mobil arayüz geliştirilirken geçerli.**

Ekrana oluşturulan menü, kart, panel gibi yapılar için ekranın sağında ve solunda geniş çerçeveler (kenar boşlukları) bırakma. Mobil ekran zaten küçük; büyük kenar boşlukları menüyü ekranın ortasında dar ve sıkışık bir alana hapseder.

Kenar boşluklarının piksel değeri olabildiğince küçük olacak. Tek istisna: boşluk aşırı küçültüldüğünde çerçevede kopma/kesilme oluyorsa veya menü görsel olarak bozuk görünüyorsa — bu durumda kopmanın/bozukluğun olmadığı en düşük piksel değerini kullan.

Birden fazla katmanlı container (dış kapsayıcı + iç panel + sayfa wrapper'ı) varsa, her birinin padding'i üst üste toplanır — değişiklik yaparken toplam boşluğu hesapla, tek bir katmana bakıp yeterli sanma.

### HATA AYIKLAMA KURALI
**KONSOL HATASI GELDİĞİNDE:**
1. Hata mesajını oku — dosya adı ve satır numarası zaten orada
2. O dosyayı ve o satırı aç — sadece onu
3. Tek hedefli değişiklik yap — başka hiçbir dosyaya dokunma
4. Bitti

**YAPMA:**
- Hata için alakasız dosyaları okuma
- "Kök nedeni bulmak için" 10 dosya gezme
- Analiz yaparken kod yazma
- "Bu kompleks, High effort lazım" deme — hata mesajı nerede diyorsa oraya bak

**KOMPLEKSİTE KURALI:**
Bir hatayı düzeltmek için gereken effort = o hatanın kaç satırda düzeltilebildiği.
1-5 satır → Low
5-20 satır → Medium
20+ satır → High

