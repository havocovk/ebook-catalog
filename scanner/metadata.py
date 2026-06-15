import os
import re
import ebooklib
from ebooklib import epub
import fitz  # PyMuPDF


def extract_metadata(file_path: str) -> dict:
    """
    Extract metadata from an ebook file.
    Returns a dict with title, author, year, format.
    Falls back to filename parsing if embedded metadata is missing.
    """
    ext = os.path.splitext(file_path)[1].lower()
    metadata = {
        "title": None,
        "author": None,
        "year": None,
        "format": ext.lstrip("."),
        "file_path": file_path,
        "file_size": os.path.getsize(file_path),
    }

    if ext == ".epub":
        metadata.update(_extract_epub_metadata(file_path))
    elif ext == ".pdf":
        metadata.update(_extract_pdf_metadata(file_path))

    # Fallback: parse filename for missing fields
    if not metadata["title"] or not metadata["author"]:
        parsed = _parse_filename(file_path)
        if not metadata["title"]:
            metadata["title"] = parsed.get("title")
        if not metadata["author"]:
            metadata["author"] = parsed.get("author")

    return metadata


def _extract_epub_metadata(file_path: str) -> dict:
    result = {}
    try:
        book = epub.read_epub(file_path, options={"ignore_ncx": True})

        title = book.get_metadata("DC", "title")
        if title:
            result["title"] = title[0][0].strip()

        creator = book.get_metadata("DC", "creator")
        if creator:
            result["author"] = creator[0][0].strip()

        date = book.get_metadata("DC", "date")
        if date:
            raw = date[0][0]
            match = re.search(r"\d{4}", raw)
            if match:
                result["year"] = int(match.group())

    except Exception as e:
        print(f"  [EPUB metadata hatası] {file_path}: {e}")

    return result


def _extract_pdf_metadata(file_path: str) -> dict:
    result = {}
    try:
        doc = fitz.open(file_path)
        meta = doc.metadata

        if meta.get("title") and meta["title"].strip():
            result["title"] = meta["title"].strip()

        if meta.get("author") and meta["author"].strip():
            result["author"] = meta["author"].strip()

        if meta.get("creationDate"):
            match = re.search(r"\d{4}", meta["creationDate"])
            if match:
                result["year"] = int(match.group())

        doc.close()
    except Exception as e:
        print(f"  [PDF metadata hatası] {file_path}: {e}")

    return result


def _parse_filename(file_path: str) -> dict:
    """
    Try to extract title and author from filename.
    Supports patterns like:
      - Author Name - Book Title.epub
      - Book Title (Author Name).epub
      - Author Name - Series 01 - Book Title.epub
    """
    result = {}
    filename = os.path.splitext(os.path.basename(file_path))[0]

    # Pattern: "Author - Title" or "Author - Series 01 - Title"
    dash_parts = [p.strip() for p in filename.split(" - ")]
    if len(dash_parts) >= 2:
        result["author"] = dash_parts[0]
        result["title"] = dash_parts[-1]
        return result

    # Pattern: "Title (Author)"
    paren_match = re.match(r"^(.+?)\s*\(([^)]+)\)\s*$", filename)
    if paren_match:
        result["title"] = paren_match.group(1).strip()
        result["author"] = paren_match.group(2).strip()
        return result

    # Fallback: use full filename as title
    result["title"] = filename.replace("_", " ").replace(".", " ").strip()

    return result
