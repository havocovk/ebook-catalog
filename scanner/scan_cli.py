# -*- coding: utf-8 -*-
"""
CLI / interaktif soru-cevap akışı modülü.

Tarama başlamadan önce kullanıcıya yayınevi ve seri ile ilgili sorular
sorar, ayrıca paralel tarama sırasında thread çıktılarının karışmasını
önleyen yardımcı sınıfı barındırır.

scan.py'den bölündü — Adım 3-2 (Faz 3 refactoring).
"""

import os
import sys
import threading

from metadata import _is_publisher_string, _is_generic_folder
from logger_setup import get_logger

# Modül seviyesinde bir kez oluşturulur — orijinal scan.py'deki global
# 'log' değişkeniyle aynı davranış (Adım 8 loglama mantığı korunur).
log = get_logger()


def check_env():
    required = {
        "APPWRITE_PROJECT_ID": "YOUR_PROJECT_ID",
        "APPWRITE_API_KEY":    "YOUR_API_KEY",
        "APPWRITE_USER_ID":    "YOUR_USER_ID",
    }
    missing = []
    for var, placeholder in required.items():
        val = os.getenv(var, "")
        if not val or val == placeholder:
            missing.append(var)
    if missing:
        print("⚠️  .env dosyasında eksik/ayarlanmamış değerler var:")
        for var in missing:
            print(f"    - {var}")
        print("\nLütfen scanner/.env dosyasını doldurup tekrar çalıştır.")
        log.error(f".env dosyasında eksik değerler, tarama başlatılamadı: {', '.join(missing)}")
        sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# Adım P2: Thread-local stdout — paralel modda çıktı karışmasını önler
# ─────────────────────────────────────────────────────────────────────────────

class _ThreadLocalStdout:
    """
    Her thread'in print çıktısını kendi tamponuna (buffer) yönlendirir.

    Paralel tarama sırasında 5 kitap aynı anda işlendiğinde, normalde her
    kitabın satırları terminalde iç içe girer. Bu sınıf, sys.stdout'un yerine
    geçer: bir worker thread'i kendi tamponuna yazar, ana thread doğrudan
    gerçek terminale yazar. Böylece her kitabın çıktısı bütün halinde,
    karışmadan basılabilir.
    """

    def __init__(self, default_stream):
        self._default = default_stream      # Gerçek terminal (ana thread için)
        self._local = threading.local()     # Her thread'e özel saklama alanı

    def write(self, text):
        buffer = getattr(self._local, "buffer", None)
        (buffer if buffer is not None else self._default).write(text)

    def flush(self):
        buffer = getattr(self._local, "buffer", None)
        (buffer if buffer is not None else self._default).flush()

    def set_buffer(self, buffer):
        """Bu thread'in çıktısını verilen tampona yönlendir."""
        self._local.buffer = buffer

    def clear_buffer(self):
        """Bu thread'i tekrar gerçek terminale döndür."""
        self._local.buffer = None


# ─────────────────────────────────────────────────────────────────────────────
# TARAMA ÖNCESİ KULLANICI SORU AKIŞI
# ─────────────────────────────────────────────────────────────────────────────

def _analyze_path_for_publisher(folder_path: str) -> str | None:
    """
    Taranacak klasörün tam yolundaki klasör adlarını inceler.
    Yayınevi adı içeren bir klasör bulursa kullanıcıya sorar.

    Örn: D:\\Kitaplar\\İş Bankası Kültür Yayınları\\Biyografi Serisi
         → "İş Bankası Kültür Yayınları" yayınevi mi diye sorar

    Dönüş:
      str  → onaylanan veya kullanıcının girdiği yayınevi adı
      None → yayınevi belirsiz, dosya adlarından / dosya içinden bulunacak
    """
    parts = os.path.normpath(folder_path).split(os.sep)

    # Yol parçalarında yayınevi anahtar kelimesi geçen klasör var mı?
    publisher_candidate = None
    for part in parts:
        if part and not _is_generic_folder(part) and _is_publisher_string(part):
            publisher_candidate = part
            break

    print("\n" + "─" * 55)

    if publisher_candidate:
        print(f'❓ Klasör adresindeki "{publisher_candidate}"')
        print(f'   taranacak kitapların yayınevi midir?')
        answer = _ask("   Cevabınız (e/h): ")

        if answer:
            print(f'   ✓ Yayınevi "{publisher_candidate}" olarak belirlendi.\n')
            return publisher_candidate
        # "Hayır" yanıtı → manuel giriş sorusu
    else:
        print("ℹ️  Klasör adresinde yayınevi adı tespit edilemedi.")

    # Yayınevini manuel girmek ister mi?
    print("❓ Taranacak kitapların yayınevini yazmak ister misiniz?")
    answer2 = _ask("   Cevabınız (e/h): ")

    if answer2:
        while True:
            pub = input("   Yayınevinin adını yazınız: ").strip()
            if pub:
                print(f'   ✓ Yayınevi "{pub}" olarak belirlendi.\n')
                return pub
            print("   Boş bırakılamaz, tekrar deneyin.")
    else:
        print("   Yayınevi ismi girilmedi.")
        print("   Yayınevi ismini tarama esnasında kendi iş akışıma göre bulacağım.\n")
        return None


def _ask_folder_series(folder_path: str) -> str | None:
    """
    Taranacak klasörün adı genel bir kelime değilse ve
    yayınevi adı içermiyorsa, seri adı olup olmadığını sorar.

    Dönüş:
      str  → onaylanan seri adı (tüm kitaplara atanacak)
      None → seri adı belirsiz (dosya adı / API'dan bulunacak)
    """
    folder_name = os.path.basename(os.path.normpath(folder_path))

    # Genel klasör adı veya yayınevi adıysa sorma
    if _is_generic_folder(folder_name) or _is_publisher_string(folder_name):
        return None

    print(f'❓ Klasör adı: "{folder_name}"')
    print(f'   Bu klasördeki kitapların tamamı "{folder_name}" serisine mi ait?')
    answer = _ask("   Cevabınız (e/h): ")

    if answer:
        print(f'   ✓ Tüm kitaplara seri adı "{folder_name}" atanacak.\n')
        return folder_name
    else:
        print(f'   ✓ Seri bilgisi dosya adı ve API\'dan belirlenecek.\n')
        return None


def _ask(prompt: str) -> bool:
    """Kullanıcıdan e/h cevabı alır. True=evet, False=hayır."""
    while True:
        ans = input(prompt).strip().lower()
        if ans in ("e", "evet", "y", "yes"):
            return True
        if ans in ("h", "hayır", "hayir", "n", "no"):
            return False
        print("   Lütfen 'e' veya 'h' girin.")


# ─────────────────────────────────────────────────────────────────────────────
# Adım 1: --backup-full CLI köprüsü
# ─────────────────────────────────────────────────────────────────────────────

def run_backup_full(output_path: str):
    """
    scan.py'den çağrılır. Asıl yedekleme mantığı backup_full.py'dedir —
    bu fonksiyon sadece CLI seviyesinde sonucu yorumlayıp çıkış kodunu
    (exit code) ayarlar.
    """
    from backup_full import backup_full

    success = backup_full(output_path)
    if not success:
        log.error("--backup-full işlemi hatayla sonuçlandı.")
        sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# Adım 2: --restore-backup CLI köprüsü
# ─────────────────────────────────────────────────────────────────────────────

def run_restore_full(backup_path: str, workers: int):
    """
    scan.py'den çağrılır. Asıl geri yükleme mantığı restore_full.py'dedir —
    bu fonksiyon sadece CLI seviyesinde sonucu yorumlayıp çıkış kodunu
    ayarlar.
    """
    from restore_full import restore_full

    success = restore_full(backup_path, workers=workers)
    if not success:
        log.error("--restore-backup işlemi hatayla sonuçlandı.")
        sys.exit(1)