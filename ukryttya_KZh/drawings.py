# -*- coding: utf-8 -*-
"""
Генерация чертёжных листов КЖ-0 .. КЖ-17 (схематично, предварительно).
Формат: A3 альбом (420х297 мм). Каждый лист: рамка, штамп, красная плашка
с обязательным дисклеймером, статус DRAFT.

Экспорт: combined PDF (все листы), + PNG и SVG на каждый лист отдельно.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Circle, FancyArrowPatch
from matplotlib.backends.backend_pdf import PdfPages
import os

from calc import (DISCLAIMER, PROJECT_DATE, PROJECT_NAME, PROJECT_LOCATION,
                   OUT_L, OUT_W, IN_L, IN_W, IN_H, WALL_T, TOP_SLAB_T, BOT_SLAB_T,
                   BOT_SLAB_T_B, SOIL_OVER_TOP, TOTAL_DEPTH, ENTRY_OPENING, HATCH,
                   CONCRETE_CLASS, CONCRETE_W, CONCRETE_F, REBAR_CLASS,
                   CONCRETE_TABLE, REBAR_TABLE, vol_main_box_A, vol_total_order_A,
                   mass_rebar_total_t, BUOY_A_with_soil, BUOY_A_no_soil,
                   BUOY_B_with_soil, BUOY_B_no_soil, LATERAL_RESULTS,
                   n_vert_per_layer, n_horiz_per_layer, vert_bar_len, horiz_bar_len,
                   n_top_a, n_top_b, l_top_a, l_top_b, n_bot_a, n_bot_b,
                   PEOPLE, AIR_FLOW_MIN_M3H, AIR_FLOW_MAX_M3H,
                   WATER_MIN_L, WATER_PRACTICAL_L, WATER_PREFERRED_L)
from pricing import (BUDGET, SUBTOTAL_LOW, SUBTOTAL_REALISTIC, SUBTOTAL_HIGH,
                      RESERVE_LOW, RESERVE_REALISTIC, RESERVE_HIGH,
                      TOTAL_LOW, TOTAL_REALISTIC, TOTAL_HIGH, Q_CONCRETE_M3, Q_REBAR_T,
                      BATTERY_10KWH, SERIOUS_TOTAL)

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
PNG_DIR = os.path.join(OUT_DIR, "png")
SVG_DIR = os.path.join(OUT_DIR, "svg")
PDF_PATH = os.path.join(OUT_DIR, "ukryttya_3x4_KZh_draft.pdf")

PAGE_W, PAGE_H = 420.0, 297.0   # мм, A3 альбом

plt.rcParams["font.family"] = "DejaVu Sans"

SHEETS_META = []   # (code, title) заполняется по ходу генерации, для README/отчёта


def _wrap(text, width=100):
    import textwrap
    return "\n".join(textwrap.wrap(text, width=width))


def new_page(code, title, scale_text="Без масштаба / схематично"):
    fig = plt.figure(figsize=(PAGE_W / 25.4, PAGE_H / 25.4))
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, PAGE_W)
    ax.set_ylim(0, PAGE_H)
    ax.set_aspect("equal")
    ax.axis("off")

    # внешняя рамка листа
    ax.add_patch(Rectangle((5, 5), PAGE_W - 10, PAGE_H - 10, fill=False, lw=1.0, ec="black"))

    # === нижняя полоса: дисклеймер (слева) + штамп (справа), высота 38мм ===
    band_h = 38
    band_y = 5
    # красная плашка дисклеймера
    disc_w = 255
    ax.add_patch(Rectangle((5, band_y), disc_w, band_h, fill=False, ec="red", lw=1.3))
    ax.text(5 + disc_w / 2, band_y + band_h - 6, "ВНИМАНИЕ — ЧЕРНОВИК",
            ha="center", va="top", color="red", fontsize=9, fontweight="bold")
    ax.text(5 + disc_w / 2, band_y + band_h - 13, _wrap(DISCLAIMER, 78),
            ha="center", va="top", color="red", fontsize=6.3, linespacing=1.35)

    # штамп (title block)
    tb_x = 5 + disc_w
    tb_w = (PAGE_W - 10) - disc_w
    ax.add_patch(Rectangle((tb_x, band_y), tb_w, band_h, fill=False, ec="black", lw=1.0))
    rows = [
        ("Объект:", "Подземное укрытие 4,0х3,0 м в свету"),
        ("Адрес:", PROJECT_LOCATION),
        ("Лист:", f"{code} — {title}"),
        ("Масштаб:", scale_text),
        ("Дата:", PROJECT_DATE),
        ("Статус:", "DRAFT / ЧЕРНОВИК — не для строительства"),
    ]
    n = len(rows)
    row_h = band_h / n
    for i, (k, v) in enumerate(rows):
        y = band_y + band_h - (i + 1) * row_h
        ax.add_patch(Rectangle((tb_x, y), tb_w, row_h, fill=False, ec="black", lw=0.4))
        ax.text(tb_x + 2, y + row_h / 2, k, ha="left", va="center", fontsize=5.6, fontweight="bold")
        ax.text(tb_x + 28, y + row_h / 2, _wrap(v, 46), ha="left", va="center", fontsize=5.6)

    # заголовок листа сверху content-области
    ax.text(10, PAGE_H - 10, f"{code}   {title}", ha="left", va="top",
            fontsize=13, fontweight="bold")
    ax.text(10, PAGE_H - 16, PROJECT_NAME, ha="left", va="top", fontsize=7.5, style="italic")

    content_box = (8, band_y + band_h + 4, PAGE_W - 8, PAGE_H - 20)  # x0,y0,x1,y1
    SHEETS_META.append((code, title))
    return fig, ax, content_box


def save_all(fig, code):
    fig.savefig(os.path.join(PNG_DIR, f"{code.replace(' ', '_')}.png"), dpi=200)
    fig.savefig(os.path.join(SVG_DIR, f"{code.replace(' ', '_')}.svg"))


# ---------------------------------------------------------------- helpers ---
def dim_h(ax, x1, x2, y, text, tick=1.6, fs=6.2):
    ax.plot([x1, x1], [y - tick, y + tick], color="black", lw=0.6)
    ax.plot([x2, x2], [y - tick, y + tick], color="black", lw=0.6)
    ax.annotate("", xy=(x2, y), xytext=(x1, y),
                arrowprops=dict(arrowstyle="<->", lw=0.6, color="black"))
    ax.text((x1 + x2) / 2, y + 2.2, text, ha="center", va="bottom", fontsize=fs)


def dim_v(ax, y1, y2, x, text, tick=1.6, fs=6.2):
    ax.plot([x - tick, x + tick], [y1, y1], color="black", lw=0.6)
    ax.plot([x - tick, x + tick], [y2, y2], color="black", lw=0.6)
    ax.annotate("", xy=(x, y2), xytext=(x, y1),
                arrowprops=dict(arrowstyle="<->", lw=0.6, color="black"))
    ax.text(x + 2.2, (y1 + y2) / 2, text, ha="left", va="center", fontsize=fs, rotation=90)


def hatch_rect(ax, x, y, w, h, fc="0.85", hatch="////", lw=0.5, ec="black"):
    ax.add_patch(Rectangle((x, y), w, h, facecolor=fc, hatch=hatch, lw=lw, ec=ec))


def table_on_ax(fig, ax, box, col_labels, rows, fontsize=6.3, title=None, col_widths=None,
                 header_color="#dbe5f1"):
    """box в мм-координатах страницы (x0,y0,x1,y1). Создаёт вложенные axes-в-долях
    рисунка, точно совпадающие с этим прямоугольником, и рисует там таблицу."""
    x0, y0, x1, y1 = box
    if title:
        ax.text(x0, y1 + 2, title, ha="left", va="bottom", fontsize=8, fontweight="bold")
    fx0, fy0 = x0 / PAGE_W, y0 / PAGE_H
    fw, fh = (x1 - x0) / PAGE_W, (y1 - y0) / PAGE_H
    tax = fig.add_axes([fx0, fy0, fw, fh])
    tax.axis("off")
    tbl = tax.table(cellText=rows, colLabels=col_labels, cellLoc="center",
                     bbox=[0, 0, 1, 1], colWidths=col_widths)
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(fontsize)
    for (r, c), cell in tbl.get_celld().items():
        cell.set_linewidth(0.4)
        if r == 0:
            cell.set_facecolor(header_color)
            cell.set_text_props(fontweight="bold")
    return tbl


# ============================================================ КЖ-0 =========
def sheet_00():
    fig, ax, cb = new_page("КЖ-0", "Общие данные")
    x0, y0, x1, y1 = cb
    left_w = (x1 - x0) * 0.56

    ax.text(x0, y1 - 2, "1. НАЗНАЧЕНИЕ И ОБЪЕКТ", fontsize=8.5, fontweight="bold", va="top")
    txt1 = (
        f"Объект: {PROJECT_NAME}.\n"
        f"Местоположение: {PROJECT_LOCATION}.\n"
        f"Назначение: отдельно стоящее полностью подземное гражданское укрытие\n"
        f"для временного пребывания {PEOPLE} человек.\n\n"
        f"Габариты: наружные {OUT_L}x{OUT_W} мм; внутренние (в свету) {IN_L}x{IN_W} мм;\n"
        f"чистая высота {IN_H} мм. Общая глубина от уровня земли до низа плиты\n"
        f"основания ~ {TOTAL_DEPTH} мм (грунт {SOIL_OVER_TOP} + плита верх {TOP_SLAB_T} +\n"
        f"свет {IN_H} + плита низ {BOT_SLAB_T}).\n\n"
        f"Конструктив: монолитный железобетонный короб. Наружная мембранная\n"
        f"гидроизоляция невозможна -> конструкция рассматривается по принципу\n"
        f"«белой ванны» (водонепроницаемый бетон + гидрошпонки в рабочих швах +\n"
        f"инъекционные шланги + при необходимости кристаллизующиеся составы).\n\n"
        f"Материалы (предварительно, до проверки расчётом):\n"
        f"  - бетон {CONCRETE_CLASS}, {CONCRETE_W}, {CONCRETE_F};\n"
        f"  - арматура {REBAR_CLASS};\n"
        f"  - стены: Ø12 {REBAR_CLASS} / 150 мм верт.+гориз., две полные сетки;\n"
        f"  - плиты (верх/низ): Ø14 {REBAR_CLASS} / 150х150, верх.+ниж. сетки;\n"
        f"  - проём входа: {ENTRY_OPENING} мм (предв.); аварийный люк {HATCH[0]}x{HATCH[1]} мм;\n"
        f"  - усиление проёмов: Ø16 {REBAR_CLASS} (предварительно)."
    )
    ax.text(x0, y1 - 6, txt1, fontsize=6.6, va="top", linespacing=1.5)

    ax.text(x0 + left_w + 4, y1 - 2, "2. НОРМАТИВЫ ДЛЯ ПРОВЕРКИ", fontsize=8.5, fontweight="bold", va="top")
    txt2 = (
        "- ДБН В.2.2-5 (захисні споруди цивільного захисту);\n"
        "- ДСТУ Б В.2.6-156 / ДБН В.2.6-98 (залізобетонні конструкції);\n"
        "- ДБН В.1.1-7, В.1.2-2 (навантаження і впливи);\n"
        "- ДБН В.2.1-10 (основи та фундаменти);\n"
        "- ДСТУ 3760 (арматура А500С);\n"
        "- ДСТУ Б В.2.7-176 (бетони, вимоги до W, F, C);\n"
        "- вимоги ЦЗ щодо класу захисту, повітрообміну, аварійного виходу;\n"
        "- ДБН В.2.5 (вентиляція), ПУЕ (електрика) — по інженерних розділах.\n\n"
        "ВСЕ ссылки — ориентировочны; окончательный перечень норм\n"
        "определяет лицензированный инженер-конструктор."
    )
    ax.text(x0 + left_w + 4, y1 - 6, txt2, fontsize=6.6, va="top", linespacing=1.5)

    ax.text(x0, y1 - 92, "3. ОТСУТСТВУЮЩИЕ ИСХОДНЫЕ ДАННЫЕ (ОБЯЗАТЕЛЬНЫ ДО РАБОЧЕГО ПРОЕКТА)",
            fontsize=8.5, fontweight="bold", va="top", color="#8a0000")
    txt3 = (
        "- инженерно-геологические изыскания (литология, УГВ, физ.-мех. св-ва грунтов);\n"
        "- уровень грунтовых вод (сезонный максимум) и его агрессивность;\n"
        "- плотность и угол внутреннего трения грунта обратной засыпки;\n"
        "- расчётное сопротивление основания R0;\n"
        "- фактическая отметка участка, геодезическая привязка, соседние фундаменты/сети;\n"
        "- нагрузки сверху (проезд техники, снег, планируемое благоустройство/навес);\n"
        "- требуемый класс защитного сооружения ЦЗ (не назначается в этом комплекте);\n"
        "- паспортные данные выбранных дверей и люка (посадочные размеры, вес, класс)."
    )
    ax.text(x0, y1 - 96, txt3, fontsize=6.6, va="top", linespacing=1.55, color="#8a0000")

    ax.add_patch(Rectangle((x0, y0 + 2), x1 - x0, 14, fill=False, ec="red", lw=1.3))
    ax.text(x0 + (x1 - x0) / 2, y0 + 9,
            "«НЕ ИСПОЛЬЗОВАТЬ ДЛЯ БЕТОНИРОВАНИЯ БЕЗ ПРОВЕРКИ ИНЖЕНЕРОМ-КОНСТРУКТОРОМ»",
            ha="center", va="center", fontsize=9, fontweight="bold", color="red")

    save_all(fig, "KZh-00-obshie-dannye")
    return fig


# ============================================================ КЖ-1 =========
def sheet_01():
    fig, ax, cb = new_page("КЖ-1", "План основного железобетонного короба", "М 1:40 (индикативно)")
    x0, y0, x1, y1 = cb
    K = 0.045  # мм листа на мм натуры
    ox, oy = x0 + 15, y0 + 34   # план внизу-слева content-области, с запасом сверху и снизу

    def X(mm_x):
        return ox + mm_x * K

    def Y(mm_y):
        return oy + mm_y * K

    plan_right = X(OUT_L)   # правая граница плана — далее идёт таблица

    # наружный контур
    ax.add_patch(Rectangle((X(0), Y(0)), OUT_L * K, OUT_W * K, fill=False, lw=1.4, ec="black"))
    # внутренний контур (стены 300)
    ax.add_patch(Rectangle((X(WALL_T), Y(WALL_T)), IN_L * K, IN_W * K, fill=False, lw=1.0, ec="black"))
    hatch_rect(ax, X(0), Y(0), OUT_L * K, WALL_T * K, fc="0.8")
    hatch_rect(ax, X(0), Y(OUT_W - WALL_T), OUT_L * K, WALL_T * K, fc="0.8")
    hatch_rect(ax, X(0), Y(0), WALL_T * K, OUT_W * K, fc="0.8")
    hatch_rect(ax, X(OUT_L - WALL_T), Y(0), WALL_T * K, OUT_W * K, fc="0.8")

    # зоны внутри (предварительно) — люк вынесен в угол склада, в пределах внутр. контура
    zones = [
        ("Спальная зона\n(2х2-ярусные кровати)", 300, 300, 1700, 1300, "#eaf2ff"),
        ("Санитарная зона\n(биотуалет)", 300, 1750, 900, 1150, "#e9ffe9"),
        ("Техническая зона\n(щит, инвертор, АКБ)", 1350, 1750, 900, 1150, "#fff3e0"),
        ("Склад / запас воды", 2150, 300, 1550, 1300, "#f5e9ff"),
        ("Проход", 300, 1600, 3400, 150, "#ffffff"),
    ]
    for label, zx, zy, zw, zh, col in zones:
        ax.add_patch(Rectangle((X(WALL_T + zx), Y(WALL_T + zy)), zw * K, zh * K,
                                 fill=True, fc=col, ec="0.4", lw=0.5))
        ax.text(X(WALL_T + zx + zw / 2), Y(WALL_T + zy + zh / 2), label,
                ha="center", va="center", fontsize=5.0)

    # вход (на правой короткой стене)
    entry_y0 = (OUT_W - ENTRY_OPENING) / 2
    ax.add_patch(Rectangle((X(OUT_L - WALL_T - 2), Y(entry_y0)), (WALL_T + 4) * K, ENTRY_OPENING * K,
                            fill=True, fc="white", ec="red", lw=1.2))
    ax.text(X(OUT_L) + 3, Y(entry_y0 + ENTRY_OPENING / 2), "ВХОД\n(шахта)", fontsize=5.4,
            ha="left", va="center", color="red")

    # аварийный люк — в свободном промежутке между спальной зоной и складом
    hx, hy = 1750, 650
    ax.add_patch(Rectangle((X(WALL_T + hx), Y(WALL_T + hy)), HATCH[0] * K, HATCH[1] * K,
                            fill=True, fc="white", ec="darkorange", lw=1.2, hatch="xx"))
    ax.text(X(WALL_T + hx + HATCH[0] / 2), Y(WALL_T + hy) - 3, "АВАР.\nЛЮК", fontsize=4.6,
            ha="center", va="top", color="darkorange")

    # вентиляция / электрика / вода — точки проходок: только маркер + номер (описание в таблице)
    pens = [
        ("P1", WALL_T, 500, "o", "tab:blue"),
        ("P2", OUT_L - WALL_T, OUT_W - 600, "o", "tab:red"),
        ("P3", 900, WALL_T, "s", "black"),
        ("P4", 1300, WALL_T, "s", "0.4"),
        ("P5", WALL_T, OUT_W - 300, "^", "tab:cyan"),
    ]
    for label, px, py, marker, col in pens:
        ax.plot(X(px), Y(py), marker=marker, color=col, ms=4.5, mec="black", mew=0.3)
        ax.text(X(px), Y(py) + 4, label, fontsize=5.4, color=col, ha="center", fontweight="bold",
                bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.85))

    # габаритные размеры (над планом, используя запас между планом и заголовком листа)
    dim_h(ax, X(0), X(OUT_L), Y(OUT_W) + 8, f"{OUT_L} мм (наружный)")
    dim_h(ax, X(WALL_T), X(WALL_T + IN_L), Y(OUT_W) + 16, f"{IN_L} мм (в свету)")
    dim_v(ax, Y(0), Y(OUT_W), X(0) - 20, f"{OUT_W}")
    ax.text(X(-4), Y(OUT_W / 2), f"стены\n{WALL_T} мм", rotation=90, fontsize=5.6, ha="right", va="center")

    ax.text(x0, y0 + 6, "Ориентация условная. Планировка зон, координаты проёмов\nи проходок — ПРЕДВАРИТЕЛЬНЫЕ.",
            fontsize=6.0, color="#8a0000", va="bottom")

    # таблица проёмов/проходок с координатами — отдельной колонкой справа от плана
    col_labels = ["Поз.", "Наименование", "Размер, мм", "Коорд. от углов, мм", "Статус"]
    rows = [
        ["—", "Вход", f"{ENTRY_OPENING}", f"{int(entry_y0)} от обоих\nсоседних углов", "предв."],
        ["—", "Авар. люк", f"{HATCH[0]}x{HATCH[1]}", f"X={hx+WALL_T} Y={hy+WALL_T}", "предв."],
        ["P1", "Приток вент.", "~Ø150 (расч.)", f"X={WALL_T} Y=500", "предв."],
        ["P2", "Вытяжка вент.", "~Ø150 (расч.)", f"X={int(OUT_L-WALL_T)} Y={int(OUT_W-600)}", "предв."],
        ["P3", "Электр. ввод", "гильза ~Ø63", f"X=900 Y={WALL_T}", "предв."],
        ["P4", "Рез. кабель", "гильза ~Ø63", f"X=1300 Y={WALL_T}", "предв."],
        ["P5", "Ввод воды (возм.)", "гильза ~Ø50", f"X={WALL_T} Y={int(OUT_W-300)}", "предв., если треб."],
    ]
    table_top = y1 - 4
    table_bottom = y0 + 60
    table_on_ax(fig, ax, (plan_right + 18, table_bottom, x1 - 2, table_top),
                col_labels, rows, fontsize=6.1, title="Проёмы и проходки (координаты от углов)",
                col_widths=[0.1, 0.24, 0.22, 0.28, 0.16])

    legend_y = table_bottom - 8
    ax.text(plan_right + 18, legend_y,
            "Условные обозначения: ○ вентиляция  ▢ электрика  △ вода\n"
            "P1..P5 — см. также КЖ-10 (узлы проходок).",
            fontsize=6.0, va="top")

    save_all(fig, "KZh-01-plan")
    return fig


# ============================================================ КЖ-2 =========
def sheet_02():
    fig, ax, cb = new_page("КЖ-2", "Разрез А-А", "М 1:25 (индикативно)")
    x0, y0, x1, y1 = cb
    K = 0.032   # мм-листа на мм-натуры (по вертикали и горизонтали одинаково)
    ox = x0 + 60
    ground_y = y1 - 20  # уровень земли на листе

    def Y(depth_mm):  # depth от уровня земли вниз
        return ground_y - depth_mm * K

    width_draw = OUT_L * K * 0.55  # укороченный разрез по ширине для компактности

    # грунт над плитой
    top_soil_y1 = ground_y
    top_soil_y0 = Y(SOIL_OVER_TOP)
    hatch_rect(ax, ox, top_soil_y0, width_draw, top_soil_y1 - top_soil_y0, fc="#c9a876", hatch="...", ec="0.3")
    ax.text(ox - 4, (top_soil_y0 + top_soil_y1) / 2, f"грунт\n{SOIL_OVER_TOP}", fontsize=5.4, ha="right", va="center")

    # верхняя плита
    ts_y1 = top_soil_y0
    ts_y0 = Y(SOIL_OVER_TOP + TOP_SLAB_T)
    hatch_rect(ax, ox, ts_y0, width_draw, ts_y1 - ts_y0, fc="0.75", hatch="////", ec="black")
    ax.text(ox - 4, (ts_y0 + ts_y1) / 2, f"плита\n{TOP_SLAB_T}", fontsize=5.4, ha="right", va="center")

    # внутренний объём
    in_y1 = ts_y0
    in_y0 = Y(SOIL_OVER_TOP + TOP_SLAB_T + IN_H)
    ax.add_patch(Rectangle((ox, in_y0), width_draw, in_y1 - in_y0, fill=True, fc="#f5faff", ec="black", lw=1.0))
    ax.text(ox + width_draw / 2, (in_y0 + in_y1) / 2, f"внутр. объём\nH={IN_H} мм (в свету)",
            fontsize=6.0, ha="center", va="center")

    # стены (толщиной WALL_T) слева и справа от внутр. объёма
    hatch_rect(ax, ox - WALL_T * K, in_y0, WALL_T * K, in_y1 - in_y0, fc="0.75", hatch="\\\\\\\\", ec="black")
    hatch_rect(ax, ox + width_draw, in_y0, WALL_T * K, in_y1 - in_y0, fc="0.75", hatch="\\\\\\\\", ec="black")

    # нижняя плита
    bs_y1 = in_y0
    bs_y0 = Y(SOIL_OVER_TOP + TOP_SLAB_T + IN_H + BOT_SLAB_T)
    hatch_rect(ax, ox - WALL_T * K, bs_y0, width_draw + 2 * WALL_T * K, bs_y1 - bs_y0, fc="0.75", hatch="////", ec="black")
    ax.text(ox - 4, (bs_y0 + bs_y1) / 2, f"плита\n{BOT_SLAB_T}", fontsize=5.4, ha="right", va="center")

    # подготовка основания (тощий бетон, схематично)
    prep_y1 = bs_y0
    prep_y0 = prep_y1 - 5
    hatch_rect(ax, ox - WALL_T * K, prep_y0, width_draw + 2 * WALL_T * K, prep_y1 - prep_y0, fc="0.9", hatch="----", ec="0.4")
    ax.text(ox + width_draw + 2 * WALL_T * K + 4, (prep_y0 + prep_y1) / 2, "подготовка\n(тощий бетон)",
            fontsize=5.0, ha="left", va="center")

    # линия земли
    ax.plot([ox - 40, ox + width_draw + 40], [ground_y, ground_y], color="black", lw=1.2)
    ax.text(ox - 42, ground_y, "▽ уровень земли", fontsize=6, ha="right", va="center")

    # арматура схематично — точки в плитах и линии в стенах
    for yy in [ts_y0 + 3, ts_y1 - 3]:
        ax.plot([ox + 3, ox + width_draw - 3], [yy, yy], color="tab:red", lw=0.6, ls="--")
    for yy in [bs_y0 + 3, bs_y1 - 3]:
        ax.plot([ox + 3, ox + width_draw - 3], [yy, yy], color="tab:red", lw=0.6, ls="--")
    ax.text(ox + width_draw + 2, ts_y0 - 2, "Ø14/150х150\n(верх+низ)", fontsize=4.8, color="tab:red")
    ax.text(ox + width_draw + 2, bs_y0 - 2, "Ø14/150х150\n(верх+низ)", fontsize=4.8, color="tab:red")
    ax.plot([ox - WALL_T * K + 3, ox - WALL_T * K + 3], [in_y0 + 3, in_y1 - 3], color="tab:blue", lw=0.6, ls=":")
    ax.text(ox - WALL_T * K - 2, (in_y0 + in_y1) / 2 + 15, "Ø12/150\n(2 сетки)", fontsize=4.8, color="tab:blue", ha="right")

    # рабочий шов + гидрошпонка на стыке стена/плита низ
    ax.plot([ox - WALL_T * K, ox], [bs_y1, bs_y1], color="purple", lw=1.6)
    ax.text(ox + width_draw + 2, bs_y1 + 2, "раб. шов + гидрошпонка", fontsize=4.6, color="purple")

    # вентиляционные трубы (схематично, две трубы через верхнюю плиту)
    for i, lbl in enumerate(["P1 приток", "P2 вытяжка"]):
        vx = ox + width_draw * (0.25 + 0.5 * i)
        ax.plot([vx, vx], [ground_y, ts_y0 - 2], color="tab:blue", lw=2.2)
        ax.text(vx, ground_y + 3, lbl, fontsize=4.6, ha="center", color="tab:blue")

    # аварийная шахта и лестница (справа, отдельная колонка)
    shaft_x = ox + width_draw + 30
    shaft_w = 16
    ax.add_patch(Rectangle((shaft_x, ts_y0), shaft_w, ground_y - ts_y0, fill=False, ec="darkorange", lw=1.0))
    for i in range(6):
        yy = ts_y0 + (ground_y - ts_y0) * (i + 0.5) / 6
        ax.plot([shaft_x + 2, shaft_x + shaft_w - 2], [yy, yy], color="darkorange", lw=0.8)
    ax.text(shaft_x + shaft_w / 2, ground_y + 3, "авар.\nшахта +\nлестница", fontsize=4.6, ha="center", color="darkorange")

    # вход слева
    ax.text(ox - 60, ground_y - 20, "вход\n(шахта, лестница,\nтамбур — см. КЖ-8)", fontsize=4.8, ha="center", color="red")

    # габарит по глубине
    dim_v(ax, ground_y, Y(TOTAL_DEPTH), ox - 70, f"{TOTAL_DEPTH} мм общая глубина")
    dim_v(ax, ts_y1, ts_y0, ox + width_draw + 55, f"{TOP_SLAB_T}")
    dim_v(ax, in_y1, in_y0, ox + width_draw + 55, f"{IN_H}")
    dim_v(ax, bs_y1, bs_y0, ox + width_draw + 55, f"{BOT_SLAB_T}")

    notes = ("Показаны схематично: арматура, защитные слои (~35-40мм), рабочие швы,\n"
             "гидрошпонки, подготовка основания, вентканалы, аварийная шахта, лестница, вход.\n"
             "Точное положение и число вент./кабельных проходок — см. КЖ-10 (предварительно).")
    ax.text(x0, y0 + 4, notes, fontsize=6.2, color="#8a0000", va="bottom")

    save_all(fig, "KZh-02-razrez")
    return fig


# ============================================================ КЖ-3 =========
def sheet_03():
    fig, ax, cb = new_page("КЖ-3", "Схема армирования стен", "М 1:30 (индикативно)")
    x0, y0, x1, y1 = cb
    K = 0.032
    # развёртка длинной стены (по осям 4300) сверху, короткой (3300) снизу
    wall_cl_L = OUT_L - WALL_T
    wall_cl_W = OUT_W - WALL_T

    def draw_wall(ox, oy, length_mm, label):
        w = length_mm * K
        h = IN_H * K
        ax.add_patch(Rectangle((ox, oy), w, h, fill=False, ec="black", lw=1.2))
        # горизонтальные стержни (каждый 3-й показан, шаг реальный подписан)
        step = 150 * K
        n_show = int(h / step)
        for i in range(n_show + 1):
            yy = oy + i * step
            if yy > oy + h:
                break
            ax.plot([ox, ox + w], [yy, yy], color="tab:blue", lw=0.35)
        step_v = 150 * K
        n_show_v = int(w / step_v)
        for i in range(0, n_show_v + 1, 2):  # прорежаем для читаемости
            xx = ox + i * step_v
            if xx > ox + w:
                break
            ax.plot([xx, xx], [oy, oy + h], color="tab:red", lw=0.35)
        ax.text(ox + w / 2, oy - 6, f"{label}  (осевая длина {length_mm} мм)", ha="center", fontsize=6.6, fontweight="bold")
        dim_h(ax, ox, ox + w, oy - 3, f"{length_mm}")
        return ox, oy, w, h

    draw_wall(x0 + 10, 95, wall_cl_W, "Стена короткая (развёртка)")
    draw_wall(x0 + 10, 181, wall_cl_L, "Стена длинная (развёртка)")

    ax.text(x0 + 10, y1 - 4,
            "Условно: синие линии — горизонтальная арматура Ø12/150 (2 сетки, наружная+внутренняя);\n"
            "красные линии — вертикальная арматура Ø12/150 (показана с прореживанием для читаемости).\n"
            "Угловые Г-образные и П-образные доборные элементы, анкеровка и нахлёсты — см. узлы КЖ-6/КЖ-7.\n"
            "Усиление проёмов (вход, люк) — Ø16, см. КЖ-8, КЖ-9.",
            fontsize=6.2, va="top")

    from calc import mass_walls_d12_kg, len_walls_d12_m
    col_labels = ["Поз.", "Описание", "Шаг, мм", "Слоёв", "Кол-во стержней", "Длина 1 ст., м", "Общая длина, м", "Масса, кг"]
    rows = [
        ["1", "Верт. арматура стен Ø12", "150", "2 (нар.+вн.)", f"{2*n_vert_per_layer}", f"{vert_bar_len/1000:.2f}",
         f"{2*n_vert_per_layer*vert_bar_len/1000:.1f}", f"{2*n_vert_per_layer*vert_bar_len/1000*0.888:.1f}"],
        ["2", "Гориз. арматура стен Ø12", "150", "2 (нар.+вн.)", f"{2*n_horiz_per_layer}", f"{horiz_bar_len/1000:.2f}",
         f"{2*n_horiz_per_layer*horiz_bar_len/1000:.1f}", f"{2*n_horiz_per_layer*horiz_bar_len/1000*0.888:.1f}"],
        ["3", "ИТОГО стены Ø12 (осн.)", "-", "-", "-", "-", f"{len_walls_d12_m:.1f}", f"{mass_walls_d12_kg:.1f}"],
        ["4", "Угловые/доборные эл-ты (~8%, предв.)", "-", "-", "-", "-", "-", f"{0.08*mass_walls_d12_kg:.1f}"],
    ]
    table_on_ax(fig, ax, (x0, y0 + 4, x1 - 5, y0 + 36),
                col_labels, rows, fontsize=5.9,
                col_widths=[0.05, 0.30, 0.08, 0.11, 0.14, 0.12, 0.12, 0.1])

    save_all(fig, "KZh-03-steny")
    return fig


# ============================================================ КЖ-4 =========
def _slab_sheet(code, title, thickness, area_label):
    fig, ax, cb = new_page(code, title, "М 1:40 (индикативно)")
    x0, y0, x1, y1 = cb
    K = 0.033
    w, h = OUT_L * K, OUT_W * K
    ox, oy = x0 + 15, y0 + 90

    ax.add_patch(Rectangle((ox, oy), w, h, fill=False, ec="black", lw=1.2))
    step = 150 * K
    nx = int(w / step)
    ny = int(h / step)
    for i in range(0, nx + 1, 2):
        xx = ox + i * step
        if xx <= ox + w:
            ax.plot([xx, xx], [oy, oy + h], color="tab:red", lw=0.3)
    for i in range(0, ny + 1, 2):
        yy = oy + i * step
        if yy <= oy + h:
            ax.plot([ox, ox + w], [yy, yy], color="tab:blue", lw=0.3)
    ax.text(ox + w / 2, oy - 6, f"Нижняя сетка Ø14/150х150 (условно показана с прореживанием)",
            fontsize=6, ha="center")

    # зоны усиления
    zones = [
        ("над стенами\n(контур)", ox, oy, w, WALL_T * K, "over"),
        ("вокруг вход. шахты", ox + w - 40, oy + h * 0.3, 35, 40, "entry"),
        ("вокруг авар. люка", ox + 10, oy + h * 0.6, 30, 30, "hatch"),
    ]
    for label, zx, zy, zw, zh, key in zones:
        ax.add_patch(Rectangle((zx, zy), zw, zh, fill=False, ec="darkorange", lw=1.0, ls="--"))
        ax.text(zx + zw / 2, zy + zh / 2, label, fontsize=4.6, ha="center", va="center", color="darkorange")

    dim_h(ax, ox, ox + w, oy - 14, f"{OUT_L} мм")
    dim_v(ax, oy, oy + h, ox + w + 8, f"{OUT_W} мм")

    ax.text(x0, oy + h + 10,
            f"Толщина плиты: {thickness} мм. Показана нижняя сетка; верхняя сетка идентична (Ø14/150х150),\n"
            f"расположена в верхней зоне плиты с соответствующими защитными слоями.\n"
            f"Дополнительное усиление в зонах над стенами, вокруг проёмов и шахт — по красным пунктирным\n"
            f"контурам; точный состав усиления требует расчёта и показан здесь как «предварительное усиление».",
            fontsize=6.2, va="bottom")
    return fig, ax, cb, ox, oy, w, h


def sheet_04():
    fig, ax, cb, ox, oy, w, h = _slab_sheet("КЖ-4", "Армирование верхней плиты", TOP_SLAB_T, "верхняя плита")
    x0, y0, x1, y1 = cb
    from calc import mass_top_slab_d14_kg, len_top_slab_d14_m
    col_labels = ["Поз.", "Направление", "Шаг, мм", "Кол-во стержней/сетка", "Длина стержня, м", "Сеток", "Общая длина, м", "Масса, кг"]
    rows = [
        ["1", f"Вдоль {OUT_W}мм (длина {OUT_L/1000:.1f}м)", "150", f"{n_top_b}", f"{OUT_L/1000:.2f}", "2 (верх+низ)",
         f"{2*n_top_b*OUT_L/1000:.1f}", f"{2*n_top_b*OUT_L/1000*1.208:.1f}"],
        ["2", f"Вдоль {OUT_L}мм (длина {OUT_W/1000:.1f}м)", "150", f"{n_top_a}", f"{OUT_W/1000:.2f}", "2 (верх+низ)",
         f"{2*n_top_a*OUT_W/1000:.1f}", f"{2*n_top_a*OUT_W/1000*1.208:.1f}"],
        ["3", "ИТОГО плита верхняя Ø14", "-", "-", "-", "-", f"{len_top_slab_d14_m:.1f}", f"{mass_top_slab_d14_kg:.1f}"],
    ]
    table_on_ax(fig, ax, (x0, y0 + 4, x1 - 5, y0 + 30), col_labels, rows, fontsize=5.9,
                col_widths=[0.05, 0.27, 0.09, 0.17, 0.13, 0.12, 0.12, 0.09])
    save_all(fig, "KZh-04-plita-verh")
    return fig


def sheet_05():
    fig, ax, cb, ox, oy, w, h = _slab_sheet("КЖ-5", "Армирование нижней плиты", BOT_SLAB_T, "нижняя плита")
    x0, y0, x1, y1 = cb
    from calc import mass_bot_slab_d14_kg, len_bot_slab_d14_m
    col_labels = ["Поз.", "Направление", "Шаг, мм", "Кол-во стержней/сетка", "Длина стержня, м", "Сеток", "Общая длина, м", "Масса, кг"]
    rows = [
        ["1", f"Вдоль {OUT_W}мм (длина {OUT_L/1000:.1f}м)", "150", f"{n_bot_b}", f"{OUT_L/1000:.2f}", "2 (верх+низ)",
         f"{2*n_bot_b*OUT_L/1000:.1f}", f"{2*n_bot_b*OUT_L/1000*1.208:.1f}"],
        ["2", f"Вдоль {OUT_L}мм (длина {OUT_W/1000:.1f}м)", "150", f"{n_bot_a}", f"{OUT_W/1000:.2f}", "2 (верх+низ)",
         f"{2*n_bot_a*OUT_W/1000:.1f}", f"{2*n_bot_a*OUT_W/1000*1.208:.1f}"],
        ["3", "ИТОГО плита нижняя Ø14", "-", "-", "-", "-", f"{len_bot_slab_d14_m:.1f}", f"{mass_bot_slab_d14_kg:.1f}"],
    ]
    table_on_ax(fig, ax, (x0, y0 + 4, x1 - 5, y0 + 30), col_labels, rows, fontsize=5.9,
                col_widths=[0.05, 0.27, 0.09, 0.17, 0.13, 0.12, 0.12, 0.09])
    ax.text(x0, y0 + 33,
            "ВАЖНО: окончательная толщина и армирование нижней плиты зависят от проверки на всплытие\n"
            "(см. КЖ-16) и от фактического расчётного сопротивления основания — оба параметра требуют геологии.",
            fontsize=6.3, color="#8a0000")
    save_all(fig, "KZh-05-plita-niz")
    return fig


# ============================================================ КЖ-6 =========
def sheet_06():
    fig, ax, cb = new_page("КЖ-6", "Узел: стена / нижняя плита", "М 1:5 (увеличено, индикативно)")
    x0, y0, x1, y1 = cb
    ox, oy = x0 + 90, y0 + 40
    slab_w, slab_h = 220, 45
    wall_w, wall_h = 45, 120

    ax.add_patch(Rectangle((ox, oy), slab_w, slab_h, fill=True, fc="0.85", hatch="////", ec="black", lw=1.2))
    ax.add_patch(Rectangle((ox + 60, oy + slab_h), wall_w, wall_h, fill=True, fc="0.85", hatch="\\\\\\\\", ec="black", lw=1.2))

    # арматура плиты (верх+низ)
    for dy in (6, slab_h - 6):
        ax.plot([ox + 4, ox + slab_w - 4], [oy + dy, oy + dy], color="tab:red", lw=1.4)
    ax.text(ox + slab_w + 4, oy + slab_h - 6, "верх. сетка Ø14/150х150", fontsize=5.4, color="tab:red")
    ax.text(ox + slab_w + 4, oy + 6, "низ. сетка Ø14/150х150", fontsize=5.4, color="tab:red")

    # вертикальная арматура стены с анкеровкой в плиту (загиб)
    for xx in (ox + 66, ox + 66 + wall_w - 12):
        ax.plot([xx, xx], [oy + slab_h - 2, oy + slab_h + wall_h], color="tab:blue", lw=1.4)
        ax.plot([xx, xx - 10], [oy + 6, oy + 6], color="tab:blue", lw=1.4)
    ax.text(ox + 66 + wall_w + 4, oy + slab_h + wall_h * 0.5, "верт. арматура\nстены Ø12/150\n(анкеровка загибом\nв плиту, l>=30d)",
            fontsize=5.0, color="tab:blue")

    # горизонтальная арматура стены (2 сетки, показать несколько уровней)
    for i in range(4):
        yy = oy + slab_h + 10 + i * 25
        ax.plot([ox + 62, ox + 62 + wall_w - 4], [yy, yy], color="tab:green", lw=0.9)
    ax.text(ox + 62 - 4, oy + slab_h + 10, "гориз. Ø12/150\n(2 сетки)", fontsize=4.8, color="tab:green", ha="right")

    # рабочий шов + гидрошпонка + набухающий шнур
    ax.plot([ox, ox + slab_w], [oy + slab_h * 0.5, oy + slab_h * 0.5], color="purple", lw=0.0)  # placeholder
    ax.add_patch(Rectangle((ox + 66, oy + slab_h - 3), wall_w, 3, fill=True, fc="purple", ec="none", alpha=0.6))
    ax.text(ox + slab_w + 4, oy + slab_h - 3, "◄ гидрошпонка ПВХ / набухающий шнур\n   в рабочем шве стена/плита", fontsize=5.0, color="purple")

    # защитный слой
    ax.annotate("", xy=(ox + slab_w - 2, oy + 6), xytext=(ox + slab_w - 2, oy),
                arrowprops=dict(arrowstyle="<->", lw=0.6))
    ax.text(ox + slab_w + 2, oy + 3, "защ. слой ~40мм", fontsize=4.6)

    ax.text(x0, y0 + 8,
            "Последовательность бетонирования (предварительно): 1) подготовка основания и тощий бетон;\n"
            "2) устройство нижней плиты с монтажом гидрошпонки/набухающего шнура в зоне стены;\n"
            "3) выдержка, устройство рабочего шва (насечка, очистка, увлажнение); 4) монтаж арматуры стен с\n"
            "анкеровкой в плиту; 5) опалубка и бетонирование стен. Порядок уточняется технологом ППР.",
            fontsize=6.2, va="bottom")

    save_all(fig, "KZh-06-uzel-stena-plita-niz")
    return fig


# ============================================================ КЖ-7 =========
def sheet_07():
    fig, ax, cb = new_page("КЖ-7", "Узел: стена / верхняя плита (крыша)", "М 1:5 (увеличено, индикативно)")
    x0, y0, x1, y1 = cb
    ox, oy = x0 + 90, y0 + 40
    wall_w, wall_h = 45, 100
    slab_w, slab_h = 220, 50

    ax.add_patch(Rectangle((ox + 60, oy), wall_w, wall_h, fill=True, fc="0.85", hatch="\\\\\\\\", ec="black", lw=1.2))
    ax.add_patch(Rectangle((ox, oy + wall_h), slab_w, slab_h, fill=True, fc="0.85", hatch="////", ec="black", lw=1.2))

    for dy in (wall_h + 6, wall_h + slab_h - 6):
        ax.plot([ox + 4, ox + slab_w - 4], [oy + dy, oy + dy], color="tab:red", lw=1.4)
    ax.text(ox + slab_w + 4, oy + wall_h + slab_h - 6, "верх. сетка Ø14/150х150", fontsize=5.4, color="tab:red")
    ax.text(ox + slab_w + 4, oy + wall_h + 6, "низ. сетка Ø14/150х150", fontsize=5.4, color="tab:red")

    for xx in (ox + 66, ox + 66 + wall_w - 12):
        ax.plot([xx, xx], [oy, oy + wall_h + slab_h - 6], color="tab:blue", lw=1.4)
        ax.plot([xx, xx - 10], [oy + wall_h + slab_h - 6, oy + wall_h + slab_h - 6], color="tab:blue", lw=1.4)
    ax.text(ox + 66 + wall_w + 4, oy + wall_h * 0.5, "верт. арматура стены Ø12/150,\nанкеровка загибом в плиту", fontsize=5.0, color="tab:blue")

    for i in range(4):
        yy = oy + 8 + i * 22
        ax.plot([ox + 62, ox + 62 + wall_w - 4], [yy, yy], color="tab:green", lw=0.9)
    ax.text(ox + 62 - 4, oy + 8, "гориз. Ø12/150\n(2 сетки)", fontsize=4.8, color="tab:green", ha="right")

    ax.add_patch(Rectangle((ox, oy + wall_h + slab_h), slab_w, 6, fill=True, fc="#c9a876", hatch="...", ec="0.3"))
    ax.text(ox + slab_w + 4, oy + wall_h + slab_h + 3, f"грунт {SOIL_OVER_TOP} мм", fontsize=5.0)

    ax.add_patch(Rectangle((ox + 20, oy + wall_h - 8), wall_w + 20, 8, fill=True, fc="orange", alpha=0.4, ec="none"))
    ax.text(ox + slab_w + 4, oy + wall_h - 8, "◄ локальное усиление зоны\n   «стена-плита» доп. каркасами\n   (предварительно, Ø12/16)", fontsize=4.8, color="darkorange")

    ax.text(x0, y0 + 8,
            "Узел показывает анкеровку вертикальной арматуры стены в верхнюю плиту и локальное усиление\n"
            "приопорной зоны. Требуется проверка на местный момент/поперечную силу у опоры плиты.",
            fontsize=6.3, va="bottom")

    save_all(fig, "KZh-07-uzel-stena-krysha")
    return fig


# ============================================================ КЖ-8 =========
def sheet_08():
    fig, ax, cb = new_page("КЖ-8", "Входной узел", "Схематично, без масштаба")
    x0, y0, x1, y1 = cb
    ox, oy = x0 + 20, y0 + 45

    # шахта в разрезе (вертикальный вид)
    shaft_w, shaft_h = 60, 140
    ax.add_patch(Rectangle((ox, oy), shaft_w, shaft_h, fill=False, ec="black", lw=1.2))
    ax.text(ox + shaft_w / 2, oy + shaft_h + 4, "Входная шахта\n(разрез)", ha="center", fontsize=6.4, fontweight="bold")

    # лестница
    for i in range(8):
        yy = oy + 8 + i * (shaft_h - 16) / 8
        ax.plot([ox + 6, ox + shaft_w - 6], [yy, yy], color="0.3", lw=1.0)
    ax.text(ox + shaft_w / 2, oy - 5, "лестница", ha="center", fontsize=5.2)

    # наружная дверь (верх шахты) и внутренняя дверь (низ, у тамбура)
    ax.add_patch(Rectangle((ox - 4, oy + shaft_h - 6), shaft_w + 8, 8, fill=True, fc="tab:red", ec="black"))
    ax.text(ox + shaft_w + 10, oy + shaft_h - 2, "1. Наружная защитно-\n   герметичная дверь\n   (проём 900 мм, предв.)", fontsize=5.2, color="tab:red")

    # тамбур
    tamb_y0 = oy + shaft_h * 0.35
    tamb_y1 = oy + shaft_h * 0.55
    ax.add_patch(Rectangle((ox, tamb_y0), shaft_w, tamb_y1 - tamb_y0, fill=True, fc="#eef6ff", ec="0.4", lw=0.8))
    ax.text(ox + shaft_w / 2, (tamb_y0 + tamb_y1) / 2, "тамбур\n(шлюз)", ha="center", va="center", fontsize=5.2)

    ax.add_patch(Rectangle((ox - 4, tamb_y0 - 4), shaft_w + 8, 6, fill=True, fc="tab:blue", ec="black"))
    ax.text(ox + shaft_w + 10, tamb_y0 - 2, "2. Внутренняя\n   герметичная дверь", fontsize=5.2, color="tab:blue")

    # посадочные закладные
    for dy in (6, shaft_h - 12):
        ax.add_patch(Rectangle((ox - 6, oy + dy), 4, 6, fill=True, fc="black"))
        ax.add_patch(Rectangle((ox + shaft_w + 2, oy + dy), 4, 6, fill=True, fc="black"))
    ax.text(ox - 8, oy + shaft_h / 2, "закладные\nдля коробки\nдвери (предв.)", fontsize=4.6, ha="right", va="center")

    # усиление проёма
    ax.plot([ox - 10, ox - 10], [oy, oy + shaft_h], color="darkorange", lw=1.6)
    ax.plot([ox + shaft_w + 10, ox + shaft_w + 10], [oy, oy + shaft_h], color="darkorange", lw=1.6)
    ax.text(ox + shaft_w + 10, oy + 33, "усиление проёма\nØ16 (предв.)", ha="left", va="top", fontsize=4.6, color="darkorange")

    # герметизация
    ax.text(ox + shaft_w + 90, oy + shaft_h * 0.8,
            "Герметизация:\n- по периметру дверных коробок;\n- в местах прохода через плиту/стену;\n"
            "- проверка на класс герметичности\nсовместно с производителем двери.",
            fontsize=5.6, va="top")

    ax.add_patch(Rectangle((x0 + 5, y0 + 5), x1 - x0 - 10, 26, fill=False, ec="red", lw=1.2))
    ax.text(x0 + (x1 - x0) / 2, y0 + 18,
            "В спецификации: «Тип и посадочные размеры дверей уточнить по паспорту выбранного изделия».\n"
            "Конкретная модель двери НЕ проектируется в этом черновом комплекте без данных производителя.",
            ha="center", va="center", fontsize=6.6, color="red")

    save_all(fig, "KZh-08-vhod")
    return fig


# ============================================================ КЖ-9 =========
def sheet_09():
    fig, ax, cb = new_page("КЖ-9", "Аварийный выход (люк)", "Схематично, без масштаба")
    x0, y0, x1, y1 = cb
    ox, oy = x0 + 60, y0 + 45

    shaft_w, shaft_h = 70, 130
    ax.add_patch(Rectangle((ox, oy), shaft_w, shaft_h, fill=False, ec="black", lw=1.2))
    ax.text(ox + shaft_w / 2, oy + shaft_h + 4, "Вертикальная шахта\nаварийного выхода", ha="center", fontsize=6.4, fontweight="bold")

    # металлическая рамка люка сверху
    ax.add_patch(Rectangle((ox - 5, oy + shaft_h - 6), shaft_w + 10, 8, fill=True, fc="0.3", ec="black"))
    ax.text(ox + shaft_w + 15, oy + shaft_h - 2, f"металлическая рамка +\nкрышка люка {HATCH[0]}x{HATCH[1]} мм", fontsize=5.4)

    # стационарная лестница (скобы)
    for i in range(9):
        yy = oy + 6 + i * (shaft_h - 12) / 9
        ax.plot([ox + shaft_w * 0.25, ox + shaft_w * 0.75], [yy, yy], color="0.3", lw=1.4)
    ax.text(ox - 6, oy + shaft_h / 2, "стационарная\nлестница\n(скобы)", fontsize=5.0, ha="right", va="center")

    # посадочное место / герметизация
    ax.add_patch(Rectangle((ox - 3, oy + shaft_h - 10), shaft_w + 6, 4, fill=True, fc="purple", alpha=0.6))
    ax.text(ox + shaft_w + 15, oy + shaft_h - 12, "посадочное место +\nгерметизация (уплотнитель)", fontsize=5.0, color="purple")

    # усиление плиты вокруг люка
    ax.plot([ox - 12, ox - 12], [oy + shaft_h - 30, oy + shaft_h + 4], color="darkorange", lw=1.6)
    ax.plot([ox + shaft_w + 12, ox + shaft_w + 12], [oy + shaft_h - 30, oy + shaft_h + 4], color="darkorange", lw=1.6)
    ax.text(ox + shaft_w + 15, oy + shaft_h - 22, "локальное усиление\nплиты Ø16 (предв.)", ha="left", va="top", fontsize=4.8, color="darkorange")

    ax.text(x0, y0 + 8,
            "Люк устанавливается в верхней плите со смещением от основного входа (см. КЖ-1). Крышка люка,\n"
            "запорные механизмы и класс герметичности — по паспорту изделия. Приямок/отбойник в шахте —\n"
            "по месту. Финальное положение и глубина шахты уточняются с учётом планировки участка.",
            fontsize=6.3, va="bottom")

    save_all(fig, "KZh-09-avariyniy-vyhod")
    return fig


# ============================================================ КЖ-10 ========
def sheet_10():
    fig, ax, cb = new_page("КЖ-10", "Вентиляционные и кабельные проходки", "Схематично, без масштаба")
    x0, y0, x1, y1 = cb

    # схематичный узел проходки (общий для всех)
    ox, oy = x0 + 15, y0 + 90
    ax.add_patch(Rectangle((ox, oy), 30, 90, fill=True, fc="0.8", hatch="////", ec="black"))
    ax.add_patch(Circle((ox + 15, oy + 45), 8, fill=False, ec="black", lw=1.4))
    ax.add_patch(Circle((ox + 15, oy + 45), 6, fill=True, fc="white", ec="tab:blue", lw=1.0))
    ax.text(ox + 40, oy + 60, "гильза (стальная/ПВХ)\nс приварной/накладной\nгерметизирующей манжетой", fontsize=5.4)
    ax.text(ox + 40, oy + 40, "уплотнение: набухающий\nшнур/термоусадка/герметик,\nкласс герметичности по проекту", fontsize=5.4)
    ax.text(ox + 40, oy + 20, "доп. армирование Ø12\nпо контуру отверстия\n(предварительно)", fontsize=5.4, color="darkorange")
    ax.plot([ox + 15 - 12, ox + 15 + 12], [oy + 45 - 12, oy + 45 - 12], color="darkorange", lw=1.2, ls="--")
    ax.plot([ox + 15 - 12, ox + 15 + 12], [oy + 45 + 12, oy + 45 + 12], color="darkorange", lw=1.2, ls="--")

    col_labels = ["Поз.", "Назначение", "Размер/Ø", "Гильза", "Герметизация", "Доп. армирование", "Статус"]
    rows = [
        ["P1", "Приточная вентиляция", "~Ø150 мм", "стальная гильза + манжета", "набухающий шнур + герметик", "рамка Ø12", "предварительно"],
        ["P2", "Вытяжная вентиляция", "~Ø150 мм", "стальная гильза + манжета", "набухающий шнур + герметик", "рамка Ø12", "предварительно"],
        ["P3", "Электрический ввод", "~Ø63 мм", "ПВХ гильза с манжетой", "гермовводы, герметик", "рамка Ø12", "предварительно"],
        ["P4", "Резервный кабельный ввод", "~Ø63 мм", "ПВХ гильза с манжетой", "гермовводы, герметик", "рамка Ø12", "предварительно"],
        ["P5", "Возможный ввод воды", "~Ø50 мм", "стальная гильза с манжетой", "набухающий шнур + герметик", "рамка Ø12", "предварительно, если требуется"],
    ]
    table_on_ax(fig, ax, (x0 + 130, y0 + 70, x1 - 5, y0 + 130),
                col_labels, rows, fontsize=6.0,
                col_widths=[0.06, 0.24, 0.13, 0.2, 0.22, 0.12, 0.13])

    ax.text(x0, y0 + 35,
            "Все проходки выполняются через закладные гильзы с герметизирующими манжетами до бетонирования.\n"
            "Диаметры даны укрупнённо по ориентировочному воздухообмену (см. КЖ-17) и типовым сечениям кабеля/трубы;\n"
            "точные диаметры и число проходок уточняются после подбора оборудования вентиляции/электрики.",
            fontsize=6.3, color="#8a0000", va="bottom")

    save_all(fig, "KZh-10-prohodki")
    return fig


# ============================================================ КЖ-11 ========
def sheet_11():
    fig, ax, cb = new_page("КЖ-11", "Спецификация арматуры", "—")
    x0, y0, x1, y1 = cb
    from calc import (mass_walls_d12_kg, len_walls_d12_m, mass_top_slab_d14_kg, len_top_slab_d14_m,
                       mass_bot_slab_d14_kg, len_bot_slab_d14_m, mass_openings_d16_kg, len_openings_d16_m,
                       mass_corner_extra_kg, mass_install_extra_kg, mass_reserve_kg, mass_rebar_total_kg)

    col_labels = ["Поз.", "Ø, мм", "Класс", "Назначение / форма", "Длина 1 ст., м", "Кол-во, шт", "Общая длина, м", "Масса, кг"]
    rows = [
        ["1", "12", REBAR_CLASS, "Стены — вертикальные (прямые)", f"{vert_bar_len/1000:.2f}", f"{2*n_vert_per_layer}",
         f"{2*n_vert_per_layer*vert_bar_len/1000:.1f}", f"{2*n_vert_per_layer*vert_bar_len/1000*0.888:.1f}"],
        ["2", "12", REBAR_CLASS, "Стены — горизонтальные (замкн. контур)", f"{horiz_bar_len/1000:.2f}", f"{2*n_horiz_per_layer}",
         f"{2*n_horiz_per_layer*horiz_bar_len/1000:.1f}", f"{2*n_horiz_per_layer*horiz_bar_len/1000*0.888:.1f}"],
        ["3", "12", REBAR_CLASS, "Угловые Г-обр. / П-обр. доборные эл-ты (предв., ~8%)", "-", "-", "-", f"{mass_corner_extra_kg:.1f}"],
        ["4", "14", REBAR_CLASS, "Верхняя плита — сетка верх+низ (прямые)", "-", f"{n_top_a*2+n_top_b*2}",
         f"{len_top_slab_d14_m:.1f}", f"{mass_top_slab_d14_kg:.1f}"],
        ["5", "14", REBAR_CLASS, "Нижняя плита — сетка верх+низ (прямые)", "-", f"{n_bot_a*2+n_bot_b*2}",
         f"{len_bot_slab_d14_m:.1f}", f"{mass_bot_slab_d14_kg:.1f}"],
        ["6", "16", REBAR_CLASS, "Усиление проёма входа (рамка, предв.)", "1.50", "4", "6.0", f"{4*1.5*1.578:.1f}"],
        ["7", "16", REBAR_CLASS, "Усиление проёма аварийного люка (рамка, предв.)", "1.50", "4", "6.0", f"{4*1.5*1.578:.1f}"],
        ["8", "-", "-", "Монтажная арматура (фиксаторы, стулья, распорки, ~3%)", "-", "-", "-", f"{mass_install_extra_kg:.1f}"],
        ["9", "-", "-", "Технологический запас (~5%)", "-", "-", "-", f"{mass_reserve_kg:.1f}"],
    ]
    table_on_ax(fig, ax, (x0, y0 + 55, x1 - 5, y0 + 155),
                col_labels, rows, fontsize=6.1,
                col_widths=[0.04, 0.06, 0.08, 0.36, 0.11, 0.1, 0.12, 0.13])

    col_labels2 = ["Диаметр", "Класс", "Общая длина, м", "Общая масса, кг", "Общая масса, т"]
    rows2 = [[k, REBAR_CLASS, (str(v["len_m"]) if v["len_m"] is not None else "-"), f"{v['mass_kg']:.1f}", f"{v['mass_kg']/1000:.3f}"]
             for k, v in REBAR_TABLE.items()]
    rows2.append(["ВСЕГО", "-", "-", f"{mass_rebar_total_kg:.1f}", f"{mass_rebar_total_kg/1000:.3f}"])
    table_on_ax(fig, ax, (x0, y0 + 8, x1 - 5, y0 + 50),
                col_labels2, rows2, fontsize=6.4, title="Сводная ведомость по диаметрам",
                col_widths=[0.28, 0.12, 0.2, 0.2, 0.2])

    ax.text(x0, y0 + 158,
            f"Итого арматура по проекту (предварительно): ~{mass_rebar_total_kg/1000:.2f} т "
            f"(ориентир ТЗ: ~2,4 т — величина требует проверки после разработки рабочих чертежей).",
            fontsize=7.0, fontweight="bold", va="bottom")

    save_all(fig, "KZh-11-spec-armatury")
    return fig


# ============================================================ КЖ-12 ========
def sheet_12():
    fig, ax, cb = new_page("КЖ-12", "Ведомость бетона", "—")
    x0, y0, x1, y1 = cb

    col_labels = ["Элемент", "Класс бетона", "Объём, м3"]
    rows = [[k, f"{CONCRETE_CLASS} {CONCRETE_W} {CONCRETE_F}", f"{v:.2f}"] for k, v in CONCRETE_TABLE.items()]
    rows.append(["ИТОГО (основной короб + шахты + резерв)", "-", f"{vol_total_order_A:.2f}"])
    table_on_ax(fig, ax, (x0, y0 + 90, x1 - 5, y0 + 158),
                col_labels, rows, fontsize=7.0, title="Ведомость объёмов бетона",
                col_widths=[0.6, 0.25, 0.15])

    ax.text(x0, y0 + 78,
            f"Объём основного короба (стены+плиты): {vol_main_box_A:.2f} м3.\n"
            f"К заказу с учётом входной/аварийной шахт и технологического резерва: ~{vol_total_order_A:.1f} м3.\n"
            f"Требования к бетону: класс {CONCRETE_CLASS}, водонепроницаемость {CONCRETE_W}, морозостойкость {CONCRETE_F}.\n"
            f"Учитывая невозможность мембранной гидроизоляции — рекомендуется рассмотреть кристаллизующиеся\n"
            f"добавки в бетон («белая ванна») по согласованию с инженером-конструктором.",
            fontsize=6.6, va="top")

    ax.add_patch(Rectangle((x0, y0 + 5), x1 - x0, 16, fill=False, ec="red", lw=1.2))
    ax.text(x0 + (x1 - x0) / 2, y0 + 13,
            "Объёмы — предварительные (по укрупнённой методике). Точные объёмы — по рабочим чертежам и обмерам.",
            ha="center", va="center", fontsize=6.8, color="red")

    save_all(fig, "KZh-12-vedomost-betona")
    return fig


# ============================================================ КЖ-13 ========
def sheet_13():
    fig, ax, cb = new_page("КЖ-13", "Ведомость закладных и гидроизоляционных элементов", "—")
    x0, y0, x1, y1 = cb

    col_labels = ["Поз.", "Наименование", "Ед.", "Кол-во (предв.)", "Примечание"]
    rows = [
        ["1", "Гидрошпонка ПВХ (рабочие швы плита/стена)", "м", f"~{2*(OUT_L+OUT_W)/1000+2*(OUT_L+OUT_W-2*WALL_T)/1000:.0f}", "по периметру швов низ+верх"],
        ["2", "Набухающий шнур (доп./дублирующий)", "м", f"~{2*(OUT_L+OUT_W)/1000:.0f}", "в зонах повышенного риска фильтрации"],
        ["3", "Инъекционный шланг (резервный, в швах)", "м", f"~{(OUT_L+OUT_W)/1000:.0f}", "на случай локальной фильтрации"],
        ["4", "Кристаллизующаяся добавка/обмазка «белой ванны»", "м2", f"~{(2*(OUT_L+OUT_W)/1000*IN_H/1000 + 2*OUT_L*OUT_W/1e6):.0f}", "внутр. поверхность стен+плиты, по согласованию"],
        ["5", "Закладные детали дверных коробок (наружная+внутр.)", "компл.", "2", "тип — по паспорту двери"],
        ["6", "Металлическая рамка люка + закладные", "компл.", "1", "800х800, тип — по паспорту"],
        ["7", "Гильзы проходок P1-P5 с манжетами", "шт.", "5", "см. КЖ-10"],
        ["8", "Стационарная лестница (авар. шахта)", "компл.", "1", "нержавеющая сталь/оцинковка"],
        ["9", "Лестница входной шахты", "компл.", "1", "тип уточняется"],
    ]
    table_on_ax(fig, ax, (x0, y0 + 40, x1 - 5, y0 + 158),
                col_labels, rows, fontsize=6.4,
                col_widths=[0.05, 0.42, 0.08, 0.15, 0.3])

    ax.text(x0, y0 + 8,
            "Количества — ОРИЕНТИРОВОЧНЫЕ (укрупнённо по периметрам/площадям). Финальная спецификация\n"
            "закладных и гидроизоляционных материалов формируется на этапе рабочего проекта совместно\n"
            "с производителем системы гидроизоляции и поставщиком дверей/люка.",
            fontsize=6.5, color="#8a0000", va="bottom")

    save_all(fig, "KZh-13-zakladnye-gidroizolyacia")
    return fig


# ============================================================ КЖ-14 ========
def sheet_14():
    fig, ax, cb = new_page("КЖ-14", "Полная смета (сводно)", "—")
    x0, y0, x1, y1 = cb

    names = {
        "A": "Земляные работы", "B": "Бетон", "C": "Арматура (материал)", "D": "Опалубка",
        "E": "Арматурные работы", "F": "Бетонирование", "G": "Насос бетона", "H": "Доставка",
        "I": "Герметизация швов", "J": "Защитные двери", "K": "Аварийный люк", "L": "Вентиляция",
        "M": "Электрика", "N": "Инвертор", "O": "Аккумулятор", "P": "Вода", "Q": "Туалет",
        "R": "Спальные места", "S": "Мебель/хранение", "T": "Датчики", "U": "Инструменты",
        "V": "Геология", "W": "Проект КЖ", "X": "Технадзор",
    }
    col_labels = ["№", "Раздел", "LOW, грн", "REALISTIC, грн", "HIGH, грн"]
    rows = []
    for k in "ABCDEFGHIJKLMNOPQRSTUVWX":
        low, real, high, _ = BUDGET[k]
        rows.append([k, names[k], f"{low:,}".replace(",", " "), f"{real:,}".replace(",", " "), f"{high:,}".replace(",", " ")])
    rows.append(["", "Подытог (A-X)", f"{SUBTOTAL_LOW:,}".replace(",", " "), f"{SUBTOTAL_REALISTIC:,}".replace(",", " "), f"{SUBTOTAL_HIGH:,}".replace(",", " ")])
    rows.append(["Y", "Резерв на непредвиденное (15%)", f"{RESERVE_LOW:,}".replace(",", " "), f"{RESERVE_REALISTIC:,}".replace(",", " "), f"{RESERVE_HIGH:,}".replace(",", " ")])
    rows.append(["", "ИТОГО", f"{TOTAL_LOW:,}".replace(",", " "), f"{TOTAL_REALISTIC:,}".replace(",", " "), f"{TOTAL_HIGH:,}".replace(",", " ")])

    table_on_ax(fig, ax, (x0, y0 + 20, x1 - 5, y0 + 158),
                col_labels, rows, fontsize=5.7,
                col_widths=[0.05, 0.4, 0.18, 0.18, 0.19])

    ax.text(x0, y0 + 8,
            f"Цены — Киев/Украина, сентябрь 2026, ориентировочно (часть позиций сверена веб-поиском, см. Excel "
            f"«Источники цен»). Полная детализация — в файле ukryttya_3x4_full_estimate_2026.xlsx (лист «Смета»).",
            fontsize=6.2, color="#8a0000", va="bottom")

    save_all(fig, "KZh-14-smeta")
    return fig


# ============================================================ КЖ-15 ========
def sheet_15():
    fig, ax, cb = new_page("КЖ-15", "План внутреннего оснащения", "М 1:40 (индикативно)")
    x0, y0, x1, y1 = cb
    K = 0.05
    ox, oy = x0 + 15, y0 + 40

    def X(mm_x):
        return ox + mm_x * K

    def Y(mm_y):
        return oy + mm_y * K

    ax.add_patch(Rectangle((X(0), Y(0)), OUT_L * K, OUT_W * K, fill=False, lw=1.4, ec="black"))
    ax.add_patch(Rectangle((X(WALL_T), Y(WALL_T)), IN_L * K, IN_W * K, fill=False, lw=1.0, ec="black"))

    items = [
        ("2х-яр.\nкровать №1", 50, 50, 700, 1900, "#dfe9ff"),
        ("2х-яр.\nкровать №2", 800, 50, 700, 1900, "#dfe9ff"),
        ("Стол /\nотдых", 1600, 50, 700, 500, "#fff7df"),
        ("Стеллаж\n(запасы)", 1600, 600, 700, 650, "#f0e6ff"),
        ("Биотуалет +\nперегородка", 50, 2000, 650, 750, "#e2ffe2"),
        ("Ёмкости\nводы 150-200л", 2400, 50, 700, 700, "#dff7ff"),
        ("Насос +\nразводка", 2400, 800, 700, 300, "#dff7ff"),
        ("Электрощит +\nинвертор", 2400, 1150, 700, 400, "#ffe8d6"),
        ("АКБ\n5/10 кВт*ч", 2400, 1600, 700, 400, "#ffe8d6"),
        ("Аптечка /\nогнетушители", 3250, 2000, 650, 650, "#f5f5f5"),
    ]
    for label, zx, zy, zw, zh, col in items:
        ax.add_patch(Rectangle((X(WALL_T + zx), Y(WALL_T + zy)), zw * K, zh * K, fill=True, fc=col, ec="0.4", lw=0.6))
        ax.text(X(WALL_T + zx + zw / 2), Y(WALL_T + zy + zh / 2), label, ha="center", va="center", fontsize=4.6)

    ax.text(x0, y0 + 34,
            f"Оснащение на {PEOPLE} чел. Расстановка мебели/оборудования — ПРЕДВАРИТЕЛЬНАЯ, уточняется по\n"
            f"месту после выбора конкретных моделей дверей/АКБ/сантехники. Запас воды: мин. {WATER_MIN_L} л,\n"
            f"практический ~{WATER_PRACTICAL_L} л, предпочтительно {WATER_PREFERRED_L[0]}-{WATER_PREFERRED_L[1]} л.",
            fontsize=6.4, color="#8a0000", va="top")

    save_all(fig, "KZh-15-osnashenie")
    return fig


# ======================================================= КЖ-16 (доп.) ======
def sheet_16():
    fig, ax, cb = new_page("КЖ-16", "Приложение: проверка на всплытие и боковое давление грунта", "—")
    x0, y0, x1, y1 = cb

    ax.text(x0, y1 - 2, "21. ПРОВЕРКА НА ВСПЛЫТИЕ (худший случай: УГВ = уровень земли)", fontsize=8, fontweight="bold", va="top")
    col_labels = ["Вариант", "Учёт грунта над плитой", "Vнаруж, м3", "Fвспл, кН", "Gбетон, кН", "Gгрунт, кН", "Fуд, кН", "К уст. (FS)"]
    rows = [
        ["A: плита 350мм", "с грунтом", f"{BUOY_A_with_soil['vol_outer_m3']}", f"{BUOY_A_with_soil['uplift_kN']}",
         f"{BUOY_A_with_soil['weight_concrete_kN']}", f"{BUOY_A_with_soil['weight_soil_kN']}", f"{BUOY_A_with_soil['resisting_kN']}", f"{BUOY_A_with_soil['FS']}"],
        ["A: плита 350мм", "без грунта (консерв.)", f"{BUOY_A_no_soil['vol_outer_m3']}", f"{BUOY_A_no_soil['uplift_kN']}",
         f"{BUOY_A_no_soil['weight_concrete_kN']}", f"{BUOY_A_no_soil['weight_soil_kN']}", f"{BUOY_A_no_soil['resisting_kN']}", f"{BUOY_A_no_soil['FS']}"],
        ["B: плита 400мм (усил.)", "с грунтом", f"{BUOY_B_with_soil['vol_outer_m3']}", f"{BUOY_B_with_soil['uplift_kN']}",
         f"{BUOY_B_with_soil['weight_concrete_kN']}", f"{BUOY_B_with_soil['weight_soil_kN']}", f"{BUOY_B_with_soil['resisting_kN']}", f"{BUOY_B_with_soil['FS']}"],
        ["B: плита 400мм (усил.)", "без грунта (консерв.)", f"{BUOY_B_no_soil['vol_outer_m3']}", f"{BUOY_B_no_soil['uplift_kN']}",
         f"{BUOY_B_no_soil['weight_concrete_kN']}", f"{BUOY_B_no_soil['weight_soil_kN']}", f"{BUOY_B_no_soil['resisting_kN']}", f"{BUOY_B_no_soil['FS']}"],
    ]
    table_on_ax(fig, ax, (x0, y1 - 55, x1 - 5, y1 - 8),
                col_labels, rows, fontsize=6.2, col_widths=[0.16, 0.17, 0.11, 0.11, 0.11, 0.11, 0.11, 0.12])

    ax.text(x0, y1 - 60,
            "Коэффициент устойчивости на всплытие FS = Fуд/Fвспл. Обычно требуют FS >= 1,1...1,5 (в зависимости\n"
            "от норм и категории ответственности) — конкретное требование определяет инженер-конструктор.\n"
            "В расчётных вариантах FS ~ 1,1-1,2 — ЗАПАС МИНИМАЛЕН/НЕДОСТАТОЧЕН при консервативном допущении.\n"
            "Возможные меры при неудовлетворительном FS: 1) увеличение вылета/консоли плиты за периметр стен;\n"
            "2) утяжеление (пригрузочная плита/балласт); 3) грунтовые/анкерные сваи против всплытия;\n"
            "4) изменение геометрии (уменьшение наружного объёма при том же внутреннем объёме).\n"
            "ОКОНЧАТЕЛЬНОЕ РЕШЕНИЕ НЕ ПРИНИМАЕТСЯ без инженерно-геологических изысканий (УГВ, плотность грунта).",
            fontsize=6.4, color="#8a0000", va="top")

    ax.text(x0, y1 - 108, "22. БОКОВОЕ ДАВЛЕНИЕ ГРУНТА НА СТЕНЫ (метод Ранкина, предварительно, 3 сценария)",
            fontsize=8, fontweight="bold", va="top")
    col_labels2 = ["Сценарий", "p верх, кПа", "p низ (грунт), кПа", "p низ (вода), кПа", "p низ (сумм.), кПа", "Равнод. на 1м стены, кН/м"]
    rows2 = []
    for name, r in LATERAL_RESULTS.items():
        rows2.append([name, f"{r['p_top_kPa']}", f"{r['p_bot_soil_kPa']}", f"{r['p_bot_water_kPa']}", f"{r['p_bot_kPa']}", f"{r['resultant_kN_m']}"])
    table_on_ax(fig, ax, (x0, y1 - 150, x1 - 5, y1 - 112),
                col_labels2, rows2, fontsize=6.2, col_widths=[0.34, 0.13, 0.15, 0.15, 0.13, 0.1])

    ax.text(x0, y0 + 8,
            "Расчёт по упрощённой формуле Ренкина (Ka=(1-sinφ)/(1+sinφ)), треугольная эпюра давления по глубине\n"
            "стены (h=2,2м). Насыщенный грунт даёт максимальную нагрузку (грунт+вода) — определяющий сценарий\n"
            "для проверки прочности стен и подбора армирования. Параметры γ, φ — ПРИНЯТЫ УКРУПНЁННО (справочно);\n"
            "фактические значения обязательны из инженерно-геологических изысканий перед рабочим проектированием.",
            fontsize=6.3, color="#8a0000", va="bottom")

    save_all(fig, "KZh-16-vsplytie-davlenie")
    return fig


# ======================================================= КЖ-17 (доп.) ======
def sheet_17():
    fig, ax, cb = new_page("КЖ-17", "Приложение: инженерные системы (вентиляция, электрика, вода)", "—")
    x0, y0, x1, y1 = cb

    ax.text(x0, y1 - 2, f"ВЕНТИЛЯЦИЯ (на {PEOPLE} чел., ориентир {AIR_FLOW_MIN_M3H}-{AIR_FLOW_MAX_M3H} м3/ч)",
            fontsize=8, fontweight="bold", va="top")
    col_labels = ["Вариант", "Оборудование", "Мощность", "Цена ориент., грн", "Плюсы", "Минусы"]
    rows = [
        ["A. Базовая\nпринудительная", "приточно-вытяжные вентиляторы,\nобратные клапаны, фильтр G4,\nручной резервный привод",
         "~60-100 м3/ч,\n~40-80 Вт", f"{BUDGET['L'][1]:,}".replace(",", " "),
         "просто, недорого,\nлегко обслуживать", "нет защиты от\nОВ/пыли/дыма спецсредствами"],
        ["B. Специализир.\nФВУ", "фильтровентиляционная установка\nс противовзрывными клапанами,\nфильтром (аэрозольный+сорбционный),\nручной резерв, доп. автоматика",
         "~100-150 м3/ч,\n~80-150 Вт", f"{BUDGET['L'][2]:,}".replace(",", " "),
         "выше уровень\nзащиты воздуха", "дороже, сложнее\nмонтаж/обслуживание"],
    ]
    table_on_ax(fig, ax, (x0, y1 - 55, x1 - 5, y1 - 10), col_labels, rows, fontsize=6.0,
                col_widths=[0.12, 0.28, 0.13, 0.14, 0.16, 0.17])
    ax.text(x0, y1 - 60, "Обязательно во всех вариантах: датчик CO2, датчик CO, дымовой датчик, ручной резервный привод вентиляции.",
            fontsize=6.4, va="top")

    ax.text(x0, y1 - 72, "ЭЛЕКТРИКА И АВТОНОМНОСТЬ (инвертор 5 кВт, АКБ 5 / 10 кВт*ч)", fontsize=8, fontweight="bold", va="top")
    col_labels2 = ["Потребитель", "Мощность, Вт", "Автономность 5 кВт*ч, ч", "Автономность 10 кВт*ч, ч"]
    loads = [("Вентиляция (вариант A)", 60), ("Освещение LED", 40), ("Телефоны (заряд, 4 шт.)", 20),
             ("Радиостанция", 15), ("Небольшой насос (циклично, ср.)", 80)]
    rows2 = []
    for name, w in loads:
        rows2.append([name, str(w), f"{5000/w:.0f}", f"{10000/w:.0f}"])
    table_on_ax(fig, ax, (x0, y1 - 118, x1 - 5, y1 - 76), col_labels2, rows2, fontsize=6.2,
                col_widths=[0.4, 0.2, 0.2, 0.2])
    ax.text(x0, y1 - 122,
            "Автономность отдельно по каждому потребителю (не суммарно при одновременной работе всех).\n"
            f"Оценка стоимости АКБ 10 кВт*ч: LOW {BATTERY_10KWH[0]:,} / REALISTIC {BATTERY_10KWH[1]:,} / HIGH {BATTERY_10KWH[2]:,} грн.".replace(",", " "),
            fontsize=6.2, va="top")

    ax.text(x0, y1 - 138, f"ВОДА (на {PEOPLE} чел., 3 суток автономности)", fontsize=8, fontweight="bold", va="top")
    ax.text(x0, y1 - 142,
            f"Минимум питьевой воды: 3 л x {PEOPLE} чел. x 3 сут = {WATER_MIN_L} л. Практический запас: не менее "
            f"{WATER_PRACTICAL_L} л. Предпочтительно: {WATER_PREFERRED_L[0]}-{WATER_PREFERRED_L[1]} л.\n"
            f"Состав: пищевая ёмкость + кран, небольшой насос, ручной резерв (ручная помпа/самотёк), "
            f"отдельные канистры питьевой воды (НЗ).",
            fontsize=6.4, va="top")

    save_all(fig, "KZh-17-inzh-sistemy")
    return fig


# ================================================================ MAIN =====
def build_all():
    sheet_funcs = [sheet_00, sheet_01, sheet_02, sheet_03, sheet_04, sheet_05,
                   sheet_06, sheet_07, sheet_08, sheet_09, sheet_10, sheet_11,
                   sheet_12, sheet_13, sheet_14, sheet_15, sheet_16, sheet_17]
    with PdfPages(PDF_PATH) as pdf:
        for fn in sheet_funcs:
            fig = fn()
            pdf.savefig(fig)
            plt.close(fig)
    print(f"PDF saved: {PDF_PATH}")
    print(f"Sheets: {len(SHEETS_META)}")
    for code, title in SHEETS_META:
        print(f"  {code}: {title}")


if __name__ == "__main__":
    build_all()
