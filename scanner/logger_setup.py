# -*- coding: utf-8 -*-
"""
Loglama sistemi (Adım 8).

scan.py'nin terminale yazdığı mesajların ÖZET bir kopyasını kalıcı bir
dosyaya da kaydeder. Amaç: uzun (3000+ kitaplık) taramalar bittikten günler
sonra "o gece ne oldu, kaç hata çıktı?" diye geriye dönüp bakabilmek —
terminal penceresi kapansa veya kaybolsa bile bu bilgi elde kalsın.

Tasarım kararları:
  - "Orta seviye" loglama: özet istatistikler + hatalar + tarama başlangıç/
    bitiş bilgisi. Her kitabın tek tek detayı LOGLANMAZ (dosya küçük kalır,
    binlerce kitaplık taramada okunabilir olur). Ekrandaki print() çıktıları
    bu davranışı değiştirmez — onlar olduğu gibi terminale akmaya devam eder.
  - Tek dosya + rotasyon: "scan.log" her zaman en güncel taramanın bittiği
    haldedir. Dosya 5MB'ı geçtiğinde otomatik olarak "scan.log.1" diye
    yedeklenir, en eski yedek (scan.log.5) silinir. Böylece disk alanı
    sınırsız büyümez ama geçmiş kayıtlar bir süre saklanır.
  - Konum: scanner/logs/scan.log — scanner/ klasörünün altında, kullanıcının
    diğer dosyalarıyla karışmayan kendi alt klasöründe.
"""

import os
import logging
from logging.handlers import RotatingFileHandler

# logs/ klasörü, bu dosyanın (logger_setup.py) bulunduğu klasörün altında.
# Böylece scan.py nereden çalıştırılırsa çalıştırılsın (farklı bir çalışma
# dizininden de olsa), log dosyası hep scanner/logs/ altına yazılır.
_LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
_LOG_FILE = os.path.join(_LOG_DIR, "scan.log")

_MAX_BYTES = 5 * 1024 * 1024   # 5 MB — bu boyuta ulaşınca rotasyon tetiklenir
_BACKUP_COUNT = 5               # en fazla 5 eski yedek tutulur (scan.log.1..5)

_logger = None  # tek seferlik kurulum sonrası burada saklanır (singleton)


def get_logger() -> logging.Logger:
    """Tarama logger'ını döndürür. İlk çağrıda kurar, sonraki çağrılarda
    aynı (zaten kurulmuş) logger'ı tekrar döndürür — handler çoğalmaz."""
    global _logger
    if _logger is not None:
        return _logger

    os.makedirs(_LOG_DIR, exist_ok=True)

    logger = logging.getLogger("ebook_scanner")
    logger.setLevel(logging.INFO)

    handler = RotatingFileHandler(
        _LOG_FILE,
        maxBytes=_MAX_BYTES,
        backupCount=_BACKUP_COUNT,
        encoding="utf-8",
    )
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)

    # Bu logger sadece dosyaya yazsın; terminale ayrıca taşmasın
    # (terminale yazma işini zaten mevcut print() ifadeleri yapıyor —
    # aynı mesajın ekranda iki kez görünmesini istemiyoruz).
    logger.propagate = False

    _logger = logger
    return logger