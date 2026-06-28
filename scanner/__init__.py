# -*- coding: utf-8 -*-
"""
scanner paketi — re-export hub.

scan.py'nin entry point'inde kullanılan tek halka nokta: scan_folder().
Faz 3 refactoring sonucu scan.py'nin tarama mantığı scan_processor.py,
scan_file.py, scan_report.py ve scan_cli.py arasında bölündü; bu dosya
o parçaları tek bir isim üzerinden dışa açar.

NOT: Burada bilinçli olarak GÖRECELİ import (".scan_processor") DEĞİL,
MUTLAK import ("scan_processor") kullanılıyor. Çünkü scan.py doğrudan
"python scan.py" ile çalıştırılıyor ve scanner/ klasörü bir Python
paketi olarak import edilmiyor — diğer tüm modüller (scan_cli, uploader,
metadata, api) de aynı şekilde mutlak import kullanıyor. Göreceli import
kullanmak mevcut çalışan yapıyla çelişir ve import hatasına yol açar.
"""

from scan_processor import scan_folder

__all__ = ["scan_folder"]