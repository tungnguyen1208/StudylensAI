from __future__ import annotations

import re
from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt
from docx.text.paragraph import Paragraph


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "docs" / "reports" / "SDS_StudyLens_AI_Final_v1.2.3.docx"
OUTPUT = ROOT / "docs" / "reports" / "SDS_StudyLens_AI_Final_v1.2.4.docx"

CHAPTER_PATTERN = re.compile(r"^(\d+)((?:\.\d+)*)\s+(.+)$")
CAPTION_PATTERN = re.compile(r"^(Bảng|Hình)\s+(\d+)\.(\d+):(.*)$")


def remove_paragraph(paragraph: Paragraph) -> None:
    parent = paragraph._p.getparent()
    if parent is not None:
        parent.remove(paragraph._p)


def replace_text(paragraph: Paragraph, text: str) -> None:
    paragraph.clear()
    paragraph.add_run(text)


def find_heading(document: Document, prefix: str) -> Paragraph:
    for paragraph in document.paragraphs:
        if paragraph.text.strip().startswith(prefix):
            return paragraph
    raise RuntimeError(f"Không tìm thấy heading bắt đầu bằng: {prefix}")


def remove_design_overview(document: Document) -> None:
    start = find_heading(document, "2 Tổng quan thiết kế hệ thống")
    end = find_heading(document, "3 Kiến trúc hệ thống")
    element = start._p
    while element is not None and element is not end._p:
        next_element = element.getnext()
        element.getparent().remove(element)
        element = next_element


def renumber_chapters_and_captions(document: Document) -> None:
    for paragraph in document.paragraphs:
        style_name = paragraph.style.name if paragraph.style else ""
        text = paragraph.text.strip()
        if style_name.startswith("Heading"):
            match = CHAPTER_PATTERN.match(text)
            if match and int(match.group(1)) >= 3:
                chapter = int(match.group(1)) - 1
                replace_text(paragraph, f"{chapter}{match.group(2)} {match.group(3)}")
            continue

        if style_name not in {"DATN Figure Caption", "DATN Table Caption"}:
            continue
        match = CAPTION_PATTERN.match(text)
        if match and int(match.group(2)) >= 3:
            chapter = int(match.group(2)) - 1
            replace_text(
                paragraph,
                f"{match.group(1)} {chapter}.{match.group(3)}:{match.group(4)}",
            )


def update_revision(document: Document) -> None:
    for paragraph in document.paragraphs[:10]:
        if paragraph.text.strip().startswith("Phiên bản 1.2.3"):
            replace_text(
                paragraph,
                "Phiên bản 1.2.4 theo public contract 0.5.0 và prompt nội bộ 0.5.1",
            )
            break

    document.tables[0].rows[1].cells[1].text = "1.2.4"
    history = document.tables[1]
    row = history.add_row()
    values = [
        "1.2.4",
        "13/10/2026",
        "Nhóm 10",
        "Bỏ chương Tổng quan thiết kế hệ thống; đánh lại số chương, mục, hình, bảng và cập nhật mục lục.",
    ]
    for cell, value in zip(row.cells, values, strict=True):
        cell.text = value
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        for paragraph in cell.paragraphs:
            paragraph.paragraph_format.line_spacing = 1.0
            paragraph.paragraph_format.space_after = Pt(0)
            for run in paragraph.runs:
                run.font.name = "Times New Roman"
                run.font.size = Pt(11)
                run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), "Times New Roman")
                run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), "Times New Roman")
    for cell in row.cells[:3]:
        cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    for paragraph in document.paragraphs:
        if paragraph.text.strip().startswith("Revision 1.2.3 mô tả StudyLens AI"):
            replace_text(
                paragraph,
                paragraph.text.replace("Revision 1.2.3", "Revision 1.2.4", 1),
            )
            break

    document.core_properties.comments = (
        "Revision 1.2.4 removes the redundant design-overview chapter, "
        "renumbers the SDS hierarchy, and refreshes the table of contents."
    )


def main() -> None:
    if not INPUT.exists():
        raise FileNotFoundError(INPUT)

    document = Document(INPUT)
    remove_design_overview(document)
    renumber_chapters_and_captions(document)
    update_revision(document)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document.save(OUTPUT)
    print(OUTPUT.name)


if __name__ == "__main__":
    main()
