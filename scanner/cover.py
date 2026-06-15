import os
import io
import zipfile
import fitz  # PyMuPDF
import ebooklib
from ebooklib import epub
from PIL import Image


COVER_MAX_WIDTH = 400
COVER_QUALITY = 85
COVER_FORMAT = "JPEG"


def extract_cover(file_path: str, output_path: str) -> bool:
    """
    Extract cover image from ebook and save as JPEG.
    Returns True on success, False on failure.
    """
    ext = os.path.splitext(file_path)[1].lower()

    if ext == ".epub":
        return _extract_epub_cover(file_path, output_path)
    elif ext == ".pdf":
        return _extract_pdf_cover(file_path, output_path)

    return False


def _extract_epub_cover(file_path: str, output_path: str) -> bool:
    # Method 1: ebooklib cover item
    try:
        book = epub.read_epub(file_path, options={"ignore_ncx": True})

        # Check for cover image in metadata
        cover_id = None
        for meta in book.get_metadata("OPF", "meta"):
            if len(meta) > 1 and meta[1].get("name") == "cover":
                cover_id = meta[1].get("content")
                break

        if cover_id:
            item = book.get_item_with_id(cover_id)
            if item:
                return _save_image_bytes(item.get_content(), output_path)

        # Check for item with cover in name or type
        for item in book.get_items():
            if item.get_type() == ebooklib.ITEM_COVER:
                return _save_image_bytes(item.get_content(), output_path)

        for item in book.get_items_of_type(ebooklib.ITEM_IMAGE):
            name = item.get_name().lower()
            if "cover" in name:
                return _save_image_bytes(item.get_content(), output_path)

    except Exception as e:
        print(f"  [EPUB cover method 1 hatası] {e}")

    # Method 2: Raw zip search
    try:
        with zipfile.ZipFile(file_path, "r") as z:
            names = z.namelist()
            for name in names:
                lower = name.lower()
                if "cover" in lower and any(
                    lower.endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".gif"]
                ):
                    data = z.read(name)
                    return _save_image_bytes(data, output_path)
    except Exception as e:
        print(f"  [EPUB cover method 2 hatası] {e}")

    return False


def _extract_pdf_cover(file_path: str, output_path: str) -> bool:
    try:
        doc = fitz.open(file_path)
        page = doc[0]

        # Render at 2x resolution for quality
        mat = fitz.Matrix(2.0, 2.0)
        pix = page.get_pixmap(matrix=mat)

        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        img = _resize_image(img)
        img.save(output_path, COVER_FORMAT, quality=COVER_QUALITY)
        doc.close()
        return True

    except Exception as e:
        print(f"  [PDF cover hatası] {e}")
        return False


def _save_image_bytes(data: bytes, output_path: str) -> bool:
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
        img = _resize_image(img)
        img.save(output_path, COVER_FORMAT, quality=COVER_QUALITY)
        return True
    except Exception as e:
        print(f"  [Görsel kaydetme hatası] {e}")
        return False


def _resize_image(img: Image.Image) -> Image.Image:
    if img.width > COVER_MAX_WIDTH:
        ratio = COVER_MAX_WIDTH / img.width
        new_height = int(img.height * ratio)
        img = img.resize((COVER_MAX_WIDTH, new_height), Image.LANCZOS)
    return img
