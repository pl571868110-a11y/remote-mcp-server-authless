# -*- coding: utf-8 -*-
"""
Конвертация Markdown-документов handover/*.md в PDF (по одному файлу на документ),
для передачи инженеру/геологу/геодезисту/поставщикам без риска случайного
редактирования. Используется reportlab (чистый Python) + DejaVuSans (кириллица).
"""
import os
import re
import glob
from xml.sax.saxutils import escape

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                 TableStyle, HRFlowable, ListFlowable, ListItem)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(HERE, "handover")
OUT_DIR = os.path.join(HERE, "handover", "pdf")
os.makedirs(OUT_DIR, exist_ok=True)

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
pdfmetrics.registerFont(TTFont("DejaVu", os.path.join(FONT_DIR, "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("DejaVu-Bold", os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf")))

styles = getSampleStyleSheet()
BASE = ParagraphStyle("Base", fontName="DejaVu", fontSize=9.5, leading=13.5, spaceAfter=6)
H1 = ParagraphStyle("H1", fontName="DejaVu-Bold", fontSize=16, leading=20, spaceBefore=4, spaceAfter=10)
H2 = ParagraphStyle("H2", fontName="DejaVu-Bold", fontSize=12.5, leading=16, spaceBefore=12, spaceAfter=6,
                     textColor=colors.HexColor("#1a3a6b"))
H3 = ParagraphStyle("H3", fontName="DejaVu-Bold", fontSize=10.5, leading=14, spaceBefore=8, spaceAfter=4)
QUOTE = ParagraphStyle("Quote", fontName="DejaVu-Bold", fontSize=10.5, leading=15, spaceBefore=6, spaceAfter=6,
                        textColor=colors.HexColor("#8a0000"), leftIndent=10,
                        borderColor=colors.HexColor("#8a0000"), borderWidth=1, borderPadding=8,
                        backColor=colors.HexColor("#fdeaea"))
BULLET = ParagraphStyle("Bullet", parent=BASE, leftIndent=14, spaceAfter=3)
TABLE_CELL = ParagraphStyle("TableCell", fontName="DejaVu", fontSize=8.3, leading=11)
TABLE_HEAD = ParagraphStyle("TableHead", fontName="DejaVu-Bold", fontSize=8.3, leading=11, textColor=colors.white)
FOOTER_STYLE = ParagraphStyle("Footer", fontName="DejaVu", fontSize=7.5, leading=9, textColor=colors.HexColor("#666666"))


def inline_md(text):
    """Экранирует XML-спецсимволы и переводит **bold** -> <b>, *italic* -> <i>, `code`."""
    text = escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", text)
    text = re.sub(r"`([^`]+)`", r'<font face="DejaVu">\1</font>', text)
    return text


def parse_table(lines):
    rows = [ln.strip().strip("|") for ln in lines]
    parsed = []
    for i, row in enumerate(rows):
        cells = [c.strip() for c in row.split("|")]
        if i == 1 and all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
            continue  # separator row
        parsed.append(cells)
    return parsed


def build_flowables(md_text, title_footer):
    lines = md_text.split("\n")
    story = []
    i = 0
    n = len(lines)
    para_buf = []

    def flush_para():
        if para_buf:
            txt = " ".join(para_buf).strip()
            if txt:
                story.append(Paragraph(inline_md(txt), BASE))
            para_buf.clear()

    while i < n:
        line = lines[i]
        stripped = line.strip()

        if stripped == "":
            flush_para()
            i += 1
            continue

        if stripped.startswith("#"):
            flush_para()
            m = re.match(r"^(#{1,6})\s*(.*)$", stripped)
            level = len(m.group(1))
            text = m.group(2)
            style = H1 if level == 1 else (H2 if level == 2 else H3)
            story.append(Paragraph(inline_md(text), style))
            i += 1
            continue

        if stripped == "---":
            flush_para()
            story.append(Spacer(1, 4))
            story.append(HRFlowable(width="100%", thickness=0.7, color=colors.HexColor("#999999")))
            story.append(Spacer(1, 6))
            i += 1
            continue

        if stripped.startswith(">"):
            flush_para()
            quote_lines = []
            while i < n and lines[i].strip().startswith(">"):
                quote_lines.append(lines[i].strip().lstrip(">").strip())
                i += 1
            qtext = " ".join(l for l in quote_lines if l)
            qtext = re.sub(r"^##\s*", "", qtext)
            story.append(Paragraph(inline_md(qtext), QUOTE))
            continue

        if stripped.startswith("|"):
            flush_para()
            table_lines = []
            while i < n and lines[i].strip().startswith("|"):
                table_lines.append(lines[i])
                i += 1
            rows = parse_table(table_lines)
            if rows:
                ncols = len(rows[0])
                col_width = (170 * mm) / ncols
                data = []
                for r_idx, row in enumerate(rows):
                    row = (row + [""] * ncols)[:ncols]
                    style_ = TABLE_HEAD if r_idx == 0 else TABLE_CELL
                    data.append([Paragraph(inline_md(c), style_) for c in row])
                tbl = Table(data, colWidths=[col_width] * ncols, repeatRows=1)
                tbl.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a3a6b")),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#aaaaaa")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f2f6fb")]),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ]))
                story.append(tbl)
                story.append(Spacer(1, 8))
            continue

        is_bullet = re.match(r"^[-*]\s+", stripped)
        is_numbered = re.match(r"^\d+\.\s+", stripped)
        if is_bullet or is_numbered:
            flush_para()
            marker_re = r"^[-*]\s+" if is_bullet else r"^\d+\.\s+"
            item_texts = []
            while i < n:
                cur = lines[i].strip()
                if cur == "" or cur.startswith(("#", "|", ">", "---")):
                    break
                if re.match(marker_re, cur):
                    item_texts.append(re.sub(marker_re, "", cur))
                elif re.match(r"^[-*]\s+", cur) or re.match(r"^\d+\.\s+", cur):
                    break  # a different list type starts here
                else:
                    # continuation line of the current item
                    if item_texts:
                        item_texts[-1] = item_texts[-1] + " " + cur
                    else:
                        break
                i += 1
            items = [ListItem(Paragraph(inline_md(t), BULLET), leftIndent=14) for t in item_texts]
            if is_bullet:
                story.append(ListFlowable(items, bulletType="bullet", start="•", leftIndent=10))
            else:
                story.append(ListFlowable(items, bulletType="1", leftIndent=10))
            story.append(Spacer(1, 4))
            continue

        para_buf.append(stripped)
        i += 1

    flush_para()
    return story


def make_footer(canvas, doc, label):
    canvas.saveState()
    canvas.setFont("DejaVu", 7.5)
    canvas.setFillColor(colors.HexColor("#666666"))
    canvas.drawString(20 * mm, 10 * mm, label)
    canvas.drawRightString(190 * mm, 10 * mm, f"Стр. {doc.page}")
    canvas.restoreState()


def convert_file(md_path):
    name = os.path.splitext(os.path.basename(md_path))[0]
    pdf_path = os.path.join(OUT_DIR, name + ".pdf")
    with open(md_path, "r", encoding="utf-8") as f:
        text = f.read()

    doc = SimpleDocTemplate(pdf_path, pagesize=A4,
                             leftMargin=20 * mm, rightMargin=20 * mm,
                             topMargin=18 * mm, bottomMargin=18 * mm,
                             title=name)
    story = build_flowables(text, name)
    footer_label = f"{name} — REFERENCE / PROCESS DOCUMENT, не проектная величина"

    def on_page(canvas, doc_):
        make_footer(canvas, doc_, footer_label)

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print("PDF:", pdf_path)
    return pdf_path


if __name__ == "__main__":
    md_files = sorted(glob.glob(os.path.join(SRC_DIR, "*.md")))
    for md_file in md_files:
        convert_file(md_file)
    print(f"Done: {len(md_files)} files converted -> {OUT_DIR}")
